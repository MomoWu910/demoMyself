import { useEffect } from 'react';
import { AUTO_COUNTS, BETS, SPIN_STYLES, SPIN_TEMPOS, STOP_ORDERS, useSlotStore } from '../games/slot/store';
import { useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';

/**
 * 老虎機的操作面板——**只有這一款玩法在用的那些控制項**。
 *
 * 跟外殼（Hud.tsx）分開的判準跟 store 一樣：餘額、連線、返回鍵每一款玩法都要，
 * 所以留在殼；押注額、SPIN 鍵、起轉演法只有轉軸有意義，所以在這裡。百家樂的面板
 * 會是另一支檔案，兩邊互不知道對方存在。
 *
 * 匯出的是**三塊**而不是一整片：殼的底部面板有「讀數」「控制」「選項」三個位置
 * （見 style.css 的 .dock 格線），玩法各自填。讀數之所以獨立，是為了讓餘額與玩法
 * 自己的讀數能排在同一行——若玩法只給一整塊，那一行就得由玩法自己重畫一次餘額，
 * 兩款玩法就有兩份會走樣的複本。選項之所以獨立，是因為窄畫面要把它整組收進抽屜。
 *
 * 這一支完全不需要知道 Pixi 那側是誰、有沒有掛載——SPIN 鍵呼叫的是 store 裡的 handler，
 * 玩法卸載時 handler 變 null，按鈕自動失效。
 */

/** 主按鈕在三種身分下各顯示什麼。 */
const LABEL = {
    spin: 'arcade.spin',
    stop: 'arcade.stopSpin',
    stopping: 'arcade.stopping',
} as const;

/** 撐寬度用的候選字串——就是 LABEL 的全部值（見按鈕那段註解）。 */
const SIZER_KEYS = Object.values(LABEL);

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
    label,
    options,
    value,
    onPick,
    tKey,
}: {
    label: string;
    options: readonly T[];
    value: T;
    onPick: (v: T) => void;
    /** 選項的翻譯字首，跟選項值接起來就是字典的 key */
    tKey: string;
}) {
    const t = useT();

    return (
        <div className="style">
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
            label="arcade.stopOrder"
            options={STOP_ORDERS}
            value={value}
            onPick={onPick}
            tKey="arcade.order"
        />
    );
}

function TempoPicker() {
    const value = useSlotStore((s) => s.spinTempo);
    const onPick = useSlotStore((s) => s.setSpinTempo);
    return (
        <StylePicker
            label="arcade.tempo"
            options={SPIN_TEMPOS}
            value={value}
            onPick={onPick}
            tKey="arcade.speed"
        />
    );
}

/**
 * 自動轉動的次數。
 *
 * 跟其他選項不同，這一個**按下去就會開始送注**，所以它要自己擋連線與 handler；
 * 其他幾個純表演的選項按了只是改一個字串，掛載與否都無所謂。
 *
 * 沒有「無限」那一檔（見 store 的 AUTO_COUNTS）。剩餘次數直接寫在標題上而不是
 * 高亮某一顆：玩家關心的是「還剩幾把」，不是「當初選的是 25 還是 50」。
 */
