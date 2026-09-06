import * as React from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    MenuItem, Paper, Snackbar, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { DataGrid, type GridColDef, type GridPaginationModel, type GridSortModel } from '@mui/x-data-grid';
import { zhTW } from '@mui/x-data-grid/locales';
import { list as listPlayers } from '../../arcade/server/players';
import {
    query as queryTx, review, stats as txStats, subscribe as subscribeTx,
    type Transaction, type TxKind, type TxQuery, type TxStatus,
} from '../../arcade/server/txLedger';
import { dateTime, money, signedMoney } from '../format';
import { denyReason, useCan, useRole } from '../useAuth';
import { MONO } from '../theme';

/**
 * 金流管理。
 *
 * ---
 *
 * **這一頁存在的直接理由：儀表板上有一個「待審提領 2 筆」，而沒有地方可以處理它。**
 *
 * 一個顯示待辦數量卻不能處理待辦的後台，比不顯示更糟——
 * 它每天提醒你有事情要做，然後告訴你這裡做不了。
 *
 * ---
 *
 * **放行一筆提領是整個後台金額最大的單一動作。**
 *
 * 所以它跟其他操作不同，走的是「先看清楚、再確認」的兩段式：
 * 確認框裡要重述金額、帳號與餘額，因為**營運一天要審幾十筆，
 * 而按鈕的位置是固定的**——只靠「點到哪一列」來記得自己在放行誰，遲早會出事。
 */

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
    return d.getTime() - (r.days - 1) * 86_400_000;
}

const KIND_LABEL: Record<TxKind, string> = {
    deposit: '儲值',
    withdraw: '提領',
    rebate: '返水',
    adjust: '調整',
};

const STATUS_LABEL: Record<TxStatus, string> = {
    done: '已完成',
    pending: '待審',
    rejected: '已退件',
};

const STATUS_COLOR: Record<TxStatus, 'success' | 'warning' | 'error'> = {
    done: 'success',
    pending: 'warning',
    rejected: 'error',
};

