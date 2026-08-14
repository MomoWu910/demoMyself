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

function ChipPicker() {
    const t = useT();
    const chip = useBaccaratStore((s) => s.chip);
    const setChip = useBaccaratStore((s) => s.setChip);
    const phase = useBaccaratStore((s) => s.phase);

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
        </div>
    );
}

function TableActions() {
    const t = useT();
    const phase = useBaccaratStore((s) => s.phase);
    const totalBet = useBaccaratStore((s) => s.totalBet);
    const lastBets = useBaccaratStore((s) => s.lastBets);
    const clearBets = useBaccaratStore((s) => s.clearBets);
    const repeatBets = useBaccaratStore((s) => s.repeatBets);

    const betting = phase === 'betting';
    const hasLast = Object.keys(lastBets).length > 0;

    return (
        <div className="style spin-style">
            <span className="cap">{t('arcade.bac.actions')}</span>
            <div className="style-row">
                <button type="button" className="chip" disabled={!betting || totalBet === 0} onClick={clearBets}>
                    {t('arcade.bac.clear')}
                </button>
                <button type="button" className="chip" disabled={!betting || !hasLast} onClick={repeatBets}>
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
            <ChipPicker />

            <button type="button" className="spin" disabled={!canDeal} onClick={() => dealHandler?.()}>
                {label}
            </button>

            <TableActions />
        </>
    );
}
