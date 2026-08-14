import { useEffect } from 'react';
import { BETS, SPIN_STYLES, STOP_ORDERS, useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';
import { wireGoBack } from '../../shell/goBack';

/**
 * canvas 外的操作面板。
 *
 * 分工跟 Shader Lab 一樣：**React 管 canvas 外，Pixi 管 canvas 內**，中間只透過 store 溝通
 * （見 ../store.ts）。這樣寫的實際好處是這一支完全不需要知道玩法是誰、有沒有掛載——
 * SPIN 鈕呼叫的是 store 裡的 handler，玩法卸載時 handler 變 null，按鈕自動失效。
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

function BetPicker() {
    const t = useT();
    const bet = useArcadeStore((s) => s.bet);
    const setBet = useArcadeStore((s) => s.setBet);
    const spinning = useArcadeStore((s) => s.spinning);

    return (
        <div className="bet">
            <span className="cap">{t('arcade.bet')}</span>
            <div className="bet-row">
                {BETS.map((b) => (
                    <button
                        key={b}
                        type="button"
                        className={`chip${b === bet ? ' on' : ''}`}
                        // 轉動中不讓改押注：這一把的押注已經送出去了，改了畫面會跟伺服器結算的不一致
                        disabled={spinning}
                        onClick={() => setBet(b)}
                    >
                        {b}
                    </button>
                ))}
            </div>
        </div>
    );
}

/**
 * 表演選項的切換（起轉演法、停軸順序）。
 *
 * 放在面板上而不是寫死在程式裡，是因為手感這種東西**講不清楚，要當場按過才知道**——
 * 兩種起轉之間差的只有那 0.2 秒的蓄力，用文字描述遠不如按兩次來得直接。
 * 這些選項都不影響輸贏（盤面照樣是 server 算的），所以轉動中也讓改，下一把生效。
 */
function StylePicker<T extends string>({
    area,
    label,
    options,
    value,
    onPick,
    tKey,
}: {
    /** 這一組在面板格線上佔哪一列（見 style.css 的 .dock） */
    area: 'spin-style' | 'stop-order';
    label: string;
    options: readonly T[];
    value: T;
    onPick: (v: T) => void;
    /** 選項的翻譯字首，跟選項值接起來就是字典的 key */
    tKey: string;
}) {
    const t = useT();

    return (
        <div className={`style ${area}`}>
            <span className="cap">{t(label)}</span>
            <div className="style-row">
                {options.map((o) => (
                    <button
                        key={o}
                        type="button"
                        className={`chip${o === value ? ' on' : ''}`}
                        onClick={() => onPick(o)}
                    >
                        {t(`${tKey}.${o}`)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function SpinStylePicker() {
    const value = useArcadeStore((s) => s.spinStyle);
    const onPick = useArcadeStore((s) => s.setSpinStyle);
    return (
        <StylePicker
            area="spin-style"
            label="arcade.spinStyle"
            options={SPIN_STYLES}
            value={value}
            onPick={onPick}
            tKey="arcade.style"
        />
    );
}

function StopOrderPicker() {
    const value = useArcadeStore((s) => s.stopOrder);
    const onPick = useArcadeStore((s) => s.setStopOrder);
    return (
        <StylePicker
            area="stop-order"
            label="arcade.stopOrder"
            options={STOP_ORDERS}
            value={value}
            onPick={onPick}
            tKey="arcade.order"
        />
    );
}

export function Hud() {
    const t = useT();
    const balance = useArcadeStore((s) => s.balance);
    const lastWin = useArcadeStore((s) => s.lastWin);
    const spinning = useArcadeStore((s) => s.spinning);
    const connection = useArcadeStore((s) => s.connection);
    const spinHandler = useArcadeStore((s) => s.spinHandler);

    const canSpin = !!spinHandler && !spinning && connection === 'open';

    // 空白鍵也能轉——長時間玩的人不會一直去點按鈕
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat) return;
            const el = document.activeElement;
            // 焦點在按鈕上時讓瀏覽器原生行為處理，否則會觸發兩次
            if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) return;
            e.preventDefault();
            if (canSpin) spinHandler?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [canSpin, spinHandler]);

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
                    <div className="stat">
                        <span className="cap">{t('arcade.balance')}</span>
                        <strong className="val">{balance.toLocaleString()}</strong>
                    </div>
                    <div className="stat">
                        <span className="cap">{t('arcade.win')}</span>
                        <strong className={`val${lastWin > 0 ? ' hit' : ''}`}>
                            {lastWin > 0 ? `+${lastWin.toLocaleString()}` : '—'}
                        </strong>
                    </div>
                </div>

                <BetPicker />

                <button type="button" className="spin" disabled={!canSpin} onClick={() => spinHandler?.()}>
                    {spinning ? t('arcade.spinning') : t('arcade.spin')}
                </button>

                <SpinStylePicker />
                <StopOrderPicker />

                {/* 這一頁最該讓人知道的一件事，直接寫在面板上而不是藏在 README 裡 */}
                <p className="note">{t('arcade.serverNote')}</p>
            </footer>
        </div>
    );
}
