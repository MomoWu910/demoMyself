import * as React from 'react';
import {
    Alert, Box, Button, Divider, FormControlLabel, Paper, Snackbar, Stack, Switch, TextField,
    Tooltip, Typography,
} from '@mui/material';
import { Formik, Form, Field, type FieldProps } from 'formik';
import * as Yup from 'yup';
import type { GameId } from '../../arcade/net/protocol';
import { clear as clearLedger, count as ledgerCount } from '../../arcade/server/ledger';
import { count as playerCount } from '../../arcade/server/players';
import { backendName } from '../../arcade/server/storage';
import { count as txCount } from '../../arcade/server/txLedger';
import { forGame, reset as resetOps, subscribe as subscribeOps, update, type GameOps } from '../../arcade/server/opsConfig';
import { GAME_IDS, GAME_LABEL, money } from '../format';
import { ConfirmDialog, type ConfirmChange } from '../ConfirmDialog';
import { clearAll, seed } from '../seed';
import { denyReason, useCan, useRole } from '../useAuth';

/**
 * 遊戲設定。**這一頁是整個後台唯一會寫回去的地方。**
 *
 * 改完按儲存，`opsConfig.update()` 會寫進 localStorage 並透過 BroadcastChannel
 * 廣播出去——遊樂場那個分頁如果開著，**下一次下注就會吃到新的限紅**，不必重整。
 *
 * 這是這個 demo 想證明的核心：後台不是一個獨立的 CRUD 畫面，
 * 它跟遊戲之間有一條真的線。**把單注上限調到 100 再回去押 500，會被擋下來。**
 *
 * ---
 *
 * **表單的三個原則**（後台八成的工作量在表單上）：
 *
 * 1. **驗證規則要跟後端同一份。** 這裡用 yup 寫在 `schema`，
 *    真實系統裡這份 schema 應該是前後端共用的，不然會出現
 *    「前端過了後端擋」——使用者看到一個沒有理由的失敗。
 * 2. **危險的值要看得見後果。** 限紅不是一個普通的數字欄位，
 *    改小了玩家會押不進去，改大了風險敞口就開了，所以旁邊直接寫出目前的區間。
 * 3. **上下架跟維護要分開。** 上下架是產品決策，維護是臨時狀態，
 *    兩者對玩家顯示的訊息不同，對報表的處理也不同。
 */

const schema = Yup.object({
    enabled: Yup.boolean().required(),
    maintenance: Yup.boolean().required(),
    minBet: Yup.number()
        .typeError('要填數字')
        .integer('只能是整數')
        .min(1, '至少 1')
        .required('必填'),
    maxBet: Yup.number()
        .typeError('要填數字')
        .integer('只能是整數')
        .required('必填')
        // 上限一定要大於下限，否則玩家沒有任何一個合法的下注額可以押——
        // 這種設定不會報錯，只會讓整款遊戲安靜地押不進去
        .moreThan(Yup.ref('minBet'), '上限要大於下限'),
});

