import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapServerData } from '../arcade/server/bootstrap';
import { App } from './App';
import { seedIfEmpty } from './seed';

/**
 * 後台的進入點。
 *
 * **順序有意義：先灌資料層，再產生種子，最後才掛 React。**
 *
 * - 灌資料層是非同步的（IndexedDB），而且**一定要在 `seedIfEmpty()` 之前**——
 *   否則種子會看到一個空的注單表，然後把使用者既有的資料整批蓋掉
 * - 種子在掛載 React 之前跑完。放在 useEffect 裡的話，
 *   第一次繪製會看到一個空的儀表板然後數字才跳出來，
 *   而那一瞬間的空狀態不是在傳達任何資訊，只是在洩漏實作順序
 *
 * 等待期間畫面上是 index.html 裡那個載入標記——**不是白畫面**。
 * 這是換成非同步持久層之後才需要的東西：localStorage 時代讀取是同步的，
 * 根本沒有「等待」這回事。
 */
void bootstrapServerData().then(() => {
    seedIfEmpty();

    const el = document.getElementById('root');
    if (el) {
        createRoot(el).render(
            <React.StrictMode>
                <App />
            </React.StrictMode>,
        );
    }
});
