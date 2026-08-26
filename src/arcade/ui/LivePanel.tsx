import { CHIP_VALUES, chipLabel } from '../common/chips/atlas';
import { BET_SPOTS } from '../games/baccarat/rules';
import { liveState, useLiveStore } from '../games/baccaratLive/store';
import type { SourceKind } from '../common/video/sources';
import { useIsCompact } from './useIsCompact';
import { useT } from '../../i18n/useT';

/**
 * 視訊桌台的面板。
 *
 * 這裡放的東西跟數位百家樂幾乎一樣（籌碼面額、重複下注、本局押注、上一局輸贏），
 * 因為**規則沒變，變的只是牌從哪裡來**。真正多出來的是別的玩法沒有的一組：
 * **串流讀數**。延遲、緩衝、倍速、卡頓與跳轉全部攤在檯面上——一般播放器把這些藏起來
 * 當實作細節，但在視訊博弈裡延遲是產品規格（它決定下注截止要提前幾秒），
 * 而追趕策略有沒有在動也只有看倍速才知道。
 *
 * 線路切換擺在這裡是整頁最值得按的一顆按鈕：同一個儀表下，自己寫的那條是零點幾秒，
 * 接真實 CDN 的 HLS 是好幾秒。**那個差距就是視訊博弈不用 HLS 的全部理由**——
 * 而接上下注之後它不再只是一個數字：切過去就會看到倒數條上那截紅色吃掉整個下注期。
 */

const SOURCES: Array<{ kind: SourceKind; key: string }> = [
    { kind: 'dealer', key: 'arcade.live.sourceDealer' },
    { kind: 'public', key: 'arcade.live.sourcePublic' },
];

/**
 * 籌碼面額與重複下注。
 *
 * 跟數位桌台一樣沒有「清除」——**押出去就不能撤**。留一顆按不動的清除鈕比拿掉更糟：
 * 玩家會一直試，然後以為壞了。
 */
