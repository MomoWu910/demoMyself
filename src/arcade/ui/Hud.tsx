import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isTableScene, useArcadeStore } from '../store';
import { SlotControls, SlotOptions, SlotReadouts } from './SlotPanel';
import { useDockSide, useIsCompact } from './useIsCompact';
import { LobbyChrome } from './LobbyChrome';
import { TopBar } from './TopBar';
import { useT } from '../../i18n/useT';

/**
 * canvas 外的**外殼**：每一款玩法都在的那一圈。
 *
 * 分工跟 Shader Lab 一樣：**React 管 canvas 外，Pixi 管 canvas 內**，中間只透過 store
 * 溝通（見 ../store.ts）。這一頁多一層——canvas 裡的玩法會整批換掉，所以殼也得跟著分：
 * 頂列（返回、玩家、錢包、連線）不管在哪一個場景都在，換玩法時**不該重新掛載**；
 * 押注額、SPIN 鍵這種只有轉軸才有的東西住在玩法自己的面板（見 SlotPanel.tsx）；
 * 分類 tab 與頁腳只有大廳有（見 LobbyChrome.tsx）。
 *
 * 底部面板留了兩個插槽——讀數與控制——由目前玩法填。殼不知道那些插槽裡是什麼，
 * 玩法也不知道自己被放在哪，兩邊只認 store 裡的 `scene`。
 *
 * **這塊面板現在只剩老虎機在用。** 兩張百家樂桌台把整組介面搬進了畫布——牌桌要在
 * 同一個畫面裡排下路單、發牌區、注區與六個座位，而貼在畫面底的面板每長高一行，
 * 盤面就少一行。轉軸沒有這個問題（它只需要中間一塊），所以它留在原地。
 */

/**
 * 浮動提示。顯示幾秒就自己收掉——它是即時回饋，不是需要使用者關掉的對話框。
 *
 * 兩種語氣走同一個元件但配色不同：`error` 是操作失敗（紅），`notice` 是回答問題
 * （中性）。store 裡存的都是**鍵**而不是句子，翻譯在這裡才發生：server 不該知道
 * 使用者的語言，而同一個代碼在兩種語言下要能換掉整句話。
 */
function Toast() {
    const t = useT();
    const error = useArcadeStore((s) => s.error);
    const notice = useArcadeStore((s) => s.notice);
    const setError = useArcadeStore((s) => s.setError);
    const setNotice = useArcadeStore((s) => s.setNotice);

    useEffect(() => {
        if (!error && !notice) return;
        const id = window.setTimeout(() => {
            setError(null);
            setNotice(null);
        }, 2600);
        return () => window.clearTimeout(id);
    }, [error, notice, setError, setNotice]);

    if (error) {
        return <div className="toast" role="alert">{t(`arcade.error.${error}`)}</div>;
    }
    if (notice) {
        return <div className="toast info" role="status">{t(notice)}</div>;
    }
    return null;
}

/**
 * 目前玩法的讀數與控制。
 *
 * 用 switch 而不是查表，是為了讓 `GameId` 加一款而這裡忘了補時**編譯就失敗**——
 * 查表可以寫成 `map[game] ?? null`，漏了一款會靜默地顯示空面板，那種錯只有在
 * 手動點進去玩的時候才會發現。
 *
 * 目前只剩老虎機在用這三個插槽。兩張百家樂桌台把介面搬進了畫布——**桌上的東西
 * 應該由桌子自己排版**，貼在畫面底的面板每長高一行，盤面就少一行，而那一頁最缺的
 * 就是垂直空間（見 common/table/tableLayout.ts）。
 */
function GameReadouts() {
    const scene = useArcadeStore((s) => s.scene);
    switch (scene) {
        case 'slot':
            return <SlotReadouts />;
        case 'baccarat':
        case 'baccaratLive':
            // 兩張百家樂桌台的介面**整組住在畫布裡**（見 games/baccarat/index.ts 的
            // buildDeck）。留著 case 而不是從 switch 拿掉，是為了保持窮盡——
            // 加第四款玩法時忘了處理會編譯就失敗
            return null;
        case 'lobby':
        case null:
            return null;
    }
}

function GameControls() {
    const scene = useArcadeStore((s) => s.scene);
    switch (scene) {
        case 'slot':
            return <SlotControls />;
        case 'baccarat':
        case 'baccaratLive':
            // 兩張百家樂桌台的介面**整組住在畫布裡**（見 games/baccarat/index.ts 的
            // buildDeck）。留著 case 而不是從 switch 拿掉，是為了保持窮盡——
            // 加第四款玩法時忘了處理會編譯就失敗
            return null;
        case 'lobby':
        case null:
            return null;
    }
}

/** 玩法的次要選項——窄畫面會被整組收進抽屜（見 OptionsDrawer）。 */
function GameOptions() {
    const scene = useArcadeStore((s) => s.scene);
    switch (scene) {
        case 'slot':
            return <SlotOptions />;
        case 'baccarat':
        case 'baccaratLive':
            // 兩張百家樂桌台的介面**整組住在畫布裡**（見 games/baccarat/index.ts 的
            // buildDeck）。留著 case 而不是從 switch 拿掉，是為了保持窮盡——
            // 加第四款玩法時忘了處理會編譯就失敗
            return null;
        case 'lobby':
        case null:
            return null;
    }
}

