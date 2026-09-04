import * as React from 'react';
import {
    Alert, Box, Button, Divider, FormControlLabel, Paper, Snackbar, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { Formik, Form, Field, type FieldProps } from 'formik';
import * as Yup from 'yup';
import type { GameId } from '../../arcade/net/protocol';
import { clear as clearLedger, count as ledgerCount } from '../../arcade/server/ledger';
import { forGame, reset as resetOps, subscribe as subscribeOps, update, type GameOps } from '../../arcade/server/opsConfig';
import { GAME_IDS, GAME_LABEL, money } from '../format';
import { seed } from '../seed';

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

    // 別的分頁改了設定要跟著更新（例如同時開兩個後台分頁）
    const [revision, setRevision] = React.useState(0);
    React.useEffect(() => subscribeOps(() => setRevision((n) => n + 1)), []);
    const current = React.useMemo(() => forGame(id), [id, revision]);

    return (
        <Paper sx={{ p: 2.5 }}>
            <Formik<GameOps>
                enableReinitialize
                initialValues={current}
                validationSchema={schema}
                onSubmit={(values, helpers) => {
                    update(id, {
                        ...values,
                        minBet: Number(values.minBet),
                        maxBet: Number(values.maxBet),
                    });
                    helpers.setSubmitting(false);
                    onSaved(`${GAME_LABEL[id]} 已更新，遊戲端立即生效`);
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
                                <Button type="submit" variant="contained" disabled={!dirty || !isValid} size="small">
                                    儲存
                                </Button>
                                <Button onClick={() => resetForm()} disabled={!dirty} size="small">
                                    取消
                                </Button>
                            </Box>
                        </Stack>
                    </Form>
                )}
            </Formik>
        </Paper>
    );
}

export function GameConfigPage(): React.ReactElement {
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
                <Typography variant="caption" color="text.secondary">
                    種子注單是用四款玩法真正的規則跑出來的，亂數有固定種子，
                    所以重新產生會得到同一份資料。
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                            resetOps();
                            setToast('營運設定已還原為預設值');
                        }}
                    >
                        還原預設設定
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                            clearLedger();
                            const n = seed();
                            setToast(`已重新產生 ${money(n)} 筆注單`);
                        }}
                    >
                        重新產生種子注單
                    </Button>
                    <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={() => {
                            clearLedger();
                            setToast('注單已清空');
                        }}
                    >
                        清空注單（目前 {money(ledgerCount())} 筆）
                    </Button>
                </Box>
            </Paper>

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
