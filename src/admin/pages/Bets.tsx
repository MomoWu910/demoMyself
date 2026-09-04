import * as React from 'react';
import {
    Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell,
    TableContainer, TableHead, TablePagination, TableRow, TableSortLabel, TextField, Typography,
} from '@mui/material';
import type { GameId } from '../../arcade/net/protocol';
import { query as queryLedger, subscribe, type LedgerPage, type LedgerQuery } from '../../arcade/server/ledger';
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
 * 所以形狀從一開始就照對的來。之後把 `queryLedger` 換成 `fetch('/api/bets?...')`，
 * 這一頁除了那一行以外不用動。
 */

const PAGE_SIZES = [25, 50, 100];

/** 時間快捷。營運看注單九成是看「今天」跟「近七天」，做成按鈕比讓人選日期快 */
const RANGES = [
    { key: 'today', label: '今日' },
    { key: '7d', label: '近 7 天' },
    { key: 'all', label: '全部' },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

function rangeToFrom(key: RangeKey): number | undefined {
    if (key === 'all') return undefined;
    if (key === '7d') return Date.now() - 7 * 86_400_000;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function BetsPage(): React.ReactElement {
    const [range, setRange] = React.useState<RangeKey>('7d');
    const [game, setGame] = React.useState<GameId | 'all'>('all');
    const [outcome, setOutcome] = React.useState<'all' | 'win' | 'loss'>('all');
    const [minStake, setMinStake] = React.useState('');
    const [sortBy, setSortBy] = React.useState<NonNullable<LedgerQuery['sortBy']>>('settledAt');
    const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
    const [page, setPage] = React.useState(0);
    const [pageSize, setPageSize] = React.useState(25);
    const [result, setResult] = React.useState<LedgerPage>({ rows: [], total: 0, page: 0, pageSize: 25 });

    // 遊戲那一頁下的注會即時進來。用一個計數器當作「資料變了」的訊號，
    // 而不是直接把新注單併進 result——併進去的話目前這一頁的排序與篩選就不成立了
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribe(() => setRevision((n) => n + 1)), []);

    const params: LedgerQuery = React.useMemo(
        () => ({
            game,
            from: rangeToFrom(range),
            outcome,
            minStake: minStake ? Number(minStake) : undefined,
            sortBy,
            sortDir,
            page,
            pageSize,
        }),
        [game, range, outcome, minStake, sortBy, sortDir, page, pageSize],
    );

    // 這就是「呼叫 API」的位置。換成 fetch 的話，改的只有這一行加一個 await
    React.useEffect(() => setResult(queryLedger(params)), [params, revision]);

    // 換篩選條件要跳回第一頁——停在第 8 頁然後篩出只剩 3 筆，畫面會是空的，
    // 而使用者看到的是「查不到資料」，不會想到是自己還停在後面的頁
    const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
        setter(v);
        setPage(0);
    };

    const sortHandler = (key: NonNullable<LedgerQuery['sortBy']>) => () => {
        if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else {
            setSortBy(key);
            setSortDir('desc');
        }
        setPage(0);
    };

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
                        select label="玩法" value={game} sx={{ minWidth: 150 }}
                        onChange={(e) => resetPage(setGame)(e.target.value as GameId | 'all')}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        {GAME_IDS.map((id) => (
                            <MenuItem key={id} value={id}>{GAME_LABEL[id]}</MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select label="輸贏" value={outcome} sx={{ minWidth: 120 }}
                        onChange={(e) => resetPage(setOutcome)(e.target.value as 'all' | 'win' | 'loss')}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        <MenuItem value="win">玩家贏</MenuItem>
                        <MenuItem value="loss">玩家輸</MenuItem>
                    </TextField>

                    <TextField
                        label="下注額 ≥" value={minStake} type="number" sx={{ width: 130 }}
                        onChange={(e) => resetPage(setMinStake)(e.target.value)}
                    />

                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" color="text.secondary">
                        共 {money(result.total)} 筆
                    </Typography>
                </Box>
            </Paper>

            <Paper>
                <TableContainer sx={{ maxHeight: 'calc(100vh - 330px)' }}>
                    <Table stickyHeader size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sortDirection={sortBy === 'settledAt' ? sortDir : false}>
                                    <TableSortLabel
                                        active={sortBy === 'settledAt'}
                                        direction={sortBy === 'settledAt' ? sortDir : 'desc'}
                                        onClick={sortHandler('settledAt')}
                                    >
                                        結算時間
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell>玩法</TableCell>
                                <TableCell>注別</TableCell>
                                <TableCell align="right" sortDirection={sortBy === 'stake' ? sortDir : false}>
                                    <TableSortLabel
                                        active={sortBy === 'stake'}
                                        direction={sortBy === 'stake' ? sortDir : 'desc'}
                                        onClick={sortHandler('stake')}
                                    >
                                        下注
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">有效投注</TableCell>
                                <TableCell align="right">派彩</TableCell>
                                <TableCell align="right" sortDirection={sortBy === 'net' ? sortDir : false}>
                                    <TableSortLabel
                                        active={sortBy === 'net'}
                                        direction={sortBy === 'net' ? sortDir : 'desc'}
                                        onClick={sortHandler('net')}
                                    >
                                        輸贏
                                    </TableSortLabel>
                                </TableCell>
                                <TableCell align="right">結算後餘額</TableCell>
                                <TableCell>局號</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {result.rows.map((r) => (
                                <TableRow key={r.id} hover>
                                    <TableCell sx={{ fontFamily: MONO, whiteSpace: 'nowrap' }}>
                                        {dateTime(r.settledAt)}
                                    </TableCell>
                                    <TableCell><Chip size="small" label={GAME_LABEL[r.game]} variant="outlined" /></TableCell>
                                    <TableCell>{betTypeLabel(r.betType)}</TableCell>
                                    <TableCell align="right" sx={{ fontFamily: MONO }}>{money(r.stake)}</TableCell>
                                    <TableCell
                                        align="right"
                                        sx={{
                                            fontFamily: MONO,
                                            // 有效投注被折抵過的（對沖注）標出來——這是返水稽核要看的第一個訊號
                                            color: r.validStake < r.stake ? 'warning.main' : 'text.secondary',
                                        }}
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
                                    <TableCell align="right" sx={{ fontFamily: MONO, color: 'text.secondary' }}>
                                        {money(r.balanceAfter)}
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}>
                                        {r.roundId}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {result.rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        這組條件查不到注單
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>

                <TablePagination
                    component="div"
                    count={result.total}
                    page={page}
                    rowsPerPage={pageSize}
                    rowsPerPageOptions={PAGE_SIZES}
                    onPageChange={(_, p) => setPage(p)}
                    onRowsPerPageChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(0);
                    }}
                    labelRowsPerPage="每頁"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
                />
            </Paper>
        </Stack>
    );
}
