import { useEffect } from 'react';
import { BETS, SPIN_STYLES, STOP_ORDERS, useSlotStore } from '../games/slot/store';
import { useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';

/**
 * 老虎機的操作面板——**只有這一款玩法在用的那些控制項**。
 *
 * 跟外殼（Hud.tsx）分開的判準跟 store 一樣：餘額、連線、返回鍵每一款玩法都要，
 * 所以留在殼；押注額、SPIN 鍵、起轉演法只有轉軸有意義，所以在這裡。百家樂的面板
 * 會是另一支檔案，兩邊互不知道對方存在。
 *
 * 匯出的是**兩塊**而不是一整片：殼的底部面板有「讀數」與「控制」兩個位置（見 style.css
 * 的 .dock 格線），玩法各自填。切成兩塊是為了讓餘額與玩法自己的讀數能排在同一行——
 * 若玩法只給一整塊，那一行就得由玩法自己重畫一次餘額，兩款玩法就有兩份會走樣的複本。
 *
 * 這一支完全不需要知道 Pixi 那側是誰、有沒有掛載——SPIN 鍵呼叫的是 store 裡的 handler，
 * 玩法卸載時 handler 變 null，按鈕自動失效。
 */

function BetPicker() {
    const t = useT();
    const bet = useSlotStore((s) => s.bet);
    const setBet = useSlotStore((s) => s.setBet);
    const spinning = useSlotStore((s) => s.spinning);

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
    const value = useSlotStore((s) => s.spinStyle);
    const onPick = useSlotStore((s) => s.setSpinStyle);
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
    const value = useSlotStore((s) => s.stopOrder);
    const onPick = useSlotStore((s) => s.setStopOrder);
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

/** 讀數插槽：跟殼的餘額排在同一行。 */
export function SlotReadouts() {
    const t = useT();
    const lastWin = useSlotStore((s) => s.lastWin);

    return (
        <div className="stat">
            <span className="cap">{t('arcade.win')}</span>
            <strong className={`val${lastWin > 0 ? ' hit' : ''}`}>
                {lastWin > 0 ? `+${lastWin.toLocaleString()}` : '—'}
            </strong>
        </div>
    );
}

/** 控制插槽：押注、SPIN、表演選項。 */
export function SlotControls() {
    const t = useT();
    const connection = useArcadeStore((s) => s.connection);
    const spinning = useSlotStore((s) => s.spinning);
    const spinHandler = useSlotStore((s) => s.spinHandler);

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
        <>
            <BetPicker />

            <button type="button" className="spin" disabled={!canSpin} onClick={() => spinHandler?.()}>
                {spinning ? t('arcade.spinning') : t('arcade.spin')}
            </button>

            <SpinStylePicker />
            <StopOrderPicker />
        </>
    );
}
