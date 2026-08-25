import { CHIP_VALUES, chipLabel } from '../common/chips/atlas';
import { BET_SPOTS } from '../games/baccarat/rules';
import { useBaccaratStore } from '../games/baccarat/store';
import { useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';

/**
 * 百家樂的操作面板。
 *
 * 分工的判準跟整頁一致（見 Hud.tsx）：**下注區在 canvas 裡**，因為它有籌碼、
 * 中獎會發亮，是遊戲世界的一部分；**選籌碼面額、重複下注在 DOM**，
 * 因為它們是按鈕——要能被鍵盤按到、要能被翻譯、也不需要每幀重畫。
 *
 * ---
 *
 * 改成多人桌之後，這塊面板**少了一顆最重要的按鈕**：沒有「發牌」了。
 *
 * 這件事比它看起來的大。單機版的面板是一個「送出表單」的介面——選好注、按下去、
 * 看結果。多人版沒有送出這個動作，桌子自己會開，所以面板的角色從「操作」變成
 * 一半操作、一半**儀表板**：那顆按鈕原本的位置改成階段與倒數，因為玩家在多人桌上
 * 最需要知道的不是「我能按什麼」，而是「現在還來不來得及」。
 */

/**
 * 籌碼面額與重複下注。
 *
 * 「清除」在多人桌上不存在了——**押出去就不能撤**，跟真實桌台一樣（見協定裡的 `bet`）。
 * 留一顆按不動的清除鈕比拿掉更糟：玩家會一直試，然後以為壞了。
 */
function BetControls() {
    const t = useT();
    const chip = useBaccaratStore((s) => s.chip);
    const setChip = useBaccaratStore((s) => s.setChip);
    const phase = useBaccaratStore((s) => s.phase);
    const lastBets = useBaccaratStore((s) => s.lastBets);
    const betHandler = useBaccaratStore((s) => s.betHandler);

    const betting = phase === 'betting';
    const hasLast = Object.keys(lastBets).length > 0;

    // 重複下注＝把上一局的注**一注一注重送**，不是送一包「重複」指令。
    // server 那邊就只認得單筆下注，少一種封包就少一條要維護的路徑
    const repeat = (): void => {
        if (!betHandler) return;
        for (const spot of BET_SPOTS) {
            const amount = lastBets[spot] ?? 0;
            if (amount > 0) betHandler(spot, amount);
        }
    };

    return (
        <div className="bet">
            <span className="cap">{t('arcade.bac.chip')}</span>
            <div className="bet-row">
                {CHIP_VALUES.map((v) => (
                    <button
                        key={v}
                        type="button"
                        className={`chip${v === chip ? ' on' : ''}`}
                        // 只有下注階段能換籌碼。開牌中換沒有意義，結算中換會讓人以為改得到這一局
                        disabled={!betting}
                        onClick={() => setChip(v)}
                    >
                        {chipLabel(v)}
                    </button>
                ))}
            </div>
            <div className="bet-row" role="group" aria-label={t('arcade.bac.actions')}>
                <button type="button" className="chip ghost" disabled={!betting || !hasLast} onClick={repeat}>
                    {t('arcade.bac.repeat')}
                </button>
            </div>
        </div>
    );
}

/** 讀數插槽：本局押注、上一局輸贏、牌靴剩幾張。 */
export function BaccaratReadouts() {
    const t = useT();
    const myTotal = useBaccaratStore((s) => s.myTotal);
    const lastNet = useBaccaratStore((s) => s.lastNet);
    const played = useBaccaratStore((s) => s.played);
    const shoe = useBaccaratStore((s) => s.shoe);

    return (
        <>
            <div className="stat">
                <span className="cap">{t('arcade.bac.totalBet')}</span>
                <strong className="val">{myTotal.toLocaleString()}</strong>
            </div>
            <div className="stat">
                <span className="cap">{t('arcade.bac.net')}</span>
                <strong className={`val${lastNet > 0 ? ' hit' : ''}`}>
                    {/* 還沒押過任何一局時顯示破折號，而不是 0——0 會被誤讀成「這局平手」 */}
                    {!played ? '—' : lastNet > 0 ? `+${lastNet.toLocaleString()}` : lastNet.toLocaleString()}
                </strong>
            </div>
            <div className="stat">
                <span className="cap">{t('arcade.bac.shoe')}</span>
                <strong className="val">{shoe ? shoe.remaining : '—'}</strong>
            </div>
        </>
    );
}

/**
 * 選項插槽：百家樂沒有純表演的切換可調，所以是空的。
 *
 * 回 null 而不是不匯出這個函式，是為了讓殼那側的 switch 保持窮盡——加第三款玩法時
 * 忘了處理會**編譯就失敗**，而不是靜默地少一塊面板（見 Hud.tsx 的 GameOptions）。
 */
export function BaccaratOptions(): null {
    return null;
}

/**
 * 控制插槽：籌碼面額、重複下注，以及**原本是發牌按鈕的那塊地方**。
 *
 * 桌子的節奏不歸玩家管，所以那個位置改成一塊儀表：現在是哪一段、還剩幾秒。
 * canvas 裡的階段膠囊已經顯示過同一件事，這裡再放一次不是重複——**視線在面板上的時候
 * 不該為了看倒數而抬頭**，那三秒可能就是能不能押到這一手的差別。
 */
export function BaccaratControls() {
    const t = useT();
    const connection = useArcadeStore((s) => s.connection);
    const phase = useBaccaratStore((s) => s.phase);
    const secondsLeft = useBaccaratStore((s) => s.secondsLeft);

    const betting = phase === 'betting';
    const label = connection !== 'open' ? t('arcade.bac.phase.connecting') : t(`arcade.bac.phase.${phase}`);

    return (
        <>
            <BetControls />

            {/* 倒數只在下注階段有意義。其他階段顯示數字會讓人以為那時候也能做點什麼 */}
            <div className={`table-status${betting && secondsLeft <= 5 ? ' urgent' : ''}`} aria-live="polite">
                <span className="cap">{label}</span>
                {betting && <strong className="clock">{secondsLeft}</strong>}
            </div>
        </>
    );
}
