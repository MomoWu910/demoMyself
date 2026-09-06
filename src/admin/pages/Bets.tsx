import * as React from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    MenuItem, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    TextField, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import {
    DataGrid,
    type GridColDef,
    type GridPaginationModel,
    type GridSortModel,
} from '@mui/x-data-grid';
import { zhTW } from '@mui/x-data-grid/locales';
import type { GameId } from '../../arcade/net/protocol';
import {
    query as queryLedger, subscribe, voidBet,
    type BetRecord, type LedgerPage, type LedgerQuery,
} from '../../arcade/server/ledger';
import { list as listPlayers, SELF_ID } from '../../arcade/server/players';
import { betTypeLabel, dateTime, GAME_IDS, GAME_LABEL, money, signedMoney } from '../format';
import { MONO } from '../theme';

/**
 * 注單查詢。
 *
 * **這一頁的重點不是表格長什麼樣，是查詢是誰做的。**
 *
 * 篩選、排序、分頁全部送給 `ledger.query()` 處理，這一頁只拿回一頁的資料加上總數，
 * 拿到什麼就畫什麼——沒有任何一行 `rows.filter()`。
 *
 * 在這個 demo 裡看起來是多此一舉，因為資料就在同一支程式的記憶體裡。
 * 但真實的注單表是百萬列起跳，**「全部撈回前端再過濾」在那個量級會直接讓瀏覽器死掉**，
 * 而且這種寫法在資料量小的時候完全正常，等到資料長大才爆——那時候要改的
 * 不只是一行 filter，是整頁的狀態管理。
 *
 * ---
 *
 * **換成 DataGrid 之後，這個決定收到了回報。**
 *
 * `DataGrid` 有 `paginationMode="server"` 與 `sortingMode="server"` 兩個開關，
 * 打開之後它就不再自己分頁排序，而是把「使用者想看第幾頁、想按哪一欄排」
 * 當成事件丟出來，等你把資料餵回去。**那正是 `LedgerQuery` 本來的形狀**，
 * 所以接線只是把事件的參數轉成查詢條件，沒有一層轉接層。
 *
 * 反過來說，如果當初把篩選寫在前端，這裡就得在「讓 DataGrid 自己算（但只有一頁資料）」
 * 跟「把百萬列全部餵給它」之間二選一，而兩個都是錯的。
 */

const PAGE_SIZES = [25, 50, 100];

