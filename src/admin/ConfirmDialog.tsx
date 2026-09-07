import * as React from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography,
} from '@mui/material';
import { MONO } from './theme';

/**
 * 危險操作的二次確認。
 *
 * ---
 *
 * **哪些操作要問，哪些不要——這條線比對話框長什麼樣重要得多。**
 *
 * 每個按鈕都問的後台，使用者會在兩天內學會不看內容直接按「確定」，
 * 而那時候真正危險的那一個也會被同樣的反射動作按掉。
 * **二次確認的價值來自它的稀有**。
 *
 * 這個後台的判準是：**會讓玩家玩不了，或者不容易復原。**
 *
 * - 調限紅的數字 → 不問。那是營運的日常工作，而且改回去就好
 * - 下架、維護中 → 問。玩家會被擋在門外
 * - 還原設定、重新產生資料、清空資料 → 問。前兩個會蓋掉現有的東西，第三個不可逆
 *
 * ---
 *
 * **對話框裡要重述「會發生什麼」，不是只問「確定嗎」。**
 *
 * 「確定要執行嗎？」這種問法沒有提供任何新資訊——使用者按下按鈕的時候就已經
 * 「確定」了，再問一次只是多一個步驟。有用的確認會告訴他**他可能沒想到的後果**：
 * 哪些資料會被蓋掉、玩家那邊會看到什麼、這件事能不能復原。
 *
 * 所以 `changes` 是列出來的（跟稽核紀錄同一個形式：舊值 → 新值），
 * 而 `consequence` 講的是後果不是動作。
 *
 * ---
 *
 * **什麼時候用對話框，什麼時候用行內確認？**
 *
 * 對話框會打斷動線，所以留給**按下去就生效**的操作：遊戲設定的儲存、
 * 資料工具那三顆、金流的放行與退件。
 *
 * 玩家管理的「停用帳號」用的是行內的紅色提示而不是對話框，
 * 因為那個開關**後面還有一道儲存**——已經有兩步了，再插一個對話框
 * 只是把同一件事問三次。注單作廢也是行內的：它要求填原因，
 * 而**填一段文字本身就是最強的一道確認**。
 */

export interface ConfirmChange {
    label: string;
    before: string;
    after: string;
}

export function ConfirmDialog(props: {
    open: boolean;
    title: string;
    /** 後果。**寫「會發生什麼」，不要寫「你正在做什麼」** */
    consequence: string;
    /** 變更清單。有的話會列出來，形式跟操作紀錄一致 */
    changes?: ConfirmChange[];
    /** 確認鈕的字。用動詞，不要用「確定」——按鈕上寫著要做的事，比較不會按錯 */
    confirmLabel: string;
    /** 紅色按鈕留給不可逆的操作 */
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}): React.ReactElement {
    const { open, title, consequence, changes, confirmLabel, danger, onConfirm, onCancel } = props;

    return (
        <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
            <DialogContent>
                <Alert severity={danger ? 'error' : 'warning'} variant="outlined" sx={{ mb: changes?.length ? 2 : 0 }}>
                    {consequence}
                </Alert>

                {changes?.length ? (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 0.75, columnGap: 2 }}>
                        {changes.map((c) => (
                            <React.Fragment key={c.label}>
                                <Typography variant="body2" color="text.secondary">{c.label}</Typography>
                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <Typography variant="body2" sx={{ fontFamily: MONO, color: 'text.disabled', textDecoration: 'line-through' }}>
                                        {c.before}
                                    </Typography>
                                    <Typography variant="body2" color="text.disabled">→</Typography>
                                    <Typography variant="body2" sx={{ fontFamily: MONO, color: 'primary.main' }}>
                                        {c.after}
                                    </Typography>
                                </Box>
                            </React.Fragment>
                        ))}
                    </Box>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>取消</Button>
                {/* **確認鈕不自動 focus。** 對話框一開就 focus 在危險按鈕上，
                    一個習慣按 Enter 的人會直接執行掉——那等於沒有這道確認 */}
                <Button variant="contained" color={danger ? 'error' : 'primary'} onClick={onConfirm}>
                    {confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
