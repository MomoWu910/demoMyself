import * as React from 'react';
import {
    AppBar, Box, Chip, CssBaseline, Divider, Drawer, IconButton, List, ListItemButton,
    ListItemIcon, ListItemText, MenuItem, TextField, Toolbar, Tooltip, Typography,
    useMediaQuery,
} from '@mui/material';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import DarkIcon from '@mui/icons-material/DarkModeOutlined';
import DensityIcon from '@mui/icons-material/DensitySmall';
import DensityLargeIcon from '@mui/icons-material/DensityMedium';
import LightIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import CasinoIcon from '@mui/icons-material/Casino';
import DashboardIcon from '@mui/icons-material/InsertChartOutlined';
import HistoryIcon from '@mui/icons-material/HistoryToggleOff';
import PaymentsIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import ReceiptIcon from '@mui/icons-material/ReceiptLong';
import SettingsIcon from '@mui/icons-material/Tune';
import { count, subscribe } from '../arcade/server/ledger';
import { count as playerCount } from '../arcade/server/players';
import { BetsPage } from './pages/Bets';
import { DashboardPage } from './pages/Dashboard';
import { GameConfigPage } from './pages/GameConfig';
import { AuditPage } from './pages/Audit';
import { FinancePage } from './pages/Finance';
import { PlayersPage } from './pages/Players';
import { money } from './format';
import { createAdminTheme } from './theme';
import { ROLES, setRole, useRole, type Role } from './useAuth';
import { DensityContext, useAppearance } from './useTheme';

/**
 * 後台的外殼。
 *
 * **路由用 hash，不裝 router 套件。**
 * 這個後台只有三頁而且不會長出巢狀路由，`react-router` 帶來的東西
 * （巢狀 outlet、loader、動態參數）一項都用不到，卻要多背一個相依與它的升級成本。
 * 三頁的切換用 `location.hash` 就夠，而且 hash 有一個附帶好處：
 * **重新整理會留在同一頁**，這在後台很重要——改設定改到一半按了 F5 不會被丟回首頁。
 */

const PAGES = [
    { key: 'dashboard', label: '營運總覽', icon: <DashboardIcon fontSize="small" />, render: () => <DashboardPage /> },
    { key: 'bets', label: '注單查詢', icon: <ReceiptIcon fontSize="small" />, render: () => <BetsPage /> },
    // 玩家排在注單與設定中間，不是排最後：**後台的動線是「看到異常 → 找出是誰 → 處置」**，
    // 而選單的順序就是那條動線
    { key: 'players', label: '玩家管理', icon: <PeopleIcon fontSize="small" />, render: () => <PlayersPage /> },
    { key: 'finance', label: '金流管理', icon: <PaymentsIcon fontSize="small" />, render: () => <FinancePage /> },
    { key: 'games', label: '遊戲設定', icon: <SettingsIcon fontSize="small" />, render: () => <GameConfigPage /> },
    // 操作紀錄排最後：它不是日常動線的一部分，是出事之後才會打開的那一頁
    { key: 'audit', label: '操作紀錄', icon: <HistoryIcon fontSize="small" />, render: () => <AuditPage /> },
] as const;

const SIDEBAR = 216;

function useHashRoute(): [string, (k: string) => void] {
    const read = () => window.location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [key, setKey] = React.useState(read);

    React.useEffect(() => {
        const onChange = () => setKey(read());
        window.addEventListener('hashchange', onChange);
        return () => window.removeEventListener('hashchange', onChange);
    }, []);

    return [key, (k: string) => { window.location.hash = `/${k}`; }];
}

/**
 * 最外層：只負責提供主題。
 *
 * 拆成兩層是因為 `useMediaQuery(theme.breakpoints…)` 要**在 ThemeProvider 裡面**
 * 才讀得到斷點。寫在同一個元件裡的話，它拿到的是 MUI 的預設主題而不是這裡這個——
 * 而預設主題的斷點剛好也是 900px，所以**它會正常運作，直到有人改了斷點**，
 * 那時候版面會在一個沒有人動過的地方壞掉。
 */
export function App(): React.ReactElement {
    const { mode, density, setMode, setDensity } = useAppearance();
    const theme = React.useMemo(() => createAdminTheme(mode, density), [mode, density]);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <DensityContext.Provider value={density}>
                <AppShell
                    mode={mode}
                    density={density}
                    onToggleMode={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                    onToggleDensity={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}
                />
            </DensityContext.Provider>
        </ThemeProvider>
    );
}

