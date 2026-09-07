import * as React from 'react';
import {
    Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-tw';
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
                                        // 走 palette 而不是寫死金色：亮色模式的 primary 是壓深過的，
                                        // 寫死的話白底上會出現一根讀不出來的淺色柱子
                                        background: (t) => `linear-gradient(180deg, ${t.palette.primary.main} 0%, ${alpha(t.palette.primary.main, 0.65)} 100%)`,
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
 *
 * 第四個選項是自訂區間。快捷鍵解決九成的情況，
 * 但**剩下那一成是「上個月的對帳單對不起來，我要看 3/12 到 3/18」**——
 * 那種需求沒有快捷鍵可以涵蓋。
 */
const RANGES = [
    { key: 'today', label: '今日', days: 1 },
    { key: '7d', label: '近 7 日', days: 7 },
    { key: '30d', label: '近 30 日', days: 30 },
    { key: 'custom', label: '自訂', days: 0 },
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

/** 熱區圖固定看幾天。四週＝每個星期幾各四筆樣本，剛好夠看出形狀又不會拖太久 */
const HEAT_DAYS = 28;

/**
 * 「還沒到」的斜線底紋。
 *
 * 用底紋而不是換顏色，是因為**顏色這個維度已經被用掉了**——
 * 深淺代表投注量。再拿顏色去表達第二件事，兩個訊息就會互相干擾：
 * 一個淺色的格子到底是「量少」還是「還沒到」？
 * 圖案是另一個維度，疊上去不會搶走色階的意思。
 */
const HATCH = 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,0.14) 3px 6px)';

/**
 * 時段熱區：星期 × 小時。
 *
 * ---
 *
 * **這張圖回答的是長條圖答不了的問題：人什麼時候來。**
 *
 * 逐日長條圖看得到「哪一天量大」，但排班、推播時間、維護視窗要看的是
 * 「禮拜幾的幾點量大」——而那兩件事在同一份資料裡，只是分桶方式不同。
 *
 * ---
 *
 * **它刻意不跟著上方的時間範圍走，固定看近 28 天。**
 *
 * 第一版讓它跟著範圍，結果在「近 7 日」下會出現一列幾乎全空的格子，
 * 而那看起來完全像壞掉了。真因有兩層：
 * 1. 七天的區間裡**每個星期幾只有一天**，所以「週一」那一列就只有那一天
 * 2. 而那一天如果剛好是今天，它還沒過完——種子只灌到「當下」為止
 *    （見 admin/seed.ts 的 `elapsed`：一天才剛開始就灌滿全天的量，
 *    「今日投注」會比昨天還高，那是假的）
 *
 * 加提示文字只是把症狀說出來，沒有解決它。真正的問題是**問錯了問題**：
 * 這張圖問的是「通常什麼時候人多」，那跟使用者現在篩的是哪七天無關。
 * 所以它自己決定要看多久——四週，每個星期幾各四筆樣本。
 *
 * 一樣不裝圖表套件：7×24 個格子加一個色階，CSS grid 就做得完。
 * 而格子圖最麻煩的部分本來就不是繪製，是色階——
 * 線性色階會讓少數幾個尖峰把其他格子全部壓成同一個顏色。
 */
