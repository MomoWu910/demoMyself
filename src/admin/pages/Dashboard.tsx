import * as React from 'react';
import {
    Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { query, stats, subscribe, type LedgerStats } from '../../arcade/server/ledger';
import { stats as txStats, subscribe as subscribeTx, type TxStats } from '../../arcade/server/txLedger';
import {
    BASELINE_BET_STD, BASELINE_OVERALL, BASELINE_OVERALL_STD, BASELINE_PAYOUT_RATE,
    BASELINE_SAMPLE, deviationLevel, effectiveSample,
} from '../baseline';
import { GAME_IDS, GAME_LABEL, money, percent, signedMoney } from '../format';
import { MONO } from '../theme';

/**
 * 營運儀表板。
 *
 * **這一頁上的每個數字都是從注單表算出來的，沒有任何一個是寫死的參數。**
 * 派彩率是總派彩除以總下注，而那些注單是四款玩法用真正的規則跑出來的
 * （見 admin/seed.ts）。所以這個數字會往各款遊戲本身的期望值收斂——
 * 局數少的時候偏離得很遠，那是變異數不是系統有問題。
 *
 * 這件事值得在畫面上講清楚，因為**營運報表最常見的誤讀就是把短期波動當成異常**。
 */

const DAY = 86_400_000;

/** KPI 卡。標題、數字、附註三層，附註是拿來放「這個數字怎麼算的」 */
function Kpi(props: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }): React.ReactElement {
    const { label, value, note, tone } = props;
    return (
        <Paper sx={{ p: 2, flex: '1 1 180px', minWidth: 180 }}>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.05em' }}>
                {label}
            </Typography>
            <Typography
                sx={{
                    fontFamily: MONO, fontSize: 26, fontWeight: 600, lineHeight: 1.3, mt: 0.5,
                    color: tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : 'text.primary',
                }}
            >
                {value}
            </Typography>
            {note && (
                <Typography variant="caption" color="text.secondary">{note}</Typography>
            )}
        </Paper>
    );
}

/**
 * 逐日投注額的長條圖。
 *
 * 刻意不裝圖表套件。這張圖要表達的東西只有「哪一天量比較大」，
 * 一個 flex 容器加幾個 div 就做得完——為了它多背一個 300KB 的相依，
 * 在後台這種要長期維護的專案裡不划算。
 *
 * （範圍拉到三十天之後這個判斷仍然成立：柱子從 7 根變 30 根，
 * 要處理的只是標籤會擠在一起，那是一行取模的事。真的需要圖表套件的是
 * 折線疊圖、雙軸、縮放框選那些——**在還沒有那些需求的時候就先裝，
 * 才是後台專案最典型的技術債**。）
 */
