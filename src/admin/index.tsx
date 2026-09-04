import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { App } from './App';
import { seedIfEmpty } from './seed';
import { theme } from './theme';

/**
 * 後台的進入點。
 *
 * 種子資料在掛載 React **之前**灌完。放在 useEffect 裡的話，
 * 第一次繪製會看到一個空的儀表板然後數字才跳出來——
 * 那一瞬間的空狀態不是在傳達任何資訊，只是在洩漏實作順序。
 */
seedIfEmpty();

const el = document.getElementById('root');
if (el) {
    createRoot(el).render(
        <React.StrictMode>
            <ThemeProvider theme={theme} defaultMode="dark">
                <App />
            </ThemeProvider>
        </React.StrictMode>,
    );
}
