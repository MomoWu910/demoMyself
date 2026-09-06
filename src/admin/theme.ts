import { createTheme, type Theme } from '@mui/material/styles';

/**
 * 後台的主題。
 *
 * ---
 *
 * **深色是預設，但不是唯一。**
 *
 * 預設深色的理由沒有變：營運後台是**長時間盯著看的工具**，
 * 而這些頁面的資訊密度很高（一頁三十列注單、每列十個欄位）。
 *
 * 但「預設」跟「只有一種」是兩件事。第一版把 mode 寫死在 `createTheme` 裡，
 * 於是這個站等於宣告「所有人都該在暗處工作」——
 * 而實際上白天靠窗的位置、要投影給別人看的會議、
 * 列印一份報表出來，都是亮色比較好讀的場合。
 *
 * ---
 *
 * **這個檔案是「改一個地方、全站跟著變」的示範。**
 *
 * 底下每一個元件覆寫都不帶顏色字面值，全部走 palette 的語意色
 * （`background.paper`、`divider`、`text.secondary`）。
 * 所以切換亮暗時，這些覆寫一行都不用動——
 * **如果覆寫裡寫死了 `#161a22`，亮色模式就會出現一塊突兀的深色表頭，
 * 而那正是「有主題系統但沒在用」最常見的樣子。**
 */

export type Mode = 'dark' | 'light';

/**
 * 資訊密度。
 *
 * 這不是裝飾性的偏好，它決定**一個畫面裡放得下多少列**：
 * compact 一頁看得到三十列注單，comfortable 只有二十列出頭。
 * 對照著找異常值的時候，看得到的列數比每列多幾像素的呼吸空間重要；
 * 但要跟人一起看螢幕、或者手邊沒有滑鼠只能用觸控時，反過來。
 */
export type Density = 'compact' | 'comfortable';

/** 數字欄專用的字體堆疊。金額對齊靠它 */
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** 兩種密度的尺寸表。**集中在一個地方**，不要散在各元件的覆寫裡 */
const METRICS = {
    compact: { cellPadding: '7px 12px', fontSize: 13, rowHeight: 34 },
    comfortable: { cellPadding: '12px 16px', fontSize: 14, rowHeight: 44 },
} as const;

/** DataGrid 的列高要跟著密度走，各頁面從這裡讀 */
export function rowHeight(density: Density): number {
    return METRICS[density].rowHeight;
}

export function createAdminTheme(mode: Mode, density: Density): Theme {
    const m = METRICS[density];
    const dark = mode === 'dark';

    return createTheme({
        palette: {
            mode,
            // 琥珀金跟遊樂場那一頁同色系——後台跟它管的遊戲是同一套產品。
            // 亮色模式要壓深一階，不然金色在白底上讀不出來
            primary: { main: dark ? '#e8b84b' : '#9a6f14' },
            background: dark
                ? { default: '#0e1015', paper: '#161a22' }
                : { default: '#f4f5f7', paper: '#ffffff' },
            success: { main: dark ? '#4ec9a5' : '#1b7d5f' },
            error: { main: dark ? '#e56b6f' : '#c02c33' },
            warning: { main: dark ? '#e0a44a' : '#a86a10' },
            divider: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.12)',
        },
        typography: {
            fontFamily: '"Archivo", system-ui, -apple-system, "Noto Sans TC", sans-serif',
            fontSize: m.fontSize,
            h6: { fontWeight: 600, letterSpacing: '0.01em' },
        },
        shape: { borderRadius: 8 },
        components: {
            // 表格：padding 跟著密度走，顏色全部走 palette
            MuiTableCell: {
                styleOverrides: {
                    root: ({ theme }) => ({
                        padding: m.cellPadding,
                        borderColor: theme.palette.divider,
                    }),
                    head: ({ theme }) => ({
                        fontWeight: 600,
                        fontSize: m.fontSize - 1,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: theme.palette.text.secondary,
                        // 表頭底色從 paper 推一階，深淺兩色各自成立。
                        // 寫死 #131720 的話，亮色模式會出現一條深色橫槓
                        background: theme.palette.mode === 'dark' ? '#131720' : '#eceef1',
                        whiteSpace: 'nowrap',
                    }),
                },
            },
            MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
            MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none' } } },
            MuiTextField: { defaultProps: { size: 'small' } },
            MuiSelect: { defaultProps: { size: 'small' } },
            MuiTooltip: { defaultProps: { arrow: true } },
        },
    });
}
