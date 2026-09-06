import * as React from 'react';
import {
    Box, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead,
    TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import {
    query as queryAudit, subscribe as subscribeAudit,
    type AuditEntry, type AuditQuery,
} from '../../arcade/server/auditLog';
import { dateTime, money } from '../format';
import { MONO } from '../theme';

/**
 * 操作紀錄。
 *
 * ---
 *
 * **這一頁沒有任何按鈕。**
 *
 * 它是唯讀的，而且刻意如此：稽核紀錄一旦可以在後台被修改或刪除，
 * 它就不再是證據。連「清空全部資料」都不會動到這張表
 * （見 admin/seed.ts 的 `clearAll()`）——**資料被清掉之後，
 * 「是誰清的」還在**，那正是它的用途。
 *
 * ---
 *
 * **每一列的重點是右邊那一欄：舊值 → 新值。**
 *
 * 「某某在 3:12 修改了百家樂的設定」這種紀錄在事故調查時等於沒有，
 * 因為要回答的問題是「改成了什麼」。
 * 所以資料層在寫入的當下就把前後值算好存下來
 * （見 auditLog 的 `diff()`），而不是事後去比對兩個版本——
 * 事後比對需要保留每一版的完整快照，那是另一個量級的工程。
 */

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
    'ops.update': '遊戲設定',
    'ops.reset': '設定還原',
    'player.update': '玩家處置',
    'tx.review': '提領審核',
    'bet.void': '注單作廢',
    'data.seed': '產生資料',
    'data.clear': '清空資料',
};

/** 動作的顏色。**只有兩種動作是紅的**：停權相關與清空資料，其餘一律中性 */
const ACTION_COLOR: Partial<Record<AuditEntry['action'], 'default' | 'warning' | 'error' | 'info'>> = {
    'ops.update': 'info',
    'ops.reset': 'warning',
    'player.update': 'warning',
    'tx.review': 'info',
    'bet.void': 'error',
    'data.seed': 'default',
    'data.clear': 'error',
};

const PAGE_SIZE = 25;

export function AuditPage(): React.ReactElement {
    const [action, setAction] = React.useState<AuditQuery['action']>('all');
    const [page, setPage] = React.useState(0);
    const [revision, setRevision] = React.useState(0);

    React.useEffect(() => subscribeAudit(() => setRevision((n) => n + 1)), []);

    const result = React.useMemo(
        () => queryAudit({ action, page, pageSize: PAGE_SIZE }),
        [action, page, revision],
    );

    return (
        <Stack spacing={2}>
            <Typography variant="h6">操作紀錄</Typography>

            <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                    <TextField
                        select label="動作類型" value={action} sx={{ minWidth: 160 }}
                        onChange={(e) => {
                            setAction(e.target.value as AuditQuery['action']);
                            setPage(0);
                        }}
                    >
                        <MenuItem value="all">全部</MenuItem>
                        {(Object.keys(ACTION_LABEL) as AuditEntry['action'][]).map((k) => (
                            <MenuItem key={k} value={k}>{ACTION_LABEL[k]}</MenuItem>
                        ))}
                    </TextField>

                    <Box sx={{ flex: 1 }} />
                    <Typography variant="body2" color="text.secondary">共 {money(result.total)} 筆</Typography>
                </Box>
            </Paper>

            <Paper>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: 180 }}>時間</TableCell>
                            <TableCell sx={{ width: 90 }}>操作者</TableCell>
                            <TableCell sx={{ width: 110 }}>動作</TableCell>
                            <TableCell sx={{ width: 150 }}>對象</TableCell>
                            <TableCell>變更內容</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {result.rows.map((r) => (
                            <TableRow key={r.id} hover>
                                <TableCell sx={{ fontFamily: MONO, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                                    {dateTime(r.at)}
                                </TableCell>
                                <TableCell sx={{ verticalAlign: 'top' }}>{r.actor}</TableCell>
                                <TableCell sx={{ verticalAlign: 'top' }}>
                                    <Chip
                                        size="small"
                                        variant="outlined"
                                        color={ACTION_COLOR[r.action] ?? 'default'}
                                        label={ACTION_LABEL[r.action]}
                                        sx={{ height: 20, fontSize: 11 }}
                                    />
                                </TableCell>
                                <TableCell sx={{ verticalAlign: 'top' }}>{r.targetLabel}</TableCell>
                                <TableCell>
                                    {r.changes.map((c) => (
                                        <Box key={c.field} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 96 }}>
                                                {c.label}
                                            </Typography>
                                            {/* 舊值用刪除線、新值用主色。**方向要一眼看得出來**——
                                                稽核紀錄最常見的閱讀情境是「快速掃過一整天的操作，
                                                找出那個不對勁的變更」 */}
                                            <Typography variant="caption" sx={{ fontFamily: MONO, color: 'text.disabled', textDecoration: 'line-through' }}>
                                                {c.before}
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.disabled' }}>→</Typography>
                                            <Typography variant="caption" sx={{ fontFamily: MONO, color: 'primary.main' }}>
                                                {c.after}
                                            </Typography>
                                        </Box>
                                    ))}
                                    {r.note && (
                                        <Typography variant="caption" color="text.secondary">{r.note}</Typography>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                        {result.rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                    還沒有操作紀錄。到「遊戲設定」改一個限紅，或到「玩家管理」標記一個帳號，
                                    這裡就會出現一列。
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>

                <TablePagination
                    component="div"
                    count={result.total}
                    page={page}
                    rowsPerPage={PAGE_SIZE}
                    rowsPerPageOptions={[PAGE_SIZE]}
                    onPageChange={(_, p) => setPage(p)}
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
                />
            </Paper>

            <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, lineHeight: 1.9 }}>
                紀錄由資料層寫入，不是由頁面寫入：
                <code>opsConfig.update()</code>、<code>players.update()</code>、
                <code>txLedger.review()</code> 這幾支函式是各自資料的唯一入口，
                記錄寫在入口裡，就沒有繞得過去的路徑。交給呼叫端記的話，
                任何一個忘記記錄的地方都是一個沒有留痕的後門。
                <br />
                每一筆存的是<strong>格式化過的字串</strong>而不是原始值——三年後回頭查的時候，
                欄位可能已經改名或改型別，而稽核紀錄必須能獨立閱讀，不能依賴當時的程式碼還在。
                <br />
                操作者目前固定是 <code>admin</code>，因為這個 demo 還沒有登入。
                欄位先放著：沒有操作者的稽核紀錄只能證明「有人改過」，而稽核要回答的第一個問題就是誰。
            </Typography>
        </Stack>
    );
}
