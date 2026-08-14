import { useEffect } from 'react';
import { useArcadeStore } from '../store';
import { SlotControls, SlotReadouts } from './SlotPanel';
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
    const game = useArcadeStore((s) => s.game);
    switch (game) {
        case 'slot':
            return <SlotReadouts />;
        case 'baccarat':
        case null:
            return null;
    }
}

function GameControls() {
    const game = useArcadeStore((s) => s.game);
    switch (game) {
        case 'slot':
            return <SlotControls />;
        case 'baccarat':
        case null:
            return null;
    }
}

export function Hud() {
    const t = useT();

    return (
        <div className="hud">
            <header className="top">
                <a className="back" href="./index.html" ref={wireGoBack}>
                    {t('nav.backHome')}
                </a>
                <div className="top-right">
                    <ConnectionBadge />
                </div>
            </header>

            <ErrorToast />

            <footer className="dock">
                <div className="readouts">
                    <Balance />
                    <GameReadouts />
                </div>

                <GameControls />

                {/* 這一頁最該讓人知道的一件事，直接寫在面板上而不是藏在 README 裡 */}
                <p className="note">{t('arcade.serverNote')}</p>
            </footer>
        </div>
    );
}