function AppShell(props: {
    mode: 'dark' | 'light';
    density: 'compact' | 'comfortable';
    onToggleMode: () => void;
    onToggleDensity: () => void;
}): React.ReactElement {
    const { mode, density, onToggleMode, onToggleDensity } = props;
    const [route, go] = useHashRoute();
    const role = useRole();

    /**
     * 窄畫面把側欄收成抽屜。
     *
     * `permanent` 的 216px 側欄在手機上會把內容擠成一條——
     * 而後台「不會有人用手機看」是一個很常見但不成立的假設：
     * 值班的人半夜收到告警，手上就只有手機。
     */
    const theme = useTheme();
    const narrow = useMediaQuery(theme.breakpoints.down('md'));
    const [drawerOpen, setDrawerOpen] = React.useState(false);
    // 注單筆數放在側欄底部，遊戲那頁下注時會即時跳動——
    // 這是最省事的「兩個分頁真的連著」的證據
    const [total, setTotal] = React.useState(0);
    React.useEffect(() => {
        setTotal(count());
        return subscribe(() => setTotal(count()));
    }, []);

    // 換頁時把抽屜收起來。**窄畫面選了一項卻停在選單上**，
    // 使用者會以為沒點到，然後再點一次
    const goPage = (key: string): void => {
        go(key);
        setDrawerOpen(false);
    };

    const nav = (
        <>
            <Toolbar variant="dense" />
            <List dense sx={{ pt: 1 }}>
                {PAGES.map((p) => (
                    <ListItemButton
                        key={p.key}
                        selected={p.key === route}
                        onClick={() => goPage(p.key)}
                        sx={{ mx: 1, borderRadius: 1, mb: 0.25 }}
                    >
                        <ListItemIcon sx={{ minWidth: 34 }}>{p.icon}</ListItemIcon>
                        <ListItemText primary={p.label} />
                    </ListItemButton>
                ))}
            </List>

            <Box sx={{ flex: 1 }} />
            <Divider />
            <Box sx={{ p: 2 }}>
                {/* display 要走 sx —— Typography 的 display prop 是 v4 時代的 API，
                    新版已經拿掉，寫上去型別不過 */}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    注單總筆數
                </Typography>
                <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 18 }}>
                    {money(total)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {money(playerCount())} 個帳號
                </Typography>
            </Box>
        </>
    );

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
            <AppBar
                position="fixed"
                elevation={0}
                sx={{
                    zIndex: (t) => t.zIndex.drawer + 1,
                    // 顏色走 palette 而不是寫死 #12151c——那個字面值在亮色模式下
                    // 會變成一條突兀的深色橫槓，而它是「有主題系統但沒在用」的典型症狀
                    background: (t) => (t.palette.mode === 'dark' ? '#12151c' : '#ffffff'),
                    color: 'text.primary',
                    borderBottom: (t) => `1px solid ${t.palette.divider}`,
                }}
            >
                <Toolbar variant="dense" sx={{ gap: 1.5 }}>
                    {narrow && (
                        <IconButton edge="start" size="small" onClick={() => setDrawerOpen(true)} aria-label="開啟選單">
                            <MenuIcon fontSize="small" />
                        </IconButton>
                    )}
                    <CasinoIcon sx={{ color: 'primary.main' }} />
                    {/* 窄畫面把標題收掉，位置留給右邊那些真的要按的東西 */}
                    {!narrow && (
                        <Typography sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>
                            遊戲營運管理後台
                        </Typography>
                    )}
                    <Chip size="small" label="DEMO" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    <Box sx={{ flex: 1 }} />

                    <Tooltip title={density === 'compact' ? '目前是緊湊：一頁看得到最多列' : '目前是寬鬆：列高與字級都放大'}>
                        <IconButton size="small" onClick={onToggleDensity} aria-label="切換資訊密度">
                            {density === 'compact' ? <DensityIcon fontSize="small" /> : <DensityLargeIcon fontSize="small" />}
                        </IconButton>
                    </Tooltip>

                    <Tooltip title={mode === 'dark' ? '切換到亮色' : '切換到深色'}>
                        <IconButton size="small" onClick={onToggleMode} aria-label="切換亮暗">
                            {mode === 'dark' ? <LightIcon fontSize="small" /> : <DarkIcon fontSize="small" />}
                        </IconButton>
                    </Tooltip>

                    {/* 身分切換。
                        **這裡刻意不做登入表單。** 假的帳號密碼框會讓人以為有真的驗證
                        （而驗證只能發生在後端），而且教人把密碼打進一個沒有後端的表單
                        本身就是壞示範。展示權限系統真正有內容的那一半就好：誰能做什麼。 */}
                    <Tooltip title={ROLES[role].description}>
                        <TextField
                            select
                            size="small"
                            value={role}
                            onChange={(e) => setRole(e.target.value as Role)}
                            sx={{ minWidth: 130, '& .MuiOutlinedInput-root': { fontSize: 13 } }}
                        >
                            {(Object.keys(ROLES) as Role[]).map((r) => (
                                <MenuItem key={r} value={r} sx={{ fontSize: 13 }}>
                                    {ROLES[r].label}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Tooltip>

                    {!narrow && (
                        <Typography
                            component="a"
                            href="arcade.html"
                            target="_blank"
                            variant="body2"
                            sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                        >
                            開啟遊樂場 ↗
                        </Typography>
                    )}
                </Toolbar>
            </AppBar>

            {/* 兩種抽屜，同一份導覽內容。
                窄畫面用 `temporary`（浮在內容上、點外面關掉），寬畫面用 `permanent`。
                **不要用 CSS 把同一個 permanent 抽屜藏起來**——那樣它在窄畫面上
                仍然佔著版面寬度，而且鍵盤仍然 tab 得到一個看不見的選單 */}
            <Drawer
                variant={narrow ? 'temporary' : 'permanent'}
                open={narrow ? drawerOpen : true}
                onClose={() => setDrawerOpen(false)}
                // 窄畫面保留 DOM，開關才不會每次都重新掛載一次選單
                ModalProps={{ keepMounted: true }}
                sx={{
                    width: narrow ? 0 : SIDEBAR,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: SIDEBAR,
                        boxSizing: 'border-box',
                        background: (t) => (t.palette.mode === 'dark' ? '#12151c' : '#fafbfc'),
                        borderRight: (t) => `1px solid ${t.palette.divider}`,
                    },
                }}
            >
                {nav}
            </Drawer>

            <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
                <Toolbar variant="dense" />
                {PAGES.find((p) => p.key === route)?.render() ?? PAGES[0].render()}
            </Box>
        </Box>
    );
}
