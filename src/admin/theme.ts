import { createTheme } from '@mui/material/styles';

/**
 * 後台的主題。
 *
 * 用深色不是為了好看，是因為**營運後台是長時間盯著看的工具**，
 * 而這一頁的資訊密度很高（一頁三十列注單、每列九個欄位）。
 *
 * 幾個刻意的設定：
 * - `density` 相關的間距全部壓縮：表格的預設 padding 是為了閱讀文章設計的，
 *   對照著看數字的時候，一頁能看到幾列比每列多幾像素的呼吸空間重要
 * - 數字一律用等寬字：金額欄不對齊的話，掃一整欄找異常值會很吃力
 * - accent 用琥珀金，跟遊樂場那一頁同色系——後台跟它管的遊戲是同一套產品
 */
export const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: { main: '#e8b84b' },
        background: { default: '#0e1015', paper: '#161a22' },
        success: { main: '#4ec9a5' },
        error: { main: '#e56b6f' },
        divider: 'rgba(255,255,255,0.09)',
    },
    typography: {
        fontFamily: '"Archivo", system-ui, -apple-system, "Noto Sans TC", sans-serif',
        fontSize: 13,
        h6: { fontWeight: 600, letterSpacing: '0.01em' },
    },
    shape: { borderRadius: 8 },
    components: {
        // 表格：壓縮 padding，讓一頁塞得下更多列
        MuiTableCell: {
            styleOverrides: {
                root: { padding: '7px 12px', borderColor: 'rgba(255,255,255,0.06)' },
                head: {
                    fontWeight: 600,
                    fontSize: 12,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.55)',
                    background: '#131720',
                    whiteSpace: 'nowrap',
                },
            },
        },
        MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
        MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none' } } },
        MuiTextField: { defaultProps: { size: 'small' } },
        MuiSelect: { defaultProps: { size: 'small' } },
    },
});

/** 數字欄專用的字體堆疊。金額對齊靠它 */
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
