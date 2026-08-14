import { CHIP_VALUES, chipLabel } from '../common/chips/atlas';
import { useBaccaratStore } from '../games/baccarat/store';
import { useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';

/**
 * 百家樂的操作面板。
 *
 * 分工的判準跟整頁一致（見 Hud.tsx）：**下注區在 canvas 裡**，因為它有籌碼疊、
 * 中獎會發亮，是遊戲世界的一部分；**選籌碼面額、清除、重複、發牌在 DOM**，
 * 因為它們是按鈕——要能被鍵盤按到、要能被翻譯、也不需要每幀重畫。
 *
 * 跟 SlotPanel 一樣拆成讀數與控制兩塊，填進殼留好的兩個插槽。
 */

/**
 * 籌碼面額與清除／重複。
 *
 * 三者合成**一個區塊**而不是各佔面板一列：它們是同一件事的三個動作——決定這一局要押多少。
 * 分成兩列時，窄畫面下「清除／重複」會被推到跟 SPIN 同高的位置，看起來像另一組主操作，
 * 但它們其實是下注的附屬動作。合起來也讓面板在豎屏少掉一整列的高度。
 */
function BetControls() {
    const t = useT();
    const chip = useBaccaratStore((s) => s.chip);
    const setChip = useBaccaratStore((s) => s.setChip);
    const phase = useBaccaratStore((s) => s.phase);
    const totalBet = useBaccaratStore((s) => s.totalBet);
    const lastBets = useBaccaratStore((s) => s.lastBets);
    const clearBets = useBaccaratStore((s) => s.clearBets);
    const repeatBets = useBaccaratStore((s) => s.repeatBets);

    const betting = phase === 'betting';
    const hasLast = Object.keys(lastBets).length > 0;

    return (
        <div className="bet">
            <span className="cap">{t('arcade.bac.chip')}</span>
            <div className="bet-row">
                {CHIP_VALUES.map((v) => (
                    <button
                        key={v}
                        type="button"
                        className={`chip${v === chip ? ' on' : ''}`}
                        // 只有下注階段能換籌碼。發牌中換沒有意義，結算中換會讓人以為改得到這一局
                        disabled={phase !== 'betting'}
                        onClick={() => setChip(v)}
                    >
                        {chipLabel(v)}
                    </button>
                ))}
            </div>
            {/* 沒有可見標籤——按鈕文字已經自明，省下的那行給牌區。標籤改掛在群組上給讀螢幕的人 */}
            <div className="bet-row" role="group" aria-label={t('arcade.bac.actions')}>
                <button type="button" className="chip ghost" disabled={!betting || totalBet === 0} onClick={clearBets}>
                    {t('arcade.bac.clear')}
                </button>
                <button type="button" className="chip ghost" disabled={!betting || !hasLast} onClick={repeatBets}>
                    {t('arcade.bac.repeat')}
                </button>
            </div>
        </div>
    );
}

/** 讀數插槽：本局押注、上一局輸贏、牌靴剩幾張。 */
export function BaccaratReadouts() {
    const t = useT();
    const totalBet = useBaccaratStore((s) => s.totalBet);
    const lastNet = useBaccaratStore((s) => s.lastNet);
    const lastRound = useBaccaratStore((s) => s.lastRound);
    const shoe = useBaccaratStore((s) => s.shoe);

    return (
        <>
            <div className="stat">
                <span className="cap">{t('arcade.bac.totalBet')}</span>
                <strong className="val">{totalBet.toLocaleString()}</strong>
            </div>
            <div className="stat">
                <span className="cap">{t('arcade.bac.net')}</span>
                <strong className={`val${lastNet > 0 ? ' hit' : ''}`}>
                    {/* 還沒打過任何一局時顯示破折號，而不是 0——0 會被誤讀成「這局平手」 */}
                    {lastRound === null ? '—' : lastNet > 0 ? `+${lastNet.toLocaleString()}` : lastNet.toLocaleString()}
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

/** 控制插槽：籌碼面額、清除／重複、發牌。 */
export function BaccaratControls() {
    const t = useT();
    const connection = useArcadeStore((s) => s.connection);
    const phase = useBaccaratStore((s) => s.phase);
    const totalBet = useBaccaratStore((s) => s.totalBet);
    const dealHandler = useBaccaratStore((s) => s.dealHandler);

    const canDeal = !!dealHandler && phase === 'betting' && totalBet > 0 && connection === 'open';
    const label = phase === 'dealing' ? t('arcade.bac.dealing') : phase === 'result' ? t('arcade.bac.settling') : t('arcade.bac.deal');

    return (
        <>
            <BetControls />

            <button type="button" className="spin" disabled={!canDeal} onClick={() => dealHandler?.()}>
                {label}
            </button>
        </>
    );
}
