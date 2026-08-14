import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useArcadeStore } from '../store';
import { SlotControls, SlotOptions, SlotReadouts } from './SlotPanel';
import { BaccaratControls, BaccaratOptions, BaccaratReadouts } from './BaccaratPanel';
import { useDockSide, useIsCompact } from './useIsCompact';
import { useT } from '../../i18n/useT';
import { wireGoBack } from '../../shell/goBack';

/**
 * canvas 外的**外殼**：每一款玩法都在的那一圈。
 *
 * 分工跟 Shader Lab 一樣：**React 管 canvas 外，Pixi 管 canvas 內**，中間只透過 store
 * 溝通（見 ../store.ts）。這一頁多一層——canvas 裡的玩法會整批換掉，所以殼也得跟著分：
 * 返回鍵、連線徽章、餘額、錯誤提示不管玩什麼都在，換玩法時**不該重新掛載**；
 * 押注額、SPIN 鍵這種只有轉軸才有的東西住在玩法自己的面板（見 SlotPanel.tsx）。
 *
 * 底部面板留了兩個插槽——讀數與控制——由目前玩法填。殼不知道那些插槽裡是什麼，
 * 玩法也不知道自己被放在哪，兩邊只認 store 裡的 `game`。
 */

function ConnectionBadge() {
    const t = useT();
    const state = useArcadeStore((s) => s.connection);
    const label = state === 'open' ? t('arcade.online') : state === 'connecting' ? t('arcade.connecting') : t('arcade.offline');
    return <span className={`conn ${state}`}>{label}</span>;
}

/**
 * 錯誤訊息顯示幾秒就自己收掉——它是即時回饋，不是需要使用者關掉的對話框。
 *
 * store 裡存的是錯誤**代碼**（server 給的原樣），翻譯在這裡才發生：
 * server 不該知道使用者的語言，而同一個代碼在兩種語言下要能換掉整句話。
 */
function ErrorToast() {
    const t = useT();
    const error = useArcadeStore((s) => s.error);
    const setError = useArcadeStore((s) => s.setError);

    useEffect(() => {
        if (!error) return;
        const id = window.setTimeout(() => setError(null), 2600);
        return () => window.clearTimeout(id);
    }, [error, setError]);

    if (!error) return null;
    return <div className="toast" role="alert">{t(`arcade.error.${error}`)}</div>;
}

/** 餘額。跨玩法延續，所以它屬於殼而不屬於任何一張桌（見 server/wallet.ts）。 */
function Balance() {
    const t = useT();
    const balance = useArcadeStore((s) => s.balance);
    return (
        <div className="stat">
            <span className="cap">{t('arcade.balance')}</span>
            <strong className="val">{balance.toLocaleString()}</strong>
        </div>
    );
}

/**
 * 目前玩法的讀數與控制。
 *
 * 用 switch 而不是查表，是為了讓 `GameId` 加一款而這裡忘了補時**編譯就失敗**——
 * 查表可以寫成 `map[game] ?? null`，漏了一款會靜默地顯示空面板，那種錯只有在
 * 手動點進去玩的時候才會發現。
 */
function GameReadouts() {
    const scene = useArcadeStore((s) => s.scene);
    switch (scene) {
        case 'slot':
            return <SlotReadouts />;
        case 'baccarat':
            return <BaccaratReadouts />;
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
            return <BaccaratControls />;
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
            return <BaccaratOptions />;
        case 'lobby':
        case null:
            return null;
    }
}

/**
 * 資源核對：**這一頁在架構上想證明的事，就是這一行數字**。
 *
 * 顯示的是上一次卸載時登記了幾個資源、漏了幾個，以及 renderer 現在握著幾個 texture
 * source 對照剛開站時的基線。切個幾輪玩法再回大廳，基線那個數字應該回到原點——
 * 那才是「玩法之間不互相汙染」的證據，而不是嘴上說說（見 core/module.ts）。
 */
function ResourceMeter() {
    const t = useT();
    const report = useArcadeStore((s) => s.lastDispose);
    const scene = useArcadeStore((s) => s.lastDisposedScene);
    const previous = useArcadeStore((s) => s.previousTexture);

    if (!report || !scene) return null;

    // 跟**同一個場景上一次**的數字比（見 store 的 lastTextureByScene）。
    // 第一次卸載某個場景時沒得比，那時只顯示絕對值。
    const drift = previous === null ? 0 : report.textureSources - previous;
    const clean = report.leaked === 0 && drift <= 0;

    return (
        <span className={`meter${clean ? ' ok' : ' warn'}`} title={t('arcade.meter.hint')}>
            {t('arcade.meter.label')} {report.tracked}
            {' · '}
            {t('arcade.meter.leaked')} {report.leaked}
            {' · '}
            tex {report.textureSources}
            {previous === null ? '' : drift === 0 ? ' ±0' : ` ${drift > 0 ? '+' : ''}${drift}`}
        </span>
    );
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

/** 返回鍵。在玩法裡是回大廳，在大廳才是離開這一頁。 */
function BackLink() {
    const t = useT();
    const scene = useArcadeStore((s) => s.scene);
    const enter = useArcadeStore((s) => s.enter);

    if (scene !== null && scene !== 'lobby') {
        return (
            <button type="button" className="back" onClick={() => enter?.('lobby')}>
                {t('arcade.backLobby')}
            </button>
        );
    }

    return (
        <a className="back" href="./index.html" ref={wireGoBack}>
            {t('nav.backHome')}
        </a>
    );
}

export function Hud() {
    const t = useT();
    const scene = useArcadeStore((s) => s.scene);
    const compact = useIsCompact();
    const side = useDockSide();

    // 大廳不需要操作面板——那裡沒有東西可以操作，留著只會擋住機台卡片
    const inGame = scene !== null && scene !== 'lobby';
    const dockRef = useDockMeasure(inGame, side);

    // 這一頁最該讓人知道的一件事，直接寫在面板上而不是藏在 README 裡。
    // 窄畫面它會跟著選項一起進抽屜——不是刪掉，是換個位置：那段話在 390 寬會換成九行，
    // 留在外面等於用 210px 的畫面去講一件玩家隨時可以展開來看的事
    const note = <p className="note">{t('arcade.serverNote')}</p>;

    return (
        <div className="hud">
            <header className="top">
                <BackLink />
                <div className="top-right">
                    <ResourceMeter />
                    {inGame && <ConnectionBadge />}
                </div>
            </header>

            <ErrorToast />

            {inGame && (
                <footer className="dock" ref={dockRef as React.RefObject<HTMLElement>}>
                    <div className="readouts">
                        <Balance />
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