function DailyBars(props: { days: { at: number; stake: number; payout: number }[]; label: string }): React.ReactElement {
    const max = Math.max(1, ...props.days.map((d) => d.stake));
    // 柱子多的時候標籤要抽稀，不然三十個日期會疊成一團黑
    const labelEvery = props.days.length > 14 ? 5 : 1;
    return (
        <Paper sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">{props.label}投注額</Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 130, mt: 1.5 }}>
                {props.days.map((d, i) => {
                    const rate = d.stake > 0 ? d.payout / d.stake : 0;
                    const showLabel = i % labelEvery === 0 || i === props.days.length - 1;
                    return (
                        <Tooltip
                            key={d.at}
                            title={`投注 ${money(d.stake)} · 派彩 ${money(d.payout)} · 派彩率 ${percent(rate)}`}
                        >
                            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, height: '100%', justifyContent: 'flex-end' }}>
                                {/* 柱子的高度不能用百分比。父層是 flex column 且高度由內容決定，
                                    百分比會參照到一個 auto 的高度而算成 0——畫面上就是七根貼在底部的線。
                                    改成算好像素給 height */}
                                <Box
                                    sx={{
                                        width: '100%',
                                        height: Math.max(3, (d.stake / max) * 105),
                                        borderRadius: '3px 3px 0 0',
                                        background: 'linear-gradient(180deg, #e8b84b 0%, #a8802a 100%)',
                                    }}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                                    {showLabel ? `${new Date(d.at).getMonth() + 1}/${new Date(d.at).getDate()}` : '\u00a0'}
                                </Typography>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
        </Paper>
    );
}

/**
 * 儀表板的時間範圍。真實後台一定有這個切換——
 * 營運早上看今日、週會看近 7 日、月報看近 30 日。
 *
 * 三十天這一檔是資料擴充之後才有意義的：**在只有七天資料的時候，
 * 「近 30 日」跟「全部」是同一個數字**，那個選項只會讓人以為報表壞了。
 */
const RANGES = [
    { key: 'today', label: '今日', days: 1 },
    { key: '7d', label: '近 7 日', days: 7 },
    { key: '30d', label: '近 30 日', days: 30 },
] as const;
type Range = (typeof RANGES)[number]['key'];

function rangeDays(r: Range): number {
    return RANGES.find((x) => x.key === r)?.days ?? 7;
}

function rangeStart(r: Range): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // 「近 N 日」含今天，所以往回推 N−1 天的午夜。
    // 用「現在往回推 N×24 小時」的話，區間的頭尾都會切在半天中間，
    // 而長條圖的每一根是自然日——兩者對不起來，加總就跟圖對不上
    return d.getTime() - (rangeDays(r) - 1) * DAY;
}

export function DashboardPage(): React.ReactElement {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribe(() => setRevision((n) => n + 1)), []);

    const [range, setRange] = React.useState<Range>('7d');
    const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';

    // 金流的變動也要重繪：後台審一筆提領，待審那個數字要當場少一筆
    React.useEffect(() => subscribeTx(() => setRevision((n) => n + 1)), []);

    // KPI 跟著範圍走。`all` 是不分範圍的累計，只給側欄那種「總共有多少」用
    const scoped: LedgerStats = React.useMemo(() => stats({ from: rangeStart(range) }), [range, revision]);
    const all: LedgerStats = React.useMemo(() => stats(), [revision]);
    const money$: TxStats = React.useMemo(() => txStats({ from: rangeStart(range) }), [range, revision]);

    // 整體派彩率的偏離判斷。用**有效樣本數**而不是注單筆數——
    // 大戶的單注是苦工的兩百倍，按筆數算會把誤差低估好幾倍（見 baseline.ts）
    const scopedEff = effectiveSample(scoped.totalStake, scoped.totalStakeSq);

    // 近七天逐日彙總。用 query 拉出區間內的注單再自己分桶——
    // 分桶邏輯放在這裡是因為它是**顯示**的需求（時區、一天從幾點算起），
    // 不是資料層該決定的事
    const days = React.useMemo(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const n = rangeDays(range);
        const buckets = Array.from({ length: n }, (_, i) => ({
            at: start.getTime() - (n - 1 - i) * DAY,
            stake: 0,
            payout: 0,
        }));
        const rows = query({ from: buckets[0].at, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows;
        for (const r of rows) {
            const idx = Math.floor((r.settledAt - buckets[0].at) / DAY);
            const b = buckets[idx];
            if (!b) continue;
            b.stake += r.stake;
            b.payout += r.payout;
        }
        return buckets;
    }, [range, revision]);

    return (
        <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6">營運總覽</Typography>
                <Box sx={{ flex: 1 }} />
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={range}
                    onChange={(_, v: Range | null) => v && setRange(v)}
                >
                    {RANGES.map((r) => (
                        <ToggleButton key={r.key} value={r.key}>{r.label}</ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <Kpi label={`${rangeLabel}投注`} value={money(scoped.totalStake)} note={`${money(scoped.count)} 筆注單`} />
                <Kpi label={`${rangeLabel}派彩`} value={money(scoped.totalPayout)} />
                <Kpi
                    label={`${rangeLabel}平台淨收`}
                    value={signedMoney(scoped.grossWin)}
                    tone={scoped.grossWin >= 0 ? 'good' : 'bad'}
                    note="投注 − 派彩"
                />
                <Kpi
                    label={`${rangeLabel}派彩率`}
                    value={scoped.count ? percent(scoped.payoutRate) : '—'}
                    note={`基準 ${percent(BASELINE_OVERALL)} · 有效樣本 ${money(scopedEff)}`}
                    tone={
                        scoped.count === 0
                            ? undefined
                            : deviationLevel(scoped.payoutRate, BASELINE_OVERALL, scopedEff, BASELINE_OVERALL_STD) === 'alert'
                                ? 'bad'
                                : undefined
                    }
                />
                <Kpi label="累計注單" value={money(all.count)} note={`${money(Object.keys(all.byPlayer).length)} 個帳號有紀錄`} />
            </Box>

            {/* 金流。**這排數字跟上面那排來自不同的表**——
                上面是注單（玩家押了多少、平台賠了多少），這裡是資金進出。
                兩者要分開看：一個平台可以「贏了玩家很多」但同時「淨存入是負的」，
                那代表玩家在提領先前存進來的錢，而那是現金流的問題不是遊戲的問題 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <Kpi label={`${rangeLabel}儲值`} value={money(money$.deposit)} note={`${money(money$.count)} 筆交易`} />
                <Kpi label={`${rangeLabel}提領`} value={money(money$.withdraw)} note="已放行的部分" />
                <Kpi
                    label={`${rangeLabel}淨存入`}
                    value={signedMoney(money$.netDeposit)}
                    tone={money$.netDeposit >= 0 ? 'good' : 'bad'}
                    note="儲值 − 提領"
                />
                <Kpi
                    label={`${rangeLabel}返水支出`}
                    value={money(money$.rebate)}
                    note="按有效投注計"
                    tone={money$.rebate > scoped.grossWin ? 'bad' : undefined}
                />
                <Kpi
                    label="待審提領"
                    value={money$.pendingCount ? `${money$.pendingCount} 筆` : '—'}
                    note={money$.pendingCount ? `${money(money$.pendingAmount)} 待處理` : '沒有待處理的申請'}
                    tone={money$.pendingCount ? 'bad' : undefined}
                />
            </Box>

            <DailyBars days={days} label={rangeLabel} />

            <Paper>
                <Box sx={{ px: 2, pt: 2 }}>
                    <Typography variant="caption" color="text.secondary">各玩法表現（{rangeLabel}）</Typography>
                </Box>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>玩法</TableCell>
                            <TableCell align="right">注單數</TableCell>
                            <TableCell align="right">投注額</TableCell>
                            <TableCell align="right">派彩</TableCell>
                            <TableCell align="right">平台淨收</TableCell>
                            <TableCell align="right">派彩率</TableCell>
                            <TableCell align="right">理論值</TableCell>
                            <TableCell align="right">有效樣本</TableCell>
                            <TableCell align="center">偏離</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {GAME_IDS.map((id) => {
                            const g = scoped.byGame[id];
                            if (!g) {
                                return (
                                    <TableRow key={id}>
                                        <TableCell>{GAME_LABEL[id]}</TableCell>
                                        <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary' }}>
                                            尚無注單
                                        </TableCell>
                                    </TableRow>
                                );
                            }
                            const net = g.stake - g.payout;
                            const rate = g.stake > 0 ? g.payout / g.stake : 0;
                            return (
                                <TableRow key={id} hover>
                                    <TableCell><Chip size="small" label={GAME_LABEL[id]} variant="outlined" /></TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.count)}</TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.stake)}</TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.payout)}</TableCell>
                                    <TableCell
                                        align="right"
                                        sx={{ fontFamily: MONO, color: net >= 0 ? 'success.main' : 'error.main' }}
                                    >
                                        {signedMoney(net)}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO }}>{percent(rate)}</TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO, color: 'text.secondary' }}>
                                        {percent(BASELINE_PAYOUT_RATE[id] ?? 0)}
                                    </TableCell>
                                    {/* 有效樣本數擺在偏離判定的左邊，是因為**它是那個判定的分母**。
                                        看到「五千筆注單但有效樣本只有六百」的人，才會知道
                                        右邊那個「樣本內」不是敷衍 */}
                                    <TableCell align="right" sx={{ fontFamily: MONO, color: 'text.secondary' }}>
                                        <Tooltip title={`注單 ${money(g.count)} 筆。有效樣本 = (Σ下注)² ÷ Σ下注²，注額越不均它越小`}>
                                            <span>{money(effectiveSample(g.stake, g.stakeSq))}</span>
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="center">
                                        {(() => {
                                            const base = BASELINE_PAYOUT_RATE[id] ?? 0;
                                            const eff = effectiveSample(g.stake, g.stakeSq);
                                            const lv = deviationLevel(rate, base, eff, BASELINE_BET_STD[id]);
                                            const pp = (rate - base) * 100;
                                            const map = {
                                                normal: { label: '樣本內', color: 'default' as const },
                                                watch: { label: '留意', color: 'warning' as const },
                                                alert: { label: '異常', color: 'error' as const },
                                            };
                                            return (
                                                <Chip
                                                    size="small"
                                                    variant="outlined"
                                                    color={map[lv].color}
                                                    label={`${pp >= 0 ? '+' : ''}${pp.toFixed(1)}pp · ${map[lv].label}`}
                                                    sx={{ height: 20, fontSize: 11, fontFamily: MONO }}
                                                />
                                            );
                                        })()}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Paper>

            <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, lineHeight: 1.9 }}>
                注單由四款玩法真正的規則跑出來（老虎機走 <code>SlotServer.spin()</code>、
                百家樂用真的牌靴與補牌規則、輪盤走同一支 <code>settleBets</code>），
                下注的是四十個有不同行為的帳號——大戶、對沖客、只轉老虎機的苦工，
                他們的籌碼、玩法偏好與活躍度都不一樣（見 <code>admin/seed.ts</code> 的 <code>PERSONA</code>）。
                <br />
                「理論值」欄是拿同一套產生邏輯跑 {money(BASELINE_SAMPLE)} 筆注單算出來的
                （<code>yarn baseline:rtp</code>），不是查表填的——押和局跟押莊的期望值差很遠，
                所以基準線一定要跟玩家實際的下注結構同源。
                <br />
                「有效樣本」不是注單筆數，是 <code>(Σ下注)² ÷ Σ下注²</code>：
                派彩率是<strong>按金額加權</strong>的平均，一千筆 10 元的注加上一筆 10000 元的注，
                筆數是 1001 但可信度接近兩筆。這裡大戶的單注是苦工的兩百倍，
                所以老虎機五千多筆注單的有效樣本只有六百上下。
                <br />
                「偏離」的門檻由<strong>該玩法自己的單注報酬標準差</strong>除以有效樣本數的平方根算出來，
                不是固定的百分點，也不是所有玩法共用一個係數。
                老虎機的標準差是 {BASELINE_BET_STD.slot}、百家樂是 {BASELINE_BET_STD.baccarat}——
                用同一個門檻看這兩款，不是對老虎機誤報，就是對百家樂漏報。
                <br />
                所以這裡會出現「差了十幾個百分點但判定是樣本內」的情況。那不是判斷失靈，
                是這個樣本數本來就分不出訊號與雜訊。
            </Typography>
        </Stack>
    );
}