/** 審核確認框。**重述一次要做的事**，而不是只問「確定嗎」 */
function ReviewDialog(props: {
    tx: Transaction | null;
    decision: 'done' | 'rejected';
    nameOf: (id: string) => string;
    onClose: () => void;
    onDone: (msg: string) => void;
}): React.ReactElement {
    const { tx, decision, nameOf, onClose, onDone } = props;
    if (!tx) return <Dialog open={false} onClose={onClose}><div /></Dialog>;

    const amount = Math.abs(tx.amount);
    const pass = decision === 'done';

    return (
        <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>{pass ? '放行提領' : '退件'}</DialogTitle>
            <DialogContent>
                <Alert severity={pass ? 'warning' : 'info'} variant="outlined" sx={{ mb: 2 }}>
                    {pass
                        ? '放行之後這筆錢就出去了。這個動作沒有復原按鈕，只能靠人工調整單沖正。'
                        : '退件會保留原始申請單當證據，並自動開立一筆退款交易把錢還回帳號。'}
                </Alert>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 1, columnGap: 2 }}>
                    {[
                        ['帳號', nameOf(tx.player)],
                        ['金額', money(amount)],
                        ['申請時間', dateTime(tx.createdAt)],
                        ['申請前餘額', money(tx.balanceBefore)],
                        ['扣款後餘額', money(tx.balanceAfter)],
                    ].map(([k, v]) => (
                        <React.Fragment key={k}>
                            <Typography variant="body2" color="text.secondary">{k}</Typography>
                            <Typography variant="body2" sx={{ fontFamily: MONO }}>{v}</Typography>
                        </React.Fragment>
                    ))}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button
                    variant="contained"
                    color={pass ? 'primary' : 'error'}
                    onClick={() => {
                        review(tx.id, decision);
                        onDone(`${nameOf(tx.player)} 的提領已${pass ? '放行' : '退件'}`);
                        onClose();
                    }}
                >
                    {pass ? '確定放行' : '確定退件'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export function FinancePage(): React.ReactElement {
    /**
     * 分頁籤：全部交易 / 待審提領。
     *
     * 做成 Tabs 而不是一個「狀態」下拉，是因為**這兩件事的使用情境不同**：
     * 看全部交易是在查帳，看待審提領是在處理待辦。
     * 待辦要一眼看得到還剩幾筆，那個數字放在籤上才會被看見。
     */
    const [tab, setTab] = React.useState<'all' | 'pending'>('all');
    const [range, setRange] = React.useState<RangeKey>('30d');
    const [kind, setKind] = React.useState<TxKind | 'all'>('all');
    const [player, setPlayer] = React.useState<string>('all');
    const [sortModel, setSortModel] = React.useState<GridSortModel>([{ field: 'createdAt', sort: 'desc' }]);
    const [pagination, setPagination] = React.useState<GridPaginationModel>({ page: 0, pageSize: 25 });
    const [confirm, setConfirm] = React.useState<{ tx: Transaction; decision: 'done' | 'rejected' } | null>(null);
    const [toast, setToast] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const can = useCan();
    const role = useRole();
    const reviewable = can('tx.review');

    React.useEffect(() => subscribeTx(() => setRevision((n) => n + 1)), []);

    const roster = React.useMemo(() => new Map(listPlayers().map((p) => [p.id, p])), [revision]);
    const nameOf = React.useCallback((id: string) => roster.get(id)?.nickname ?? id, [roster]);

    const from = rangeFrom(range);

    const params: TxQuery = React.useMemo(() => ({
        from,
        kind: tab === 'pending' ? 'withdraw' : kind,
        status: tab === 'pending' ? 'pending' : 'all',
        player: player === 'all' ? undefined : player,
        sortBy: (sortModel[0]?.field as TxQuery['sortBy']) ?? 'createdAt',
        sortDir: sortModel[0]?.sort ?? 'desc',
        page: pagination.page,
        pageSize: pagination.pageSize,
    }), [from, tab, kind, player, sortModel, pagination]);

    const result = React.useMemo(() => queryTx(params), [params, revision]);
    const summary = React.useMemo(() => txStats({ from }), [from, revision]);

    // 待審是全期間的，不跟著時間範圍走——**沒人希望「切到近 7 日」就看不到
    // 上週那筆還沒處理的提領**。待辦的定義是「還沒做完」，不是「最近的」
    const pendingAll = React.useMemo(() => txStats().pendingCount, [revision]);

    const columns = React.useMemo<GridColDef<Transaction>[]>(() => {
        const base: GridColDef<Transaction>[] = [
            {
                field: 'createdAt', headerName: '時間', width: 190,
                valueFormatter: (v: number) => dateTime(v), cellClassName: 'mono',
            },
            {
                field: 'player', headerName: '帳號', width: 140, sortable: false,
                valueGetter: (v: string) => nameOf(v),
            },
            {
                field: 'kind', headerName: '類型', width: 90, sortable: false,
                renderCell: (p) => <Chip size="small" variant="outlined" label={KIND_LABEL[p.value as TxKind]} />,
            },
            {
                field: 'amount', headerName: '金額', width: 110, align: 'right', headerAlign: 'right',
                valueFormatter: (v: number) => signedMoney(v),
                // 入帳綠、出帳紅。**方向比數字本身更快讀**
                cellClassName: (p) => `mono ${p.row.amount > 0 ? 'win' : p.row.amount < 0 ? 'loss' : 'muted'}`,
            },
            {
                field: 'balanceAfter', headerName: '結餘', width: 100, align: 'right', headerAlign: 'right',
                sortable: false, valueFormatter: (v: number) => money(v), cellClassName: 'mono muted',
            },
            {
                field: 'status', headerName: '狀態', width: 92, sortable: false,
                renderCell: (p) => (
                    <Chip
                        size="small" variant="outlined"
                        color={STATUS_COLOR[p.value as TxStatus]}
                        label={STATUS_LABEL[p.value as TxStatus]}
                        sx={{ height: 20, fontSize: 11 }}
                    />
                ),
            },
            {
                field: 'ref', headerName: '關聯單號', width: 150, sortable: false,
                cellClassName: 'mono muted small',
            },
            { field: 'note', headerName: '備註', flex: 1, minWidth: 160, sortable: false },
        ];

        if (tab !== 'pending') return base;

        // 待審那一頁多兩個動作欄。放在最右邊而不是最左邊，
        // 是因為**要先讀完這一列才該按得到按鈕**
        return [
            ...base.filter((c) => c.field !== 'note' && c.field !== 'status'),
            {
                field: 'actions', headerName: '處理', width: 170, sortable: false,
                renderCell: (p) => (
                    <Tooltip title={reviewable ? '' : denyReason('tx.review', role)}>
                        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', height: '100%' }}>
                            <Button
                                size="small" variant="contained" disabled={!reviewable}
                                onClick={() => setConfirm({ tx: p.row, decision: 'done' })}
                            >
                                放行
                            </Button>
                            <Button
                                size="small" color="error" variant="outlined" disabled={!reviewable}
                                onClick={() => setConfirm({ tx: p.row, decision: 'rejected' })}
                            >
                                退件
                            </Button>
                        </Box>
                    </Tooltip>
                ),
            },
        ];
    }, [tab, nameOf, reviewable, role]);

    return (
        <Stack spacing={2}>
            <Typography variant="h6">金流管理</Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                {[
                    { label: '儲值', value: money(summary.deposit) },
                    { label: '提領', value: money(summary.withdraw), note: '已放行' },
                    { label: '淨存入', value: signedMoney(summary.netDeposit), note: '儲值 − 提領', good: summary.netDeposit >= 0 },
                    { label: '返水支出', value: money(summary.rebate), note: '按有效投注計' },
                    { label: '待審提領', value: pendingAll ? `${pendingAll} 筆` : '—', note: pendingAll ? '需要處理' : '都處理完了', bad: pendingAll > 0 },
                ].map((k) => (
                    <Paper key={k.label} sx={{ p: 2, flex: '1 1 180px', minWidth: 180 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '0.05em' }}>{k.label}</Typography>
                        <Typography sx={{
                            fontFamily: MONO, fontSize: 26, fontWeight: 600, lineHeight: 1.3, mt: 0.5,
                            color: k.bad ? 'error.main' : k.good ? 'success.main' : 'text.primary',
                        }}>
                            {k.value}
                        </Typography>
                        {k.note && <Typography variant="caption" color="text.secondary">{k.note}</Typography>}
                    </Paper>
                ))}
            </Box>

            <Paper sx={{ px: 2, pt: 1 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v: 'all' | 'pending') => {
                        setTab(v);
                        setPagination((p) => ({ ...p, page: 0 }));
                    }}
                    sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
                >
                    <Tab value="all" label="全部交易" />
                    <Tab
                        value="pending"
                        label={pendingAll ? `待審提領（${pendingAll}）` : '待審提領'}
                        sx={{ color: pendingAll ? 'warning.main' : undefined }}
                    />
                </Tabs>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', py: 2 }}>
                    <Stack direction="row" spacing={0.5}>
                        {RANGES.map((r) => (
                            <Button
                                key={r.key} size="small"
                                variant={range === r.key ? 'contained' : 'outlined'}
                                onClick={() => { setRange(r.key); setPagination((p) => ({ ...p, page: 0 })); }}
                            >
                                {r.label}
                            </Button>
                        ))}
                    </Stack>

                    <TextField
                        select label="類型" value={kind} sx={{ minWidth: 120 }}
                        disabled={tab === 'pending'}
                        onChange={(e) => { setKind(e.target.value as TxKind | 'all'); setPagination((p) => ({ ...p, page: 0 })); }}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        {(Object.keys(KIND_LABEL) as TxKind[]).map((k) => (
                            <MenuItem key={k} value={k}>{KIND_LABEL[k]}</MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select label="帳號" value={player} sx={{ minWidth: 170 }}
                        onChange={(e) => { setPlayer(e.target.value); setPagination((p) => ({ ...p, page: 0 })); }}
                    >
                        <MenuItem value="all">全部帳號</MenuItem>
                        {[...roster.values()].map((p) => (
                            <MenuItem key={p.id} value={p.id}>{p.nickname}</MenuItem>
                        ))}
                    </TextField>

                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" color="text.secondary">共 {money(result.total)} 筆</Typography>
                </Box>
            </Paper>

            <Paper sx={{ height: 'calc(100vh - 430px)', minHeight: 320 }}>
                <DataGrid<Transaction>
                    rows={result.rows}
                    columns={columns}
                    localeText={zhTW.components.MuiDataGrid.defaultProps.localeText}
                    density="compact"
                    disableColumnFilter
                    disableRowSelectionOnClick
                    paginationMode="server"
                    sortingMode="server"
                    rowCount={result.total}
                    paginationModel={pagination}
                    onPaginationModelChange={setPagination}
                    sortModel={sortModel}
                    onSortModelChange={(m) => { setSortModel(m); setPagination((p) => ({ ...p, page: 0 })); }}
                    pageSizeOptions={[25, 50, 100]}
                    sx={{
                        border: 0,
                        '& .mono': { fontFamily: MONO },
                        '& .muted': { color: 'text.secondary' },
                        '& .small': { fontSize: 11 },
                        '& .win': { color: 'success.main' },
                        '& .loss': { color: 'error.main' },
                        '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600, letterSpacing: '0.03em' },
                    }}
                />
            </Paper>

            {tab === 'pending' && result.total === 0 && (
                <Alert severity="success" variant="outlined">
                    沒有待處理的提領申請。
                </Alert>
            )}

            <ReviewDialog
                tx={confirm?.tx ?? null}
                decision={confirm?.decision ?? 'done'}
                nameOf={nameOf}
                onClose={() => setConfirm(null)}
                onDone={(m) => { setToast(m); setRevision((n) => n + 1); }}
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
