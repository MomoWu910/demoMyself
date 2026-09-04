import * as React from 'react';
import {
    Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { query, stats, subscribe, type LedgerStats } from '../../arcade/server/ledger';
import { BASELINE_OVERALL, BASELINE_PAYOUT_RATE, BASELINE_SAMPLE, deviationLevel } from '../baseline';
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
 * 近七天的長條圖。
 *
 * 刻意不裝圖表套件。這張圖要表達的東西只有「哪一天量比較大」，
 * 一個 flex 容器加幾個 div 就做得完——為了它多背一個 300KB 的相依，
 * 在後台這種要長期維護的專案裡不划算。
 */
function DailyBars(props: { days: { at: number; stake: number; payout: number }[] }): React.ReactElement {
    const max = Math.max(1, ...props.days.map((d) => d.stake));
    return (
        <Paper sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">近 7 日投注額</Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 130, mt: 1.5 }}>
                {props.days.map((d) => {
                    const rate = d.stake > 0 ? d.payout / d.stake : 0;
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
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                                    {new Date(d.at).getMonth() + 1}/{new Date(d.at).getDate()}
                                </Typography>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
        </Paper>
    );
}

/** 儀表板的時間範圍。真實後台一定有這個切換——營運早上看今日、週會看近 7 日 */
type Range = 'today' | '7d';

function rangeStart(r: Range): number {
    if (r === '7d') return Date.now() - 7 * DAY;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function DashboardPage(): React.ReactElement {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribe(() => setRevision((n) => n + 1)), []);

    const [range, setRange] = React.useState<Range>('7d');
    const rangeLabel = range === 'today' ? '今日' : '近 7 日';

    // KPI 跟著範圍走。`all` 是不分範圍的累計，只給側欄那種「總共有多少」用
    const scoped: LedgerStats = React.useMemo(() => stats({ from: rangeStart(range) }), [range, revision]);
    const all: LedgerStats = React.useMemo(() => stats(), [revision]);

    // 近七天逐日彙總。用 query 拉出區間內的注單再自己分桶——
    // 分桶邏輯放在這裡是因為它是**顯示**的需求（時區、一天從幾點算起），
    // 不是資料層該決定的事
    const days = React.useMemo(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const buckets = Array.from({ length: 7 }, (_, i) => ({
            at: start.getTime() - (6 - i) * DAY,
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
    }, [revision]);

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
                    <ToggleButton value="today">今日</ToggleButton>
                    <ToggleButton value="7d">近 7 日</ToggleButton>
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
                    note={`基準 ${percent(BASELINE_OVERALL)} · ${money(scoped.count)} 筆`}
                    tone={
                        scoped.count === 0
                            ? undefined
                            : deviationLevel(scoped.payoutRate, BASELINE_OVERALL, scoped.count) === 'alert'
                                ? 'bad'
                                : undefined
                    }
                />
                <Kpi label="累計注單" value={money(all.count)} note="保留最近 7 日" />
            </Box>

            <DailyBars days={days} />

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
                                        <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary' }}>
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
                                    <TableCell align="center">
                                        {(() => {
                                            const base = BASELINE_PAYOUT_RATE[id] ?? 0;
                                            const lv = deviationLevel(rate, base, g.count);
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
                百家樂用真的牌靴與補牌規則、輪盤走同一支 <code>settleBets</code>）。
                <br />
                「理論值」欄是拿同一套產生邏輯跑 {money(BASELINE_SAMPLE)} 筆注單算出來的
                （<code>yarn baseline:rtp</code>），不是查表填的——押和局跟押莊的期望值差很遠，
                所以基準線一定要跟玩家實際的下注結構同源。
                <br />
                「偏離」的門檻隨樣本數變動，不是固定的百分點：一百筆偏 10 個百分點是常態，
                十萬筆偏 2 個百分點才值得看。用固定門檻的報表會在資料少的時候一直誤報。
                <br />
                所以這裡會出現「差了十幾個百分點但判定是樣本內」的情況——那不是判斷失靈，
                是這個樣本數本來就分不出訊號與雜訊。老虎機尤其明顯：它的單注變異最大
                （中獎率三成、但有大獎），要看出真的異常需要的局數比其他玩法多一個量級。
            </Typography>
        </Stack>
    );
}