function AutoPicker() {
    const t = useT();
    const remaining = useSlotStore((s) => s.autoRemaining);
    const setAuto = useSlotStore((s) => s.setAuto);
    const consumeAuto = useSlotStore((s) => s.consumeAuto);
    const spinning = useSlotStore((s) => s.spinning);
    const spinHandler = useSlotStore((s) => s.spinHandler);
    const connection = useArcadeStore((s) => s.connection);

    const start = (n: number): void => {
        if (!spinHandler || connection !== 'open') return;
        setAuto(n);
        // 正在轉的話就不用推第一把——這一把停穩後流程自己會接上（見 index.ts 的 playResult）
        if (!spinning) {
            consumeAuto();
            spinHandler();
        }
    };

    return (
        <div className="style">
            <span className="cap">
                {t('arcade.auto')}
                {remaining > 0 ? ` · ${remaining}` : ''}
            </span>
            <div className="style-row">
                <button
                    type="button"
                    className={`chip${remaining === 0 ? ' on' : ''}`}
                    onClick={() => setAuto(0)}
                >
                    {t('arcade.auto.off')}
                </button>
                {AUTO_COUNTS.map((n) => (
                    <button key={n} type="button" className="chip" onClick={() => start(n)}>
                        {n}
                    </button>
                ))}
            </div>
        </div>
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

/**
 * 選項插槽：兩組純表演的切換。
 *
 * 跟 SlotControls 分開，是因為它們在窄畫面**會被收進抽屜**（見 Hud.tsx）——
 * 押注與 SPIN 是每一把都要碰的，這兩組是玩過幾次之後才會想去調的。
 * 殼不知道抽屜裡是什麼，玩法也不知道自己被收起來了，兩邊只約定「有沒有東西可放」。
 */
export function SlotOptions() {
    return (
        <>
            <SpinStylePicker />
            <StopOrderPicker />
            <TempoPicker />
            <AutoPicker />
        </>
    );
}

/** 控制插槽：押注與 SPIN——每一把都要碰的那些。 */
export function SlotControls() {
    const t = useT();
    const connection = useArcadeStore((s) => s.connection);
    const spinning = useSlotStore((s) => s.spinning);
    const stopRequested = useSlotStore((s) => s.stopRequested);
    const autoRemaining = useSlotStore((s) => s.autoRemaining);
    const spinHandler = useSlotStore((s) => s.spinHandler);
    const stopHandler = useSlotStore((s) => s.stopHandler);

    /**
     * 同一顆按鈕的三種身分。
     *
     * `stopping` 那一檔是必要的：按下停之後畫面不一定馬上停（落點可能還在路上，
     * 見 Reel.slam），沒有這個狀態的話按鈕會維持在「停」，玩家以為沒按到而狂點。
     *
     * 自動轉的空檔（上一把停穩、下一把還沒起轉）也算 `stop`——那零點幾秒裡按鈕若跳回
     * 「轉」，按下去等於在自動轉之上再疊一把。
     */
    const mode: 'spin' | 'stop' | 'stopping' = stopRequested
        ? 'stopping'
        : spinning || autoRemaining > 0
          ? 'stop'
          : 'spin';

    const connected = connection === 'open';
    const canSpin = mode === 'spin' && !!spinHandler && connected;
    const canStop = mode === 'stop' && !!stopHandler && connected;
    const act = (): void => {
        if (canSpin) spinHandler?.();
        else if (canStop) stopHandler?.();
    };

    // 空白鍵也能轉——長時間玩的人不會一直去點按鈕。轉動中按下去就是停，跟按鈕同一套語意
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== 'Space' || e.repeat) return;
            const el = document.activeElement;
            // 焦點在按鈕上時讓瀏覽器原生行為處理，否則會觸發兩次
            if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) return;
            e.preventDefault();
            act();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [canSpin, canStop, spinHandler, stopHandler]);

    return (
        <>
            <BetPicker />

            {/*
                按鈕的寬度必須跟「現在顯示哪一串字」脫鉤。SPIN 換成 STOPPING… 多了六個字元，
                但這顆按鈕在 .dock 的 grid 裡佔 auto 欄，它一變寬，中間 1fr 的籌碼列就被擠到
                換行——面板長高，canvas 那側收到新的 dockInset 就把整個盤面縮一號。

                所以把**每一種**候選文字都疊進來當 sizer（全部 grid-area: 1/1，最寬的撐開容器），
                真正要顯示的那個疊在最上面。列舉而不是寫死 px：哪一串最長跟語言有關，
                中文的「停止自動」與英文的 STOPPING… 不會是同一個贏家。
                加新狀態時記得把它的字串也加進這個陣列，否則面板又會開始抖。
            */}
            <button type="button" className="spin" disabled={!canSpin && !canStop} onClick={act}>
                {SIZER_KEYS.map((k) => (
                    <span key={k} className="spin-sizer" aria-hidden="true">
                        {t(k)}
                    </span>
                ))}
                <span>{t(LABEL[mode])}</span>
            </button>
        </>
    );
}
