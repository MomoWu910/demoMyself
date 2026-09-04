import * as React from 'react';
import {
    AppBar, Box, Chip, CssBaseline, Divider, Drawer, List, ListItemButton, ListItemIcon,
    ListItemText, Toolbar, Typography,
} from '@mui/material';
import CasinoIcon from '@mui/icons-material/Casino';
import DashboardIcon from '@mui/icons-material/InsertChartOutlined';
import ReceiptIcon from '@mui/icons-material/ReceiptLong';
import SettingsIcon from '@mui/icons-material/Tune';
import { count, subscribe } from '../arcade/server/ledger';
import { BetsPage } from './pages/Bets';
import { DashboardPage } from './pages/Dashboard';
import { GameConfigPage } from './pages/GameConfig';
import { money } from './format';

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
    { key: 'games', label: '遊戲設定', icon: <SettingsIcon fontSize="small" />, render: () => <GameConfigPage /> },
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

export function App(): React.ReactElement {
    const [route, go] = useHashRoute();
    const page = PAGES.find((p) => p.key === route) ?? PAGES[0];

    // 注單筆數放在側欄底部，遊戲那頁下注時會即時跳動——
    // 這是最省事的「兩個分頁真的連著」的證據
    const [total, setTotal] = React.useState(0);
    React.useEffect(() => {
        setTotal(count());
        return subscribe(() => setTotal(count()));
    }, []);

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
            <CssBaseline />

            <AppBar
                position="fixed"
                elevation={0}
                sx={{ zIndex: (t) => t.zIndex.drawer + 1, background: '#12151c', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
            >
                <Toolbar variant="dense" sx={{ gap: 1.5 }}>
                    <CasinoIcon sx={{ color: 'primary.main' }} />
                    <Typography sx={{ fontWeight: 600, letterSpacing: '0.02em' }}>
                        遊戲營運管理後台
                    </Typography>
                    <Chip size="small" label="DEMO" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    <Box sx={{ flex: 1 }} />
                    <Typography
                        component="a"
                        href="arcade.html"
                        target="_blank"
                        variant="body2"
                        sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                        開啟遊樂場 ↗
                    </Typography>
                </Toolbar>
            </AppBar>

            <Drawer
                variant="permanent"
                sx={{
                    width: SIDEBAR,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': {
                        width: SIDEBAR, boxSizing: 'border-box',
                        background: '#12151c', borderRight: '1px solid rgba(255,255,255,0.07)',
                    },
                }}
            >
                <Toolbar variant="dense" />
                <List dense sx={{ pt: 1 }}>
                    {PAGES.map((p) => (
                        <ListItemButton
                            key={p.key}
                            selected={p.key === page.key}
                            onClick={() => go(p.key)}
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
                </Box>
            </Drawer>

            <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>
                <Toolbar variant="dense" />
                {page.render()}
            </Box>
        </Box>
    );
}