/** 一款遊戲一張卡。每張卡是獨立的表單，改一款不影響另一款還沒存的編輯 */
function GameCard(props: { id: GameId; onSaved: (msg: string) => void }): React.ReactElement {
    const { id, onSaved } = props;
    const can = useCan();
    const role = useRole();
    const writable = can('ops.write');

    // 別的分頁改了設定要跟著更新（例如同時開兩個後台分頁）
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribeOps(() => setRevision((n) => n + 1)), []);
    const current = React.useMemo(() => forGame(id), [id, revision]);

    /** 等待二次確認的那一份表單值。null 代表沒有待確認的變更 */
    const [pending, setPending] = React.useState<GameOps | null>(null);

    const apply = React.useCallback((values: GameOps) => {
        update(id, {
            ...values,
            minBet: Number(values.minBet),
            maxBet: Number(values.maxBet),
        });
        setPending(null);
        onSaved(`${GAME_LABEL[id]} 已更新，遊戲端立即生效`);
    }, [id, onSaved]);

    /**
     * 這次的變更會不會把玩家擋在門外。
     *
     * **只有這兩件事要問，改限紅的數字不問**——那是營運的日常工作，
     * 而且改回去就好。每個按鈕都問的後台，使用者會在兩天內學會
     * 不看內容直接按確定（見 ConfirmDialog 的檔頭）。
     */
    const locksPlayersOut = (next: GameOps): boolean =>
        (current.enabled && !next.enabled) || (!current.maintenance && next.maintenance);

    /** 變更清單。跟操作紀錄同一個形式：舊值 → 新值 */
    const changesOf = (next: GameOps): ConfirmChange[] => {
        const out: ConfirmChange[] = [];
        const yn = (v: boolean): string => (v ? '是' : '否');
        if (current.enabled !== next.enabled) out.push({ label: '上架', before: yn(current.enabled), after: yn(next.enabled) });
        if (current.maintenance !== next.maintenance) out.push({ label: '維護中', before: yn(current.maintenance), after: yn(next.maintenance) });
        if (Number(current.minBet) !== Number(next.minBet)) out.push({ label: '單注下限', before: String(current.minBet), after: String(next.minBet) });
        if (Number(current.maxBet) !== Number(next.maxBet)) out.push({ label: '單注上限', before: String(current.maxBet), after: String(next.maxBet) });
        return out;
    };

    const consequence = (next: GameOps): string => {
        const off = current.enabled && !next.enabled;
        const maint = !current.maintenance && next.maintenance;
        if (off && maint) return `${GAME_LABEL[id]} 會從大廳消失，而且標記為維護中。已經在桌上的玩家，下一次下注會被擋下來。`;
        if (off) return `${GAME_LABEL[id]} 會從大廳消失。已經在桌上的玩家看得到畫面，但下一次下注會被擋下來。`;
        return `${GAME_LABEL[id]} 在大廳仍然看得到，但玩家進不去。已經在桌上的，下一次下注會被擋下來。`;
    };

    return (
        <Paper sx={{ p: 2.5 }}>
            <Formik<GameOps>
                enableReinitialize
                initialValues={current}
                validationSchema={schema}
                onSubmit={(values, helpers) => {
                    helpers.setSubmitting(false);
                    // 會把玩家擋在門外的變更先問一次，其餘直接存
                    if (locksPlayersOut(values)) setPending(values);
                    else apply(values);
                }}
            >
                {({ values, dirty, isValid, resetForm }) => (
                    <Form>
                        <Stack spacing={1.5}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography sx={{ fontWeight: 600 }}>{GAME_LABEL[id]}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                    {id}
                                </Typography>
                            </Box>
                            <Divider />

                            <Field name="enabled">
                                {({ field, form }: FieldProps) => (
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={field.value}
                                                onChange={(e) => form.setFieldValue('enabled', e.target.checked)}
                                            />
                                        }
                                        label={<Typography variant="body2">上架（關閉後大廳不顯示）</Typography>}
                                    />
                                )}
                            </Field>

                            <Field name="maintenance">
                                {({ field, form }: FieldProps) => (
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                color="warning"
                                                checked={field.value}
                                                onChange={(e) => form.setFieldValue('maintenance', e.target.checked)}
                                            />
                                        }
                                        label={<Typography variant="body2">維護中（看得到但進不去）</Typography>}
                                    />
                                )}
                            </Field>

                            <Box sx={{ display: 'flex', gap: 1.5 }}>
                                {(['minBet', 'maxBet'] as const).map((name) => (
                                    <Field key={name} name={name}>
                                        {({ field, meta }: FieldProps) => (
                                            <TextField
                                                {...field}
                                                type="number"
                                                label={name === 'minBet' ? '單注下限' : '單注上限（限紅）'}
                                                // 錯誤訊息不等 touched，有錯就顯示。
                                                // 等 touched 的話會出現「儲存鈕變灰、但畫面上沒有任何理由」的狀態——
                                                // 使用者改了一個非法的值卻還沒離開欄位，就不知道自己錯在哪。
                                                // 初始值一定是合法的，所以不會一進來就滿江紅
                                                error={Boolean(meta.error)}
                                                helperText={meta.error ?? ' '}
                                                fullWidth
                                            />
                                        )}
                                    </Field>
                                ))}
                            </Box>

                            <Typography variant="caption" color="text.secondary">
                                目前可押區間：{money(Number(values.minBet) || 0)} ～ {money(Number(values.maxBet) || 0)}
                            </Typography>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                {/* 沒權限的時候要說得出原因。**一個不說為什麼的灰色按鈕，
                                    使用者只會覺得系統壞了然後跑去問客服** */}
                                <Tooltip title={writable ? '' : denyReason('ops.write', role)}>
                                    <span>
                                        <Button
                                            type="submit" variant="contained" size="small"
                                            disabled={!writable || !dirty || !isValid}
                                        >
                                            儲存
                                        </Button>
                                    </span>
                                </Tooltip>
                                <Button onClick={() => resetForm()} disabled={!dirty} size="small">
                                    取消
                                </Button>
                            </Box>
                        </Stack>
                    </Form>
                )}
            </Formik>

            <ConfirmDialog
                open={Boolean(pending)}
                title={`${GAME_LABEL[id]}：確認變更`}
                consequence={pending ? consequence(pending) : ''}
                changes={pending ? changesOf(pending) : []}
                confirmLabel="套用變更"
                onConfirm={() => pending && apply(pending)}
                onCancel={() => setPending(null)}
            />
        </Paper>
    );
}