/** 時間快捷。營運看注單九成是看「今天」跟「近七天」，做成按鈕比讓人選日期快 */
const RANGES = [
    { key: 'today', label: '今日' },
    { key: '7d', label: '近 7 天' },
    { key: '30d', label: '近 30 天' },
    { key: 'all', label: '全部' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

function rangeToFrom(key: RangeKey): number | undefined {
    if (key === 'all') return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (key === '7d') return d.getTime() - 6 * 86_400_000;
    if (key === '30d') return d.getTime() - 29 * 86_400_000;
    return d.getTime();
}

/**
 * 匯出目前這組條件的**全部**注單成 CSV。
 *
 * ---
 *
 * **這裡有一個 server 分頁一定會踩到的坑。**
 *
 * DataGrid 內建的匯出功能匯的是「grid 手上有的那些列」。
 * 在 client 模式那等於全部，但在 server 模式那只有**當前這一頁**——
 * 營運按了匯出，拿到 25 列，而畫面上明明寫著三千筆。
 * 更糟的是它不會報錯，那 25 列看起來完全正常。
 *
 * 所以匯出要自己來：用同一組篩選條件、把分頁拿掉再查一次。
 * 這也是為什麼 `query()` 的 `pageSize` 不設上限——
 * 匯出就是那個「我真的要全部」的合法場景。
 */
function exportCsv(params: LedgerQuery, nameOf: (id: string) => string): void {
    const all = queryLedger({ ...params, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows;

    const header = ['注單號', '結算時間', '玩家ID', '玩家', '玩法', '注別', '下注', '有效投注', '派彩', '輸贏', '結算後餘額', '局號'];
    const lines = all.map((r) => [
        r.id,
        dateTime(r.settledAt),
        r.player,
        nameOf(r.player),
        GAME_LABEL[r.game],
        betTypeLabel(r.betType),
        // **金額不帶千分位。** 畫面上的 1,234 是給人看的，
        // 匯出的檔案是拿去試算表裡加總的——逗號會讓它變成文字，整欄都算不了
        r.stake,
        r.validStake,
        r.payout,
        r.net,
        r.balanceAfter,
        r.roundId,
    ]);

    /** CSV 逃脫：有逗號、引號或換行的欄位要包引號，引號本身要重複一次 */
    const esc = (v: string | number): string => {
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...lines].map((row) => row.map(esc).join(',')).join('\r\n');

    // **開頭那三個位元組是 BOM，不能省。** 少了它，Excel 會用系統預設編碼
    // 去讀這個 UTF-8 檔案，中文欄位全部變亂碼——而使用者只會說「你的匯出壞了」
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `注單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // 不撤銷的話這塊記憶體會留到分頁關閉為止。匯出幾次看不出來，
    // 但後台是開一整天的頁面
    URL.revokeObjectURL(url);
}

/**
 * 單筆注單的詳情。
 *
 * **它真正的內容不是「這一筆」，是「這一局」。**
 *
 * 客訴進來的時候問的是「我那把為什麼輸」，而答案常常不在那一筆裡——
 * 他同一局還押了別的注區，或者那是一組對沖注。
 * 只顯示點到的那一列，等於把最重要的上下文擋在外面。
 *
 * 這也是 `roundId` 這個欄位存在的理由：同一局的注單共用它，
 * 所以「把這一局撈齊」是一次查詢，不是把全部注單拉回來比對時間。
 */
function RoundDialog(props: {
    row: BetRecord | null;
    nameOf: (id: string) => string;
    onClose: () => void;
    onVoided: (msg: string) => void;
}): React.ReactElement {
    const { row, nameOf, onClose, onVoided } = props;
    const [voiding, setVoiding] = React.useState(false);
    const [reason, setReason] = React.useState('');

    React.useEffect(() => {
        setVoiding(false);
        setReason('');
    }, [row]);

    const siblings = React.useMemo(
        () => (row ? queryLedger({ roundId: row.roundId, pageSize: 100, sortBy: 'stake', sortDir: 'desc' }).rows : []),
        [row],
    );

    const sum = siblings.reduce(
        (acc, r) => ({
            stake: acc.stake + r.stake,
            valid: acc.valid + r.validStake,
            payout: acc.payout + r.payout,
            net: acc.net + r.net,
        }),
        { stake: 0, valid: 0, payout: 0, net: 0 },
    );
    const validRatio = sum.stake > 0 ? sum.valid / sum.stake : 1;

    return (
        <Dialog open={Boolean(row)} onClose={onClose} maxWidth="md" fullWidth>
            {row && (
                <>
                    <DialogTitle sx={{ pb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                            <Chip size="small" label={GAME_LABEL[row.game]} variant="outlined" />
                            <Typography sx={{ fontWeight: 600 }}>{nameOf(row.player)}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: MONO }}>
                                {dateTime(row.settledAt)}
                            </Typography>
                            <Box sx={{ flex: 1 }} />
                            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO }}>
                                {row.roundId}
                            </Typography>
                        </Box>
                    </DialogTitle>

                    <DialogContent>
                        <Typography variant="caption" color="text.secondary">
                            這一局的注單（共 {siblings.length} 筆）
                        </Typography>
                        <Table size="small" sx={{ mt: 1 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell>注別</TableCell>
                                    <TableCell align="right">下注</TableCell>
                                    <TableCell align="right">有效投注</TableCell>
                                    <TableCell align="right">派彩</TableCell>
                                    <TableCell align="right">輸贏</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {siblings.map((r) => (
                                    <TableRow
                                        key={r.id}
                                        // 點進來的那一筆要標出來——一局有五筆注單的時候，
                                        // 「我剛剛點的是哪一列」不該讓人自己找
                                        sx={{ background: r.id === row.id ? 'rgba(232,184,75,0.09)' : undefined }}
                                    >
                                        <TableCell>{betTypeLabel(r.betType)}</TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(r.stake)}</TableCell>
                                        <TableCell
                                            align="right"
                                            sx={{ fontFamily: MONO, color: r.validStake < r.stake ? 'warning.main' : 'text.secondary' }}
                                        >
                                            {money(r.validStake)}
                                        </TableCell>
                                        <TableCell align="right" sx={{ fontFamily: MONO }}>{money(r.payout)}</TableCell>
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

                        <Divider sx={{ my: 2 }} />

                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {[
                                { label: '這一局總下注', value: money(sum.stake) },
                                { label: '有效投注', value: `${money(sum.valid)}（${(validRatio * 100).toFixed(0)}%）` },
                                { label: '總派彩', value: money(sum.payout) },
                                { label: '淨輸贏', value: signedMoney(sum.net) },
                                { label: '結算後餘額', value: money(row.balanceAfter) },
                            ].map((x) => (
                                <Box key={x.label}>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        {x.label}
                                    </Typography>
                                    <Typography sx={{ fontFamily: MONO, fontSize: 16 }}>{x.value}</Typography>
                                </Box>
                            ))}
                        </Box>

                        {/* 有效投注被折抵得很兇的時候直接說出來。
                            這個判斷放在畫面上而不是留給人看數字，是因為
                            **對沖注的特徵是「兩個注區、金額相近、淨輸贏接近零」**，
                            那需要同時看三個欄位才成立，不是掃一眼就看得出來的 */}
                        {row.status === 'void' && (
                            <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
                                這一筆已經作廢，不計入任何報表數字。金額欄位維持原樣——
                                它記錄的是當初實際發生的事，沖正走的是另一筆調整交易（見金流管理）。
                            </Alert>
                        )}

                        {validRatio < 0.3 && siblings.length > 1 && (
                            <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'warning.main', lineHeight: 1.8 }}>
                                這一局的有效投注只有下注額的 {(validRatio * 100).toFixed(0)}%——
                                同時押了對立的注區，實際承擔的風險趨近於零。
                                返水如果照下注額計算，這種押法就是穩定的套利。
                            </Typography>
                        )}
                    </DialogContent>

                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        {row.status === 'settled' && !voiding && (
                            <Button color="error" size="small" onClick={() => setVoiding(true)}>
                                作廢這一筆
                            </Button>
                        )}
                        {voiding && (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', width: '100%' }}>
                                {/* **原因是必填的。** 沒有原因的作廢單在爭議升級時無法辯護，
                                    而且三個月後沒有人記得當初為什麼要作廢這一筆 */}
                                <TextField
                                    size="small"
                                    fullWidth
                                    autoFocus
                                    label="作廢原因（必填）"
                                    placeholder="例：牌局中斷，本局不算"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                />
                                <Button size="small" onClick={() => setVoiding(false)} sx={{ mt: 0.5 }}>取消</Button>
                                <Button
                                    size="small"
                                    color="error"
                                    variant="contained"
                                    disabled={!reason.trim()}
                                    sx={{ mt: 0.5, whiteSpace: 'nowrap' }}
                                    onClick={() => {
                                        voidBet(row.id, reason.trim());
                                        onVoided(`注單 ${row.id} 已作廢，沖正 ${signedMoney(-row.net)}`);
                                        onClose();
                                    }}
                                >
                                    確定作廢
                                </Button>
                            </Box>
                        )}
                        <Box sx={{ flex: 1 }} />
                        {!voiding && <Button onClick={onClose}>關閉</Button>}
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
}

export function BetsPage(): React.ReactElement {
    const [range, setRange] = React.useState<RangeKey>('7d');
    const [game, setGame] = React.useState<GameId | 'all'>('all');
    const [player, setPlayer] = React.useState<string>('all');
    const [outcome, setOutcome] = React.useState<'all' | 'win' | 'loss'>('all');
    const [minStake, setMinStake] = React.useState('');
    const [status, setStatus] = React.useState<LedgerQuery['status']>('all');
    const [detail, setDetail] = React.useState<BetRecord | null>(null);
    const [toast, setToast] = React.useState('');

    const [sortModel, setSortModel] = React.useState<GridSortModel>([{ field: 'settledAt', sort: 'desc' }]);
    const [pagination, setPagination] = React.useState<GridPaginationModel>({ page: 0, pageSize: 25 });
    const [result, setResult] = React.useState<LedgerPage>({ rows: [], total: 0, page: 0, pageSize: 25 });

    // 遊戲那一頁下的注會即時進來。用一個計數器當作「資料變了」的訊號，
    // 而不是直接把新注單併進 result——併進去的話目前這一頁的排序與篩選就不成立了
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribe(() => setRevision((n) => n + 1)), []);

    /** 玩家名冊。做成 Map 是因為表格每一列都要查一次 */
    const roster = React.useMemo(() => new Map(listPlayers().map((p) => [p.id, p])), []);
    const nameOf = React.useCallback((id: string) => roster.get(id)?.nickname ?? id, [roster]);

    const params: LedgerQuery = React.useMemo(
        () => ({
            game,
            player: player === 'all' ? undefined : player,
            from: rangeToFrom(range),
            outcome,
            status,
            minStake: minStake ? Number(minStake) : undefined,
            sortBy: (sortModel[0]?.field as LedgerQuery['sortBy']) ?? 'settledAt',
            sortDir: sortModel[0]?.sort ?? 'desc',
            page: pagination.page,
            pageSize: pagination.pageSize,
        }),
        [game, player, range, outcome, status, minStake, sortModel, pagination],
    );

    // 這就是「呼叫 API」的位置。換成 fetch 的話，改的只有這一行加一個 await
    React.useEffect(() => setResult(queryLedger(params)), [params, revision]);

    // 換篩選條件要跳回第一頁——停在第 8 頁然後篩出只剩 3 筆，畫面會是空的，
    // 而使用者看到的是「查不到資料」，不會想到是自己還停在後面的頁
    const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
        setter(v);
        setPagination((p) => ({ ...p, page: 0 }));
    };

    /**
     * 欄位定義。
     *
     * **只有資料層排得動的欄位才給排序。**
     * `ledger.query()` 支援的排序鍵只有結算時間、下注額、輸贏三個，
     * 其他欄位掛上排序箭頭的話，使用者點下去會**什麼都不會發生**——
     * 那比沒有箭頭更糟，因為它承諾了一個做不到的操作。
     */
    const columns = React.useMemo<GridColDef<BetRecord>[]>(() => [
        {
            // 190 不是隨手填的：等寬字下「2026-09-07 00:31:21」是 19 個字元約 160px，
            // 加上儲存格左右 padding 才放得下。給 168 的時候尾巴的秒數會被切成「00:31:…」，
            // 而**秒正是注單拿來對帳的那一位**
            field: 'settledAt', headerName: '結算時間', width: 190,
            valueFormatter: (v: number) => dateTime(v),
            cellClassName: 'mono',
        },
        {
            field: 'player', headerName: '玩家', width: 130, sortable: false,
            // 名冊裡查不到就退回顯示 id。**不要顯示空白**——
            // 注單指向一個不存在的帳號是資料問題，空白會讓它看起來像還沒載完
            valueGetter: (v: string) => nameOf(v),
        },
        {
            field: 'game', headerName: '玩法', width: 104, sortable: false,
            renderCell: (p) => <Chip size="small" label={GAME_LABEL[p.value as GameId]} variant="outlined" />,
        },
        {
            field: 'betType', headerName: '注別', width: 130, sortable: false,
            renderCell: (p) => (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: '100%' }}>
                    <span>{betTypeLabel(p.row.betType)}</span>
                    {/* 作廢單在列表上要一眼認得出來。**不要用刪除線蓋住整列**——
                        金額還是要讀得到，因為看的人正是要確認「當初是多少」 */}
                    {p.row.status === 'void' && (
                        <Chip size="small" color="error" variant="outlined" label="作廢" sx={{ height: 18, fontSize: 10 }} />
                    )}
                </Box>
            ),
        },
        {
            field: 'stake', headerName: '下注', width: 90, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => money(v), cellClassName: 'mono',
        },
        {
            field: 'validStake', headerName: '有效投注', width: 100, align: 'right', headerAlign: 'right',
            sortable: false,
            valueFormatter: (v: number) => money(v),
            // 有效投注被折抵過的（對沖注）標出來——這是返水稽核要看的第一個訊號
            cellClassName: (p) => (p.row.validStake < p.row.stake ? 'mono discounted' : 'mono muted'),
        },
        {
            field: 'payout', headerName: '派彩', width: 90, align: 'right', headerAlign: 'right',
            sortable: false, valueFormatter: (v: number) => money(v), cellClassName: 'mono',
        },
        {
            field: 'net', headerName: '輸贏', width: 100, align: 'right', headerAlign: 'right',
            valueFormatter: (v: number) => signedMoney(v),
            cellClassName: (p) => `mono ${p.row.net > 0 ? 'win' : p.row.net < 0 ? 'loss' : 'muted'}`,
        },
        {
            field: 'balanceAfter', headerName: '結算後餘額', width: 110, align: 'right', headerAlign: 'right',
            sortable: false, valueFormatter: (v: number) => money(v), cellClassName: 'mono muted',
        },
        { field: 'roundId', headerName: '局號', flex: 1, minWidth: 220, sortable: false, cellClassName: 'mono muted small' },
    ], [nameOf]);

    return (
        <Stack spacing={2}>
            <Typography variant="h6">注單查詢</Typography>

            <Paper sx={{ p: 2 }}>
                {/* 換行的工具列不要用 Stack —— 它在 v7 已經沒有 useFlexGap／flexWrap 這兩個 prop
                    （v6 起 gap 就是預設行為），寫上去型別直接不過。要換行就自己用 Box + flex */}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                    <Stack direction="row" spacing={0.5}>
                        {RANGES.map((r) => (
                            <Button
                                key={r.key}
                                size="small"
                                variant={range === r.key ? 'contained' : 'outlined'}
                                onClick={() => resetPage(setRange)(r.key)}
                            >
                                {r.label}
                            </Button>
                        ))}
                    </Stack>

                    <TextField
                        select label="玩法" value={game} sx={{ minWidth: 130 }}
                        onChange={(e) => resetPage(setGame)(e.target.value as GameId | 'all')}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        {GAME_IDS.map((id) => (
                            <MenuItem key={id} value={id}>{GAME_LABEL[id]}</MenuItem>
                        ))}
                    </TextField>

                    {/* 四十個帳號用下拉還可以，但這個元件撐不到「上千個帳號」——
                        那時候要的是可以打字搜尋的 Autocomplete，而且選項要從後端查。
                        玩家頁那邊已經是搜尋式的了，這裡維持下拉是因為它只是個快捷 */}
                    <TextField
                        select label="玩家" value={player} sx={{ minWidth: 170 }}
                        onChange={(e) => resetPage(setPlayer)(e.target.value)}
                    >
                        <MenuItem value="all">全部玩家</MenuItem>
                        {[...roster.values()]
                            // 本機帳號排最前面：demo 的時候最常要看的就是「我剛剛下的那一注」
                            .sort((a, b) => (a.id === SELF_ID ? -1 : b.id === SELF_ID ? 1 : a.id.localeCompare(b.id)))
                            .map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.nickname}</MenuItem>
                            ))}
                    </TextField>

                    <TextField
                        select label="輸贏" value={outcome} sx={{ minWidth: 110 }}
                        onChange={(e) => resetPage(setOutcome)(e.target.value as 'all' | 'win' | 'loss')}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        <MenuItem value="win">玩家贏</MenuItem>
                        <MenuItem value="loss">玩家輸</MenuItem>
                    </TextField>

                    <TextField
                        select label="狀態" value={status} sx={{ minWidth: 110 }}
                        onChange={(e) => resetPage(setStatus)(e.target.value as LedgerQuery['status'])}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        <MenuItem value="settled">已結算</MenuItem>
                        <MenuItem value="void">已作廢</MenuItem>
                    </TextField>

                    <TextField
                        label="下注額 ≥" value={minStake} type="number" sx={{ width: 120 }}
                        onChange={(e) => resetPage(setMinStake)(e.target.value)}
                    />

                    <Box sx={{ flex: 1 }} />

                    <Typography variant="body2" color="text.secondary">
                        共 {money(result.total)} 筆
                    </Typography>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadIcon fontSize="small" />}
                        disabled={result.total === 0}
                        onClick={() => exportCsv(params, nameOf)}
                    >
                        匯出 CSV
                    </Button>
                </Box>
            </Paper>

            <Paper sx={{ height: 'calc(100vh - 268px)', minHeight: 380 }}>
                <DataGrid<BetRecord>
                    rows={result.rows}
                    columns={columns}
                    localeText={zhTW.components.MuiDataGrid.defaultProps.localeText}
                    density="compact"
                    disableColumnFilter
                    disableRowSelectionOnClick
                    // 三個 server 開關。少了任何一個，DataGrid 就會拿「當前這一頁」
                    // 自己算分頁或排序，而畫面上看起來完全正常——直到你翻到第二頁
                    // 才發現排序只在頁內生效
                    paginationMode="server"
                    sortingMode="server"
                    rowCount={result.total}
                    paginationModel={pagination}
                    onPaginationModelChange={setPagination}
                    sortModel={sortModel}
                    onSortModelChange={(m) => {
                        setSortModel(m);
                        setPagination((p) => ({ ...p, page: 0 }));
                    }}
                    pageSizeOptions={PAGE_SIZES}
                    onRowClick={(p) => setDetail(p.row)}
                    sx={{
                        border: 0,
                        cursor: 'pointer',
                        // 金額欄一律等寬字。不對齊的話，掃一整欄找異常值會很吃力
                        '& .mono': { fontFamily: MONO },
                        '& .muted': { color: 'text.secondary' },
                        '& .small': { fontSize: 11 },
                        '& .win': { color: 'success.main' },
                        '& .loss': { color: 'error.main' },
                        '& .discounted': { color: 'warning.main' },
                        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, letterSpacing: '0.03em' },
                    }}
                />
            </Paper>

            <RoundDialog
                row={detail}
                nameOf={nameOf}
                onClose={() => setDetail(null)}
                onVoided={(m) => { setToast(m); setRevision((n) => n + 1); }}
            />

            <Snackbar
                open={Boolean(toast)}
                autoHideDuration={4000}
                onClose={() => setToast('')}
                message={toast}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            />
        </Stack>
    );
}
