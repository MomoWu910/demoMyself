import * as React from 'react';
import {
    Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, MenuItem, Paper, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableHead,
    TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { zhTW } from '@mui/x-data-grid/locales';
import { query as queryLedger, stats as ledgerStats } from '../../arcade/server/ledger';
import {
    list as listPlayers, PROFILE_LABEL, SELF_ID, update as updatePlayer,
    type Player, type PlayerProfile,
} from '../../arcade/server/players';
import { REBATE_RATE, stats as txStats, subscribe as subscribeTx } from '../../arcade/server/txLedger';
import { betTypeLabel, dateTime, GAME_LABEL, money, percent, signedMoney } from '../format';
import { denyReason, useCan, useRole } from '../useAuth';
import { MONO } from '../theme';

/**
 * 玩家管理。
 *
 * ---
 *
 * **這一頁存在的理由，是後台的第一個問題不是「發生了什麼」，是「誰做的」。**
 *
 * 儀表板回答得了「昨天派彩率偏高」，但接下來營運要問的是「誰贏走的」，
 * 而那個問題在只有一個玩家欄位值的資料上問不出來。
 *
 * ---
 *
 * **這一頁最重要的一欄是「有效投注比」。**
 *
 * 它不是一個新指標，是 `validStake ÷ stake` ——兩個既有欄位相除。
 * 正常玩家接近 1（他押多少就承擔多少風險），
 * 押莊又押閒的對沖客會掉到 0.1 以下。
 *
 * 而它之所以是**風控**指標而不只是統計數字，是因為返水按有效投注計算
 * （見 txLedger 的 `rebateFor`）。一個有效投注比 5% 的帳號，
 * 意思是他用二十倍的流水去換同一份返水——如果返水改成按下注額給，
 * 這種押法就從「沒意思」變成「穩定的套利」。
 *
 * **後台不預先幫他貼標籤。** 種子產生的帳號一律沒有標記，
 * 對沖客要靠這一頁自己算出來——一個把答案先寫好的風控頁只是在顯示答案，
 * 不是在做風控。
 */

const DAY = 86_400_000;

const RANGES = [
    { key: '7d', label: '近 7 日', days: 7 },
    { key: '30d', label: '近 30 日', days: 30 },
    { key: 'all', label: '全部', days: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

function rangeFrom(key: RangeKey): number | undefined {
    const r = RANGES.find((x) => x.key === key);
    if (!r || r.days === 0) return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - (r.days - 1) * DAY;
}

/**
 * 有效投注比低於這條線就標成風險帳號。
 *
 * 0.35 這個數字是看著資料訂的，不是抄來的：這份資料裡對沖客落在 4%～8%，
 * 一般玩家最低也有 76%，中間是一段很寬的空白。
 * **門檻要落在空白裡，不是落在分布的中間**——落在中間的門檻會讓
 * 「剛好在線上下的那些人」每天進出風險名單，而那種名單沒有人會看。
 */
const RISK_VALID_RATIO = 0.35;
/** 投注額太小的帳號不判風險。三兩筆注單算出來的比值是雜訊 */
const RISK_MIN_STAKE = 3000;

/** 表格一列 */
interface Row {
    id: string;
    nickname: string;
    profile: PlayerProfile;
    vipLevel: number;
    status: Player['status'];
    tags: string[];
    note: string;
    registeredAt: number;
    count: number;
    stake: number;
    validStake: number;
    validRatio: number;
    /** 平台淨收 = 下注 − 派彩。正數代表平台從這個帳號賺到錢 */
    houseNet: number;
    deposit: number;
    withdraw: number;
    rebate: number;
    lastAt: number;
    risk: boolean;
}

/** 常用的風控標記。做成按鈕是因為**標記要能被統計**，自由填寫會長出十種寫法 */
const PRESET_TAGS = ['對沖', '高流水', '待查', '重點觀察', '已核實'];

function PlayerDialog(props: {
    row: Row | null;
    from: number | undefined;
    onClose: () => void;
    onSaved: (msg: string) => void;
}): React.ReactElement {
    const { row, from, onClose, onSaved } = props;
    const can = useCan();
    const role = useRole();
    const writable = can('player.write');
    const freezable = can('player.freeze');

    // 表單狀態。開啟時從 row 帶入，**關閉不儲存**——
    // 後台的編輯要是明確的動作，滑鼠移開就寫進去的表單沒有人敢用
    const [tags, setTags] = React.useState<string[]>([]);
    const [note, setNote] = React.useState('');
    const [vip, setVip] = React.useState(0);
    const [frozen, setFrozen] = React.useState(false);
    const [confirmFreeze, setConfirmFreeze] = React.useState(false);

    React.useEffect(() => {
        if (!row) return;
        setTags(row.tags);
        setNote(row.note);
        setVip(row.vipLevel);
        setFrozen(row.status === 'frozen');
        setConfirmFreeze(false);
    }, [row]);

    /** 這個帳號的分玩法表現與最近注單。開啟 Dialog 才查，列表不需要這些 */
    const detail = React.useMemo(() => {
        if (!row) return null;
        const s = ledgerStats({ player: row.id, from });
        const recent = queryLedger({ player: row.id, from, pageSize: 8, sortBy: 'settledAt', sortDir: 'desc' }).rows;
        return { byGame: s.byGame, recent };
    }, [row, from]);

    if (!row) return <Dialog open={false} onClose={onClose}><div /></Dialog>;

    const dirty =
        note !== row.note ||
        vip !== row.vipLevel ||
        frozen !== (row.status === 'frozen') ||
        tags.join('|') !== row.tags.join('|');

    const save = (): void => {
        updatePlayer(row.id, { tags, note, vipLevel: vip, status: frozen ? 'frozen' : 'active' });
        onSaved(`${row.nickname} 已更新`);
        onClose();
    };

    return (
        <Dialog open onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontWeight: 600, fontSize: 18 }}>{row.nickname}</Typography>
                    <Chip size="small" variant="outlined" label={PROFILE_LABEL[row.profile]} />
                    <Chip size="small" variant="outlined" label={`VIP ${row.vipLevel}`} />
                    {row.status === 'frozen' && <Chip size="small" color="error" label="已停用" />}
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO }}>
                        {row.id} · 註冊於 {dateTime(row.registeredAt).slice(0, 10)}
                    </Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {/* 統計 */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 2 }}>
                    {[
                        { label: '注單數', value: money(row.count) },
                        { label: '投注額', value: money(row.stake) },
                        { label: '有效投注', value: `${money(row.validStake)}（${percent(row.validRatio, 0)}）` },
                        { label: '平台淨收', value: signedMoney(row.houseNet) },
                        { label: '儲值 / 提領', value: `${money(row.deposit)} / ${money(row.withdraw)}` },
                        { label: '返水支出', value: money(row.rebate) },
                    ].map((x) => (
                        <Box key={x.label}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{x.label}</Typography>
                            <Typography sx={{ fontFamily: MONO, fontSize: 16 }}>{x.value}</Typography>
                        </Box>
                    ))}
                </Box>

                {row.risk && (
                    <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
                        有效投注比只有 {percent(row.validRatio, 0)}，而返水是按有效投注計算的
                        （VIP {row.vipLevel} 的費率 {percent(REBATE_RATE[Math.min(row.vipLevel, REBATE_RATE.length - 1)], 1)}）。
                        這個比值代表他大部分的下注都被同一局裡對立的注區抵銷掉了——
                        點開注單查詢，用局號把同一局撈齊就看得到形狀。
                    </Alert>
                )}

                {/* 風控處置排在明細前面。
                    **這個對話框的目的是處置，明細只是佐證。**
                    第一版把它放在最下面，結果是每次要標記一個帳號都得先捲過
                    四款玩法的統計跟八列注單——而營運一天要處理幾十個帳號。
                    要看佐證的人會往下捲，要動作的人不必 */}
                <Divider sx={{ my: 2 }} />
                <Typography sx={{ fontWeight: 600, mb: 1.5 }}>風控處置</Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                    {PRESET_TAGS.map((tg) => {
                        const on = tags.includes(tg);
                        return (
                            <Chip
                                key={tg}
                                label={tg}
                                size="small"
                                color={on ? 'primary' : 'default'}
                                variant={on ? 'filled' : 'outlined'}
                                onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== tg) : [...prev, tg]))}
                            />
                        );
                    })}
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <TextField
                        label="營運備註"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        multiline
                        minRows={2}
                        sx={{ flex: '1 1 320px' }}
                        // 備註不是可有可無的欄位：標記回答「他怎麼了」，
                        // 備註回答「誰為什麼這樣判斷」，少了後者，三個月後沒有人敢動這個帳號
                        placeholder="例：對沖形態明確，已通知風控組，暫不處置"
                    />
                    <TextField
                        select label="VIP 等級" value={vip} sx={{ width: 150 }}
                        onChange={(e) => setVip(Number(e.target.value))}
                        helperText={`返水 ${percent(REBATE_RATE[Math.min(vip, REBATE_RATE.length - 1)], 1)}`}
                    >
                        {REBATE_RATE.map((rate, lv) => (
                            <MenuItem key={lv} value={lv}>VIP {lv}（{percent(rate, 1)}）</MenuItem>
                        ))}
                    </TextField>
                </Box>

                <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Switch
                            color="error"
                            checked={frozen}
                            disabled={!freezable}
                            onChange={(e) => {
                                // 停用要多按一次。**這是唯一會讓玩家玩不了的操作**，
                                // 而它跟旁邊的「改備註」在畫面上只差一個開關的距離
                                if (e.target.checked) setConfirmFreeze(true);
                                else {
                                    setFrozen(false);
                                    setConfirmFreeze(false);
                                }
                            }}
                        />
                        <Typography variant="body2" color={freezable ? undefined : 'text.disabled'}>停用帳號</Typography>
                        {/* 停用比一般編輯需要更高的權限。**分開的理由寫在 players.update() 裡**：
                            改標記是日常工作，停用是讓玩家玩不了 */}
                        {!freezable && (
                            <Typography variant="caption" color="text.secondary">
                                {denyReason('player.freeze', role)}
                            </Typography>
                        )}
                        {row.id === SELF_ID && (
                            <Typography variant="caption" color="warning.main">
                                這是遊樂場那一頁正在用的帳號——停用之後回去下注會被擋下來
                            </Typography>
                        )}
                    </Box>

                    {confirmFreeze && !frozen && (
                        <Alert
                            severity="error"
                            variant="outlined"
                            sx={{ mt: 1 }}
                            action={
                                <Button color="error" size="small" onClick={() => { setFrozen(true); setConfirmFreeze(false); }}>
                                    確定停用
                                </Button>
                            }
                        >
                            停用之後這個帳號的每一次下注都會被封包層擋下來，並收到「帳號已停用」。
                        </Alert>
                    )}
                </Box>

                <Divider sx={{ my: 3 }} />

                {/* 分玩法 */}
                {detail && Object.keys(detail.byGame).length > 0 && (
                    <>
                        <Typography variant="caption" color="text.secondary">各玩法</Typography>
                        <Table size="small" sx={{ mb: 2, mt: 0.5 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell>玩法</TableCell>
                                    <TableCell align="right">注單數</TableCell>
                                    <TableCell align="right">投注額</TableCell>
                                    <TableCell align="right">派彩</TableCell>
                                    <TableCell align="right">平台淨收</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {Object.entries(detail.byGame).map(([id, g]) => (
                                    <TableRow key={id}>
                                        <TableCell>{GAME_LABEL[id as keyof typeof GAME_LABEL] ?? id}</TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.count)}</TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.stake)}</TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(g.payout)}</TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{ fontFamily: MONO, color: g.stake - g.payout >= 0 ? 'success.main' : 'error.main' }}
                                        >
                                            {signedMoney(g.stake - g.payout)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </>
                )}

                {/* 最近注單 */}
                {detail && detail.recent.length > 0 && (
                    <>
                        <Typography variant="caption" color="text.secondary">最近的注單</Typography>
                        <Table size="small" sx={{ mb: 2, mt: 0.5 }}>
                            <TableBody>
                                {detail.recent.map((r) => (
                                    <TableRow key={r.id}>
                                        <TableCell sx={{ fontFamily: MONO, whiteSpace: 'nowrap' }}>{dateTime(r.settledAt)}</TableCell>
                                        <TableCell>{GAME_LABEL[r.game]}</TableCell>
                                        <TableCell>{betTypeLabel(r.betType)}</TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(r.stake)}</TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{ fontFamily: MONO, color: r.validStake < r.stake ? 'warning.main' : 'text.secondary' }}
                                        >
                                            有效 {money(r.validStake)}
                                        </TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{ fontFamily: MONO, color: r.net > 0 ? 'success.main' : r.net < 0 ? 'error.main' : 'text.secondary' }}
                                        >
                                            {signedMoney(r.net)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </>
                )}

            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Tooltip title={writable ? '' : denyReason('player.write', role)}>
                    <span>
                        <Button variant="contained" disabled={!writable || !dirty} onClick={save}>儲存</Button>
                    </span>
                </Tooltip>
            </DialogActions>
        </Dialog>
    );
}