function BetControls() {
    const t = useT();
    const chip = useLiveStore((s) => s.chip);
    const phase = useLiveStore((s) => s.phase);
    const lastBets = useLiveStore((s) => s.lastBets);
    const betHandler = useLiveStore((s) => s.betHandler);

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
                        onClick={() => liveState.set({ chip: v })}
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

/**
 * 串流讀數：延遲、緩衝、倍速、卡頓。
 *
 * 一般播放器把這些藏起來當實作細節，但在視訊博弈裡**延遲是產品規格**（它決定下注
 * 截止要提前幾秒），而追趕策略有沒有在動也只有看倍速才知道。所以它們攤在檯面上。
 *
 * 窄畫面只留延遲那一格，其餘三格跟著說明進抽屜——**面板每多一列，畫布那側就少一列**，
 * 而手機直式要在同一個畫面裡排下路圖、視訊、座位與兩列注區。留延遲是因為它是主角，
 * 也是唯一會影響玩家決定的那一個。
 */
function StreamStats({ full }: { full: boolean }) {
    const t = useT();
    const stats = useLiveStore((s) => s.stats);

    // 四秒是視訊桌台開始不能接受的線——下注只剩幾秒時，畫面慢四秒等於閉著眼睛押
    const hot = stats.latency > 4;

    return (
        <>
            <div className="stat">
                <span className="cap">{t('arcade.live.latency')}</span>
                <strong className="val" style={{ color: hot ? 'var(--banker, #c2454f)' : undefined }}>
                    {stats.latency.toFixed(2)}s
                </strong>
            </div>
            {full && (
                <>
                    <div className="stat">
                        <span className="cap">{t('arcade.live.buffered')}</span>
                        <strong className="val">{stats.buffered.toFixed(1)}s</strong>
                    </div>
                    <div className="stat">
                        <span className="cap">{t('arcade.live.rate')}</span>
                        <strong className="val">{stats.playbackRate.toFixed(2)}×</strong>
                    </div>
                    <div className="stat">
                        <span className="cap">{t('arcade.live.stalls')}</span>
                        <strong className="val">
                            {stats.stalls} / {stats.jumps}
                        </strong>
                    </div>
                </>
            )}
        </>
    );
}

/**
 * 讀數插槽：串流那組，加上跟數位桌台一樣的本局押注與上一局輸贏。
 *
 * 後兩格用的是面板既有的 `.stat` / `.cap` / `.val`，不是自己一套 class——
 * **同一種桌子的讀數不該長得不一樣**，而且沒有樣式的裸 class 在窄畫面會用預設字級
 * 排成一長串，把整塊面板撐到佔掉六成畫面。
 */
export function LiveReadouts() {
    const t = useT();
    const compact = useIsCompact();
    const status = useLiveStore((s) => s.status);
    const error = useLiveStore((s) => s.error);
    const myTotal = useLiveStore((s) => s.myTotal);
    const lastNet = useLiveStore((s) => s.lastNet);
    const played = useLiveStore((s) => s.played);

    return (
        <>
            <StreamStats full={!compact} />
            <div className="stat">
                <span className="cap">{t('arcade.bac.totalBet')}</span>
                <strong className="val">{myTotal.toLocaleString()}</strong>
            </div>
            <div className="stat">
                <span className="cap">{t('arcade.bac.net')}</span>
                {/* 還沒押過任何一局時顯示破折號，而不是 0——0 會被誤讀成「押了但平手」 */}
                <strong className={`val${played && lastNet > 0 ? ' hit' : ''}`}>
                    {!played ? '—' : lastNet > 0 ? `+${lastNet.toLocaleString()}` : lastNet.toLocaleString()}
                </strong>
            </div>
            {status !== 'playing' && (
                <div className="stat">
                    <span className="cap">·</span>
                    <strong className="val">
                        {error
                            ? t('arcade.live.statusFailed')
                            : status === 'stalled'
                              ? t('arcade.live.statusStalled')
                              : t('arcade.live.statusLoading')}
                    </strong>
                </div>
            )}
        </>
    );
}

export function LiveControls() {
    const t = useT();
    const source = useLiveStore((s) => s.source);
    const phase = useLiveStore((s) => s.phase);
    const secondsLeft = useLiveStore((s) => s.secondsLeft);
    const latency = useLiveStore((s) => s.stats.latency);

    const betting = phase === 'betting';

    return (
        <>
            <BetControls />

            {/*
                線路切換自己一行（面板 grid 的 `controls` 列）。它是這一頁最值得按的
                一顆按鈕，不能跟著沒有具名區域的東西被自動排到說明抽屜底下去
            */}
            <div className="control-group">
                <span className="group-label">{t('arcade.live.source')}</span>
                <div className="segmented" role="group" aria-label={t('arcade.live.source')}>
                    {SOURCES.map(({ kind, key }) => (
                        <button
                            key={kind}
                            type="button"
                            className={kind === source ? 'seg on' : 'seg'}
                            // 只寫 store，不碰播放層。換來源要卸掉舊的那一條，
                            // 那是資源生命週期的事，留在模組裡（見 games/baccaratLive/index.ts）
                            onClick={() => liveState.set({ source: kind })}
                            aria-pressed={kind === source}
                        >
                            {t(key)}
                        </button>
                    ))}
                </div>
            </div>

            {/*
                倒數在這裡再放一次不是重複——**視線在面板上的時候不該為了看倒數而抬頭**。
                而視訊桌台還多一層：畫面上那個倒數是延遲之後的，這一份才是 server 的。
                延遲大的時候把差額寫在旁邊，玩家才知道自己少了幾秒
            */}
            <div className={`table-status${betting && secondsLeft <= 5 ? ' urgent' : ''}`} aria-live="polite">
                <span className="cap">{t(`arcade.live.phase.${phase}`)}</span>
                {betting && <strong className="clock">{secondsLeft}</strong>}
                {betting && latency >= 1.2 && (
                    <span className="cap">{t('arcade.live.lagAhead').replace('{s}', latency.toFixed(1))}</span>
                )}
            </div>
        </>
    );
}

export function LiveOptions() {
    const t = useT();
    const compact = useIsCompact();
    // 說明文字本來就該歸 React：要翻譯、要能被選取、不必每幀重畫。
    //
    // 併成一段是版面逼出來的：**這塊面板每多一行，畫布那側就少一行**，而視訊桌台
    // 要在同一個畫面裡塞下視訊、路圖與兩列注區，是整站最吃高度的一頁
    return (
        <>
            {/* 窄畫面時串流讀數的另外三格搬進來（見 StreamStats）。抽屜本來就是
                「想看才看」的地方，而它們在手機上正好是那種東西 */}
            {compact && (
                <div className="readouts">
                    <StreamStats full />
                </div>
            )}
            <p className="hint">{t('arcade.live.caption')}</p>
        </>
    );
}