function HourHeatmap(props: { cells: number[][]; max: number }): React.ReactElement {
    const { cells, max } = props;
    const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

    /**
     * 今天還沒過完的那些格子要標出來。
     *
     * **不是整列標，是只標「還沒到的那幾個小時」。**
     *
     * 因為在 28 天的視窗裡，今天那一列還疊著前三週同一個星期幾的資料——
     * 「週一 15 點」這一格有 8/17、8/24、8/31 三筆，只是少了今天那一筆。
     * 把整列標成「進行中」會誤導成「這一列都不能看」，而它其實只是少四分之一的樣本。
     *
     * 這是資料視覺化的一條通則：**未完成的區間要看得出來是未完成，
     * 而它跟「這裡是零」是兩件完全不同的事。**
     */
    const now = new Date();
    const todayDow = now.getDay();
    const nowHour = now.getHours();

    /**
     * 色階用平方根，不是線性。
     *
     * 投注量的分布是長尾的：深夜幾乎沒有人，尖峰時段是它的幾十倍。
     * 線性映射的結果是**整張圖只有兩三格是亮的，其餘全黑**——
     * 那張圖看起來很乾淨，但它把「凌晨三點跟下午三點的差別」也一起抹掉了。
     * 開根號把低端拉開，代價是高端被壓縮，而高端本來就看得出來。
     */
    const intensity = (v: number): number => (max <= 0 ? 0 : Math.sqrt(v / max));

    return (
        <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                    投注時段分布（星期 × 小時）
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    固定看近 {HEAT_DAYS} 天，不跟著上面的時間範圍——
                    「週三下午通常如何」這個問題，跟你現在篩的是哪幾天無關
                </Typography>
                <Box sx={{ flex: 1 }} />
                {/* 圖例。斜線是什麼意思要說出來，不然它只是一個看不懂的花紋 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box
                        sx={{
                            width: 14, height: 14, borderRadius: '2px',
                            background: (t) => alpha(t.palette.text.primary, 0.05),
                            backgroundImage: HATCH,
                        }}
                    />
                    <Typography variant="caption" color="text.disabled">今天還沒到的時段</Typography>
                </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateRows: 'repeat(7, 18px)', gap: '2px', mr: 0.5 }}>
                    {WEEK.map((w) => (
                        <Typography key={w} variant="caption" sx={{ fontSize: 10, lineHeight: '18px', color: 'text.secondary' }}>
                            {w}
                        </Typography>
                    ))}
                </Box>
                <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gridTemplateRows: 'repeat(7, 18px)', gap: '2px' }}>
                        {cells.map((rowCells, day) =>
                            rowCells.map((v, hour) => {
                                // 今天、而且這個小時還沒到 → 這一格少了今天那一份樣本
                                const pending = day === todayDow && hour > nowHour;
                                return (
                                    <Tooltip
                                        key={`${day}-${hour}`}
                                        title={pending
                                            ? `週${WEEK[day]} ${hour}:00 — 投注 ${money(v)}（今天這個時段還沒到，只有前 ${Math.floor(HEAT_DAYS / 7) - 1} 週的資料）`
                                            : `週${WEEK[day]} ${hour}:00 — 投注 ${money(v)}`}
                                    >
                                        <Box
                                            sx={{
                                                borderRadius: '2px',
                                                background: (t) => (v > 0
                                                    ? alpha(t.palette.primary.main, 0.08 + intensity(v) * 0.92)
                                                    : alpha(t.palette.text.primary, 0.05)),
                                                backgroundImage: pending ? HATCH : undefined,
                                            }}
                                        />
                                    </Tooltip>
                                );
                            }),
                        )}
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: '2px', mt: 0.5 }}>
                        {Array.from({ length: 24 }, (_, h) => (
                            <Typography key={h} variant="caption" sx={{ fontSize: 9, color: 'text.secondary', textAlign: 'center' }}>
                                {h % 3 === 0 ? h : '\u00a0'}
                            </Typography>
                        ))}
                    </Box>
                </Box>
            </Box>
        </Paper>
    );
}

export function DashboardPage(): React.ReactElement {
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribe(() => setRevision((n) => n + 1)), []);

    const [range, setRange] = React.useState<Range>('7d');
    // 自訂區間的預設值給「上週那七天」而不是空的——**空的日期欄位需要按兩次才看得到東西**，
    // 而使用者切到「自訂」時想看的通常就是最近某一段
    const [customFrom, setCustomFrom] = React.useState<Dayjs | null>(() => dayjs().subtract(13, 'day').startOf('day'));
    const [customTo, setCustomTo] = React.useState<Dayjs | null>(() => dayjs().subtract(7, 'day').endOf('day'));

    const custom = range === 'custom';
    const from = custom ? (customFrom?.startOf('day').valueOf() ?? 0) : rangeStart(range);
    // 結束時間取當天的 23:59:59.999。**取當天 00:00 的話那一整天都不會被算進去**，
    // 而使用者選的是「到 3/18」，他要的是含 3/18
    const to = custom ? customTo?.endOf('day').valueOf() : undefined;

    const rangeLabel = custom
        ? `${customFrom?.format('M/D') ?? ''}–${customTo?.format('M/D') ?? ''}`
        : RANGES.find((r) => r.key === range)?.label ?? '';

    // 金流的變動也要重繪：後台審一筆提領，待審那個數字要當場少一筆
    React.useEffect(() => subscribeTx(() => setRevision((n) => n + 1)), []);

    // KPI 跟著範圍走。`all` 是不分範圍的累計，只給側欄那種「總共有多少」用
    const scoped: LedgerStats = React.useMemo(() => stats({ from, to }), [from, to, revision]);
    const all: LedgerStats = React.useMemo(() => stats(), [revision]);
    const money$: TxStats = React.useMemo(() => txStats({ from, to }), [from, to, revision]);

    // 整體派彩率的偏離判斷。用**有效樣本數**而不是注單筆數——
    // 大戶的單注是苦工的兩百倍，按筆數算會把誤差低估好幾倍（見 baseline.ts）
    const scopedEff = effectiveSample(scoped.totalStake, scoped.totalStakeSq);

    // 近七天逐日彙總。用 query 拉出區間內的注單再自己分桶——
    // 分桶邏輯放在這裡是因為它是**顯示**的需求（時區、一天從幾點算起），
    // 不是資料層該決定的事
    /**
     * 逐日分桶。跟著上方選的時間範圍走。
     *
     * （這裡原本跟熱區圖共用一次查詢，理由是「兩張圖看同一批注單，
     * 各查一次會對不起來」。熱區圖改成固定 28 天之後那個理由就不成立了——
     * **它們本來就在看不同的區間**，共用查詢反而是錯的。）
     */
    const days = React.useMemo(() => {
        const startDay = new Date(from);
        startDay.setHours(0, 0, 0, 0);
        const spanDays = custom
            ? Math.max(1, Math.round(((to ?? Date.now()) - startDay.getTime()) / DAY))
            : rangeDays(range);

        const buckets = Array.from({ length: spanDays }, (_, i) => ({
            at: startDay.getTime() + i * DAY,
            stake: 0,
            payout: 0,
        }));

        for (const r of query({ from, to, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows) {
            const b = buckets[Math.floor((r.settledAt - buckets[0].at) / DAY)];
            if (!b) continue;
            b.stake += r.stake;
            b.payout += r.payout;
        }
        return buckets;
    }, [from, to, custom, range, revision]);

    /**
     * 時段熱區。**固定近 28 天，不看上方的時間範圍**（理由見 `HourHeatmap`）。
     *
     * 所以它的相依只有 `revision`——切換今日／近 7 日／自訂區間都不會讓它重算，
     * 而那正是它該有的行為：「週三下午通常如何」跟你現在篩哪幾天無關。
     */
    const { heat, heatMax } = React.useMemo(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const heatFrom = start.getTime() - (HEAT_DAYS - 1) * DAY;

        const cells: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
        let max = 0;
        for (const r of query({ from: heatFrom, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows) {
            const d = new Date(r.settledAt);
            const cell = cells[d.getDay()];
            cell[d.getHours()] += r.stake;
            if (cell[d.getHours()] > max) max = cell[d.getHours()];
        }
        return { heat: cells, heatMax: max };
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
                    {RANGES.map((r) => (
                        <ToggleButton key={r.key} value={r.key}>{r.label}</ToggleButton>
                    ))}
                </ToggleButtonGroup>
            </Box>

            {/* 自訂區間。**只有選了「自訂」才出現**——
                四個快捷鍵旁邊常駐兩個日期欄位，會讓九成只想看「今日」的人
                每次都要先掃過兩個不相干的輸入框 */}
            {custom && (
                <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="zh-tw">
                    <Paper sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <DatePicker
                            label="起" value={customFrom} onChange={setCustomFrom}
                            slotProps={{ textField: { size: 'small' } }}
                            // 起日不能晚於訖日。**在元件上擋，不是等使用者按下查詢才報錯**
                            maxDate={customTo ?? undefined}
                        />
                        <Typography color="text.secondary">—</Typography>
                        <DatePicker
                            label="訖" value={customTo} onChange={setCustomTo}
                            slotProps={{ textField: { size: 'small' } }}
                            minDate={customFrom ?? undefined}
                            disableFuture
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 460, lineHeight: 1.7 }}>
                            MUI X 的 <code>DateRangePicker</code>（單一元件選一段區間）是付費版的元件，
                            這裡用兩個 MIT 版的 <code>DatePicker</code> 組出同樣的能力——
                            少了拖曳選取的手感，換來的是不必為了一個日期欄位付授權費。
                        </Typography>
                    </Paper>
                </LocalizationProvider>
            )}

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

            <HourHeatmap cells={heat} max={heatMax} />

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