/**
 * 窄畫面用的抽屜：把次要選項與說明收起來，預設不展開。
 *
 * 為什麼非做不可：豎屏把面板堆成單欄時，標籤與 chip 各自換行，老虎機的面板**實測長到
 * 576px**——在 390×844 的手機上等於 68% 的畫面，轉軸整個被蓋在後面看不到。收起來之後
 * 只剩「餘額 → 押注 → SPIN」這條每一把都要走的路徑留在外面。
 *
 * 它排在 SPIN **上方**，所以展開時面板往上長、SPIN 仍貼著畫面底部不動——拇指最順的
 * 位置不該因為打開一個抽屜就跑掉。代價是 tab 順序（bet → spin → 抽屜）跟視覺順序
 * 差一格，這是 grid 重排的既有取捨，比讓主按鈕跳位划算。
 */
function OptionsDrawer({ children }: { children: ReactNode }) {
    const t = useT();
    const [open, setOpen] = useState(false);

    return (
        <div className={`drawer${open ? ' open' : ''}`}>
            <button
                type="button"
                className="drawer-toggle"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                {t('arcade.moreOptions')}
                <span className="caret" aria-hidden="true" />
            </button>
            {/* 收起時整個不渲染而不是 display:none——面板高度是被 ResizeObserver 量出來
                回報給 canvas 的（見 useDockMeasure），留在 DOM 裡會讓那個數字量到展開後的高度 */}
            {open && <div className="drawer-body">{children}</div>}
        </div>
    );
}

/**
 * 量底部面板實際佔多高，寫進 store 給 canvas 那側讓位。
 *
 * 為什麼不寫死一個數字：面板高度**會變**——中英文的行數不同、每款玩法的控制項數量
 * 不同、窄畫面還會整個堆疊起來。寫死的話總有一種組合會讓下注區被蓋掉一半，
 * 而那是最常被點的地方。
 *
 * 連同下邊距一起回報（面板不是貼著畫面底），canvas 那側才不必知道 CSS 怎麼定位它。
 */
function useDockMeasure(active: boolean, side: 'bottom' | 'right'): React.RefObject<HTMLElement | null> {
    const ref = useRef<HTMLElement>(null);
    const setDockInset = useArcadeStore((s) => s.setDockInset);

    useEffect(() => {
        const el = ref.current;
        if (!active || !el) {
            setDockInset(0, 0);
            return;
        }

        const measure = (): void => {
            const rect = el.getBoundingClientRect();
            // 從面板貼的那一側算起，含它自己留的外邊距——canvas 那側因此不必知道
            // CSS 是用 bottom 還是 right 把它定位的，只要知道「這一側被吃掉多少」
            if (side === 'right') setDockInset(0, Math.round(window.innerWidth - rect.left));
            else setDockInset(Math.round(window.innerHeight - rect.top), 0);
        };
        measure();

        const ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
            setDockInset(0, 0);
        };
    }, [active, side, setDockInset]);

    return ref;
}

/**
 * 牌桌把語言切換收進了畫布裡那顆齒輪（見 games/baccarat/index.ts 的 menuSections），
 * 所以要把 DOM 那顆藏起來——**兩顆同時在畫面上，第二顆就只是雜訊**。
 *
 * 直接操作 `#lang-slot` 而不是把它 React 化：那顆鈕是 i18n 模組建的，整站共用
 * （見 i18n/index.ts 的 mountLangToggle），為了一頁的版面把它搬進 React 會讓其他六頁
 * 跟著改。離開牌桌時要還原，所以清理寫在 effect 的 return 裡。
 */
function useHideLangToggle(hide: boolean): void {
    useEffect(() => {
        const el = document.getElementById('lang-slot');
        if (!el || !hide) return;
        el.style.display = 'none';
        return () => {
            el.style.display = '';
        };
    }, [hide]);
}

export function Hud() {
    const t = useT();
    const scene = useArcadeStore((s) => s.scene);
    const compact = useIsCompact();
    const side = useDockSide();

    // 大廳不需要操作面板——那裡沒有東西可以操作，留著只會擋住機台卡片。
    // 兩張桌台也不需要：它們的介面在畫布裡（見上面 GameReadouts 的說明）
    const inGame = scene !== null && scene !== 'lobby';
    const atTable = isTableScene(scene);
    const hasDock = inGame && !atTable;
    const dockRef = useDockMeasure(hasDock, side);
    useHideLangToggle(atTable);

    // 這一頁最該讓人知道的一件事，直接寫在面板上而不是藏在 README 裡。
    // 窄畫面它會跟著選項一起進抽屜——不是刪掉，是換個位置：那段話在 390 寬會換成九行，
    // 留在外面等於用 210px 的畫面去講一件玩家隨時可以展開來看的事
    const note = <p className="note">{t('arcade.serverNote')}</p>;

    return (
        <div className="hud">
            <TopBar />

            {scene === 'lobby' && <LobbyChrome />}

            <Toast />

            {/*
                面板帶一個場景 class，讓某一款玩法微調自己的尺寸。現在只剩老虎機在用這塊
                面板——兩張百家樂桌台把介面搬進了畫布，因為**面板每高一 px，畫布那側就少
                一 px**，而那正是牌桌最缺的東西（見 common/table/tableLayout.ts）
            */}
            {hasDock && (
                <footer className={`dock dock--${scene}`} ref={dockRef as React.RefObject<HTMLElement>}>
                    <div className="readouts">
                        <GameReadouts />
                    </div>

                    <GameControls />

                    {compact ? (
                        <OptionsDrawer>
                            <GameOptions />
                            {note}
                        </OptionsDrawer>
                    ) : (
                        <>
                            <div className="options">
                                <GameOptions />
                            </div>
                            {note}
                        </>
                    )}
                </footer>
            )}
        </div>
    );
}