export function PlayersPage(): React.ReactElement {
    const [range, setRange] = React.useState<RangeKey>('30d');
    const [profile, setProfile] = React.useState<PlayerProfile | 'all'>('all');
    const [riskOnly, setRiskOnly] = React.useState(false);
    const [search, setSearch] = React.useState<Player | null>(null);
    const [detail, setDetail] = React.useState<Row | null>(null);
    const [toast, setToast] = React.useState('');
    const [revision, setRevision] = React.useState(0);

    React.useEffect(() => subscribeTx(() => setRevision((n) => n + 1)), []);

    const from = rangeFrom(range);

    /**
     * 名冊只讀一次。
     *
     * **`options={listPlayers()}` 直接寫在 JSX 裡會讓頁面卡死。**
     * 那個呼叫每次繪製都回一個新陣列，Autocomplete 拿到新的 options 就重新計算、
     * 再觸發一次繪製——一個不會停的迴圈，而症狀是分頁整個沒有反應，
     * 不是錯誤訊息。React 裡「每次繪製都產生新的物件」是這類當機最常見的來源。
     */
    const roster = React.useMemo(() => listPlayers(), [revision]);

    /**
     * 把三張表併成一列一列。
     *
     * 三次查詢就夠：名冊一次、注單彙總一次、金流彙總一次。
     * **不是每個玩家各查一次**——那在四十個帳號時只是慢，
     * 在四萬個帳號時是一百二十次查詢，而且每一次都要掃全表。
     */
    const rows = React.useMemo<Row[]>(() => {
        const bets = ledgerStats({ from });
        const txs = txStats({ from });

        return roster.map((p) => {
            const b = bets.byPlayer[p.id] ?? { count: 0, stake: 0, validStake: 0, payout: 0, lastAt: 0 };
            const t = txs.byPlayer[p.id] ?? { deposit: 0, withdraw: 0, rebate: 0, adjust: 0, pendingCount: 0 };
            const validRatio = b.stake > 0 ? b.validStake / b.stake : 1;
            return {
                id: p.id,
                nickname: p.nickname,
                profile: p.profile,
                vipLevel: p.vipLevel,
                status: p.status,
                tags: p.tags,
                note: p.note,
                registeredAt: p.registeredAt,
                count: b.count,
                stake: b.stake,
                validStake: b.validStake,
                validRatio,
                houseNet: b.stake - b.payout,
                deposit: t.deposit,
                withdraw: t.withdraw,
                rebate: t.rebate,
                lastAt: b.lastAt,
                risk: b.stake >= RISK_MIN_STAKE && validRatio < RISK_VALID_RATIO,
            };
        });
    }, [from, roster]);

    const visible = React.useMemo(() => {
        let out = rows;
        if (profile !== 'all') out = out.filter((r) => r.profile === profile);
        if (riskOnly) out = out.filter((r) => r.risk);
        if (search) out = out.filter((r) => r.id === search.id);
        return out;
    }, [rows, profile, riskOnly, search]);

    const riskCount = rows.filter((r) => r.risk).length;
    const frozenCount = rows.filter((r) => r.status === 'frozen').length;
    const activeCount = rows.filter((r) => r.count > 0).length;

    /**
     * 這裡的排序是 **client 端**的，跟注單頁相反。
     *
     * 不是不一致，是資料的形狀不同：注單是百萬列、要分頁，所以排序必須下推到資料層；
     * 玩家彙總是一次算完的幾十列，全部都在手上。
     * **對已經在記憶體裡的完整結果集再做一次 server 往返，是把架構原則套錯地方。**
     */
    const columns = React.useMemo<GridColDef<Row>[]>(() => [
        {
            field: 'nickname', headerName: '玩家', width: 190,
            renderCell: (p) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
                    <span>{p.row.nickname}</span>
                    {p.row.status === 'frozen' && <Chip size="small" color="error" label="停用" sx={{ height: 18, fontSize: 10 }} />}
                    {p.row.tags.map((tg) => (
                        <Chip key={tg} size="small" variant="outlined" label={tg} sx={{ height: 18, fontSize: 10 }} />
                    ))}
                </Box>
            ),
        },
        {
            field: 'profile', headerName: '分型', width: 80,
            valueGetter: (v: PlayerProfile) => PROFILE_LABEL[v],
        },
        { field: 'vipLevel', headerName: 'VIP', width: 62, align: 'center', headerAlign: 'center', cellClassName: 'mono' },
        {
            field: 'count', headerName: '注單數', width: 84, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono',
        },
        {
            field: 'stake', headerName: '投注額', width: 100, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono',
        },
        {
            field: 'validRatio', headerName: '有效投注比', width: 108, align: 'right', headerAlign: 'right',
            renderCell: (p) => (
                <Tooltip title={`有效投注 ${money(p.row.validStake)} ÷ 投注額 ${money(p.row.stake)}`}>
                    <span style={{ fontFamily: MONO, color: p.row.risk ? '#e56b6f' : undefined }}>
                        {p.row.stake > 0 ? percent(p.row.validRatio, 0) : '—'}
                    </span>
                </Tooltip>
            ),
        },
        {
            field: 'houseNet', headerName: '平台淨收', width: 104, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => signedMoney(v),
            cellClassName: (p) => `mono ${p.row.houseNet >= 0 ? 'win' : 'loss'}`,
        },
        {
            field: 'deposit', headerName: '儲值', width: 92, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono muted',
        },
        {
            field: 'withdraw', headerName: '提領', width: 92, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono muted',
        },
        {
            field: 'rebate', headerName: '返水', width: 84, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono muted',
        },
        {
            // 給 flex 而不是固定寬度，最後一欄才不會在寬螢幕上留下一條空的欄位。
            // minWidth 190 是等寬字下「2026-09-06 22:09:41」放得下的寬度——
            // 給 168 會把秒切成「22:09:…」
            field: 'lastAt', headerName: '最後活動', flex: 1, minWidth: 190,
            valueFormatter: (v: number) => (v ? dateTime(v) : '—'),
            cellClassName: 'mono muted',
        },
    ], []);

    return (
        <Stack spacing={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6">玩家管理</Typography>
                <Box sx={{ flex: 1 }} />
                <ToggleButtonGroup
                    size="small" exclusive value={range}
                    onChange={(_, v: RangeKey | null) => v && setRange(v)}
                >
                    {RANGES.map((r) => <ToggleButton key={r.key} value={r.key}>{r.label}</ToggleButton>)}
                </ToggleButtonGroup>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {[
                    { label: '帳號總數', value: money(rows.length), note: `${money(activeCount)} 個在這段期間有下注` },
                    { label: '風險帳號', value: money(riskCount), note: `有效投注比 < ${percent(RISK_VALID_RATIO, 0)}`, bad: riskCount > 0 },
                    { label: '停用帳號', value: money(frozenCount), note: frozenCount ? '下注會被封包層擋下' : '目前沒有' },
                    { label: '返水支出', value: money(rows.reduce((s, r) => s + r.rebate, 0)), note: '這段期間累計' },
                ].map((k) => (
                    <Paper key={k.label} sx={{ p: 2, flex: '1 1 190px', minWidth: 190 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.05em' }}>{k.label}</Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 600, lineHeight: 1.3, mt: 0.5, color: k.bad ? 'error.main' : 'text.primary' }}>
                            {k.value}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">{k.note}</Typography>
                    </Paper>
                ))}
            </Box>

            <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                    {/* Autocomplete 而不是下拉：**帳號名冊是會長大的東西**。
                        四十個用下拉還可以捲，四百個就只能靠打字找了，
                        而那時候再換元件，整個篩選狀態的形狀都要跟著改 */}
                    <Autocomplete<Player>
                        options={roster}
                        value={search}
                        onChange={(_, v) => setSearch(v)}
                        getOptionLabel={(o) => o.nickname}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        sx={{ width: 260 }}
                        renderInput={(p) => <TextField {...p} label="搜尋玩家" placeholder="輸入暱稱" />}
                        renderOption={(p, o) => {
                            const { key, ...rest } = p as React.HTMLAttributes<HTMLLIElement> & { key: string };
                            return (
                                <li key={key} {...rest}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <span>{o.nickname}</span>
                                        <Box sx={{ flex: 1 }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {PROFILE_LABEL[o.profile]} · VIP {o.vipLevel}
                                        </Typography>
                                    </Box>
                                </li>
                            );
                        }}
                    />

                    <TextField
                        select label="分型" value={profile} sx={{ minWidth: 130 }}
                        onChange={(e) => setProfile(e.target.value as PlayerProfile | 'all')}
                    >
                        <MenuItem value="all">全部分型</MenuItem>
                        {(Object.keys(PROFILE_LABEL) as PlayerProfile[]).map((k) => (
                            <MenuItem key={k} value={k}>{PROFILE_LABEL[k]}</MenuItem>
                        ))}
                    </TextField>

                    <Button
                        size="small"
                        variant={riskOnly ? 'contained' : 'outlined'}
                        color={riskOnly ? 'error' : 'primary'}
                        onClick={() => setRiskOnly((v) => !v)}
                    >
                        只看風險帳號{riskCount > 0 ? `（${riskCount}）` : ''}
                    </Button>

                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" color="text.secondary">共 {money(visible.length)} 個帳號</Typography>
                </Box>
            </Paper>

            <Paper sx={{ height: 'calc(100vh - 420px)', minHeight: 340 }}>
                <DataGrid<Row>
                    rows={visible}
                    columns={columns}
                    localeText={zhTW.components.MuiDataGrid.defaultProps.localeText}
                    density="compact"
                    disableColumnFilter
                    disableRowSelectionOnClick
                    initialState={{
                        // 預設按投注額排序：營運打開這一頁想看的是「量最大的那幾個」，
                        // 不是「編號最小的那幾個」
                        sorting: { sortModel: [{ field: 'stake', sort: 'desc' }] },
                        pagination: { paginationModel: { pageSize: 25 } },
                    }}
                    pageSizeOptions={[25, 50, 100]}
                    onRowClick={(p) => setDetail(p.row)}
                    getRowClassName={(p) => (p.row.status === 'frozen' ? 'frozen-row' : '')}
                    sx={{
                        border: 0,
                        cursor: 'pointer',
                        '& .mono': { fontFamily: MONO },
                        '& .muted': { color: 'text.secondary' },
                        '& .win': { color: 'success.main' },
                        '& .loss': { color: 'error.main' },
                        '& .frozen-row': { opacity: 0.55 },
                        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, letterSpacing: '0.03em' },
                    }}
                />
            </Paper>

            <PlayerDialog
                row={detail}
                from={from}
                onClose={() => setDetail(null)}
                onSaved={(m) => { setToast(m); setRevision((n) => n + 1); }}
            />

            <Snackbar
                open={Boolean(toast)}
                autoHideDuration={3000}
                onClose={() => setToast('')}
                message={toast}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Stack>
    );
}