export function GameConfigPage(): React.ReactElement {
    const can = useCan();
    const role = useRole();
    const manageable = can('data.manage');
    const opsWritable = can('ops.write');

    // 資料存在哪裡要讓人看得到。**「我的資料放在哪」是使用者會問的問題**，
    // 尤其在一個把資料庫放在瀏覽器裡的 demo
    /** 資料工具裡待確認的那一個動作。三個都會蓋掉或刪掉東西，所以三個都要問 */
    const [confirm, setConfirm] = React.useState<'reset' | 'seed' | 'clear' | null>(null);
    const [backend, setBackend] = React.useState('偵測中…');
    React.useEffect(() => {
        void backendName().then(setBackend);
    }, []);
    const [toast, setToast] = React.useState('');

    return (
        <Stack spacing={2}>
            <Typography variant="h6">遊戲設定</Typography>

            <Alert severity="info" variant="outlined">
                這一頁改的值會即時送到遊戲端。開著「遊樂場」那個分頁的話，
                把單注上限調到 100 再回去押 500，會直接被擋下來——
                <strong>不必重新整理</strong>。
            </Alert>

            {/* 用 grid 不用 flex：flex 換行時最後一列的卡會被 flex-grow 拉滿整行，
                四張卡在中等寬度下會排成「三張 + 一張超寬」。grid 的每一格等寬，換行也不會變形 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 2 }}>
                {GAME_IDS.map((id) => (
                    <GameCard key={id} id={id} onSaved={setToast} />
                ))}
            </Box>

            <Paper sx={{ p: 2.5 }}>
                <Typography sx={{ fontWeight: 600, mb: 0.5 }}>資料工具</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.8 }}>
                    注單、金流、玩家與稽核四張表存在 <strong>{backend}</strong>；
                    營運設定（上面那四張卡）留在 localStorage——
                    它不到 1KB，而且限紅檢查是在下注的同步流程裡跑的，不能等非同步讀取。
                    <br />
                    種子資料是用四款玩法真正的規則跑出來的，亂數有固定種子，
                    所以重新產生會得到同一份資料。
                    <br />
                    產生的注額會<strong>夾進上面那四張卡的限紅區間</strong>——把單注上限調小再重新產生，
                    歷史注單會跟著變。這不是為了展示而設計的連動，
                    是因為一筆超過限紅的注單在真實系統裡本來就不可能存在。
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                    <Tooltip title={opsWritable ? '' : denyReason('ops.write', role)}>
                        <span>
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={!opsWritable}
                                onClick={() => setConfirm('reset')}
                            >
                                還原預設設定
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={manageable ? '' : denyReason('data.manage', role)}>
                        <span>
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={!manageable}
                                onClick={() => setConfirm('seed')}
                            >
                                重新產生種子資料
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={manageable ? '' : denyReason('data.manage', role)}>
                        <span>
                            <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                disabled={!manageable}
                                onClick={() => setConfirm('clear')}
                            >
                                清空全部（注單 {money(ledgerCount())} 筆 · 交易 {money(txCount())} 筆）
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
            </Paper>

            {/* 三個資料工具的確認。**每一個講的都是「會發生什麼」，不是「你正在做什麼」**——
                使用者按下按鈕的時候就已經知道自己按了什麼了 */}
            <ConfirmDialog
                open={confirm === 'reset'}
                title="還原營運設定"
                consequence="四款遊戲的上下架、維護狀態與限紅會全部回到預設值，而且立刻送到遊戲端。目前的設定沒有備份，但操作紀錄會記下原本的值。"
                confirmLabel="還原設定"
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    resetOps();
                    setConfirm(null);
                    setToast('營運設定已還原為預設值');
                }}
            />

            <ConfirmDialog
                open={confirm === 'seed'}
                title="重新產生展示資料"
                // 這句是這個對話框存在的理由：**「標記與備註會不見」是使用者最可能沒想到的後果**
                consequence={`現有的 ${money(ledgerCount())} 筆注單、${money(playerCount())} 個帳號與 ${money(txCount())} 筆交易會被整批換掉，包括你在玩家管理裡加上的風控標記與備註。操作紀錄不受影響。`}
                confirmLabel="重新產生"
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    // 三張表一起清。seed() 內部也會清玩家與交易，
                    // 但注單得在這裡清——**留著舊注單的話 seedIfEmpty 的語意會不一致**，
                    // 而且新舊兩批資料的玩家 id 對不上
                    clearLedger();
                    const n = seed();
                    setConfirm(null);
                    setToast(`已重新產生 ${money(n)} 筆注單、${money(playerCount())} 個帳號、${money(txCount())} 筆交易`);
                }}
            />

            <ConfirmDialog
                open={confirm === 'clear'}
                title="清空全部資料"
                danger
                consequence={`${money(ledgerCount())} 筆注單、${money(playerCount())} 個帳號與 ${money(txCount())} 筆交易會被刪除，這個動作沒有復原。操作紀錄會保留下來，並記下是誰清的、清掉了多少。`}
                confirmLabel="清空資料"
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    // 清空走資料層的 clearAll()，不是在這裡呼叫三個 clear——
                    // 因為它要在稽核表裡留下一筆「誰清的、清掉了多少」，
                    // 而那筆紀錄**不會**被這個按鈕清掉
                    clearAll();
                    setConfirm(null);
                    setToast('注單、玩家與金流已清空（稽核紀錄保留）');
                }}
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
