import { useEffect, useRef, useState } from 'react';
import { isTableScene, useArcadeStore } from '../store';
import { useT } from '../../i18n/useT';
import { wireGoBack } from '../../shell/goBack';

/**
 * 頂列：不管在大廳還是在牌桌上都在的那一條。
 *
 * 真實博弈大廳的頂列一定有錢包，而且**進了遊戲也不會消失**——玩家隨時要知道自己還有多少。
 * 這一頁的餘額本來只長在底部操作面板裡，於是大廳完全看不到自己有錢，那是版面上的漏洞
 * 而不是取捨。搬上來之後 dock 那格就拿掉了，同一個數字沒有理由出現兩次。
 *
 * ---
 *
 * **這裡一度還有一顆連線徽章，已經拿掉了。**
 *
 * 它綁的是假 socket 的狀態機（net/fakeSocket.ts），寫起來很像那麼一回事，但實際上
 * 玩家只看得到兩件事：進桌時閃 420ms 的「連線中」，然後**永遠是綠色的「已連線」**。
 * 紅色那一態根本渲染不出來——`closed` 只在玩法卸載時發生，而徽章只在遊戲內顯示，
 * 那一瞬間它自己已經先下架了。而 fakeSocket 沒有做重連，也就沒有任何路徑會讓它
 * 從 `open` 掉回去。
 *
 * **一盞恆亮的燈不傳遞資訊**，而它佔的正好是右上角那個位置。`connection` 狀態本身留著
 * （下注前的 `!== 'open'` 防護還在用），只是不再畫成一顆徽章。
 */

/**
 * 錢包。
 *
 * 數字變動時整塊會亮一下——**餘額變了卻沒有任何動靜是這類介面最容易漏掉的一件事**，
 * 玩家轉完一把要自己去比對數字才知道贏了沒。用 key 換值觸發 CSS 動畫比自己寫計時器
 * 可靠：連續兩把都贏的時候，計時器版會因為第二次的 setTimeout 還沒到而不重播。
 */
function Wallet() {
    const t = useT();
    const balance = useArcadeStore((s) => s.balance);
    const prev = useRef(balance);
    const [dir, setDir] = useState<'up' | 'down' | null>(null);
    const [pulse, setPulse] = useState(0);

    useEffect(() => {
        if (balance === prev.current) return;
        setDir(balance > prev.current ? 'up' : 'down');
        setPulse((n) => n + 1);
        prev.current = balance;
    }, [balance]);

    return (
        <span className="wallet" title={t('arcade.balance')}>
            <span className="coin" aria-hidden="true" />
            <strong key={pulse} className={`amount${dir ? ` ${dir}` : ''}`}>
                {balance.toLocaleString()}
            </strong>
        </span>
    );
}

/** 頭像與名字。純門面，身分是進站時隨機給的（見 store 的 loadPlayer）。 */
function PlayerChip() {
    const player = useArcadeStore((s) => s.player);

    return (
        <div className="player">
            <span className="avatar" style={{ background: player.tint }} aria-hidden="true">
                {player.name.slice(-2)}
            </span>
            <span className="who">
                <span className="pname">{player.name}</span>
                <Wallet />
            </span>
        </div>
    );
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

/**
 * 資源核對：**這一頁在架構上想證明的事，就是這一塊**。
 *
 * 它一度是頂列右上角一串沒有標題的數字（`登記 2 · 未回收 0 · tex 116 ±0`），
 * 而且要切過一次玩法才會出現。**那等於沒做**——看到的人只知道有東西在跳，
 * 不知道那是什麼、也不知道該覺得好還是不好。一個要靠作者在旁邊解說的展示品，
 * 在作品集裡沒有價值。
 *
 * 現在改成三層：
 *   1. **一直都在**。還沒切過場景時顯示「待機」，而不是整塊消失
 *   2. 收合時只講**結論**（零洩漏／有洩漏），不丟數字
 *   3. 點開才是數字與那段「這是在量什麼、為什麼重要」
 */
function ResourceMeter() {
    const t = useT();
    const report = useArcadeStore((s) => s.lastDispose);
    const scene = useArcadeStore((s) => s.lastDisposedScene);
    const previous = useArcadeStore((s) => s.previousTexture);
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);

    // 點到別的地方就收起來。展開的說明會蓋住右上角的語言鈕，沒有這條的話
    // 使用者得先找回那顆小徽章再點一次才關得掉
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            if (!wrap.current?.contains(e.target as Node)) setOpen(false);
        };
        // capture 階段收，才不會被 canvas 那側吃掉事件
        document.addEventListener('pointerdown', onDown, true);
        return () => document.removeEventListener('pointerdown', onDown, true);
    }, [open]);

    // 跟**同一個場景上一次**的數字比（見 store 的 lastTextureByScene）。
    // 第一次卸載某個場景時沒得比，那時只顯示絕對值。
    const drift = report && previous !== null ? report.textureSources - previous : 0;
    const idle = !report || !scene;

    /*
     * 三態，不是兩態。
     *
     * 兩態版把「texture 比上次多」一律算成洩漏，於是**第一次交叉切換玩法就會亮紅燈**——
     * 而那個增加是共用字體 atlas 的一次性成長（老虎機用到的字百家樂沒有），
     * 是刻意全域的東西，還不回來才對。紅字寫著 leaking 卻沒有東西在漏，
     * 比不顯示還糟：看到的人只會認為這個指標不可信。
     *
     * 真正的洩漏長什麼樣：**`leaked > 0`，或者同一個場景每進出一次就漲一階、永遠停不下來。**
     * 前者這裡直接判得出來，後者要看趨勢——所以 drift 為正時給的是中性的「快取 +N」，
     * 把判斷留給看的人，而不是替他喊狼來了。
     */
    const status: 'idle' | 'clean' | 'cached' | 'leak' = idle
        ? 'idle'
        : report.leaked > 0
          ? 'leak'
          : drift > 0
            ? 'cached'
            : 'clean';

    const badge =
        status === 'idle'
            ? t('arcade.meter.idle')
            : status === 'leak'
              ? t('arcade.meter.dirty')
              : status === 'cached'
                ? `+${drift}`
                : t('arcade.meter.clean');

    return (
        <div className="meter-wrap" ref={wrap}>
            <button
                type="button"
                className={`meter ${status}`}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <span className="meter-dot" aria-hidden="true" />
                {t('arcade.meter.title')}
                <strong>{badge}</strong>
            </button>

            {open && (
                <div className="meter-pop">
                    <p>{t('arcade.meter.hint')}</p>
                    {status === 'cached' && <p className="meter-note">{t('arcade.meter.cachedHint')}</p>}
                    {idle ? (
                        <p className="meter-idle">{t('arcade.meter.idleHint')}</p>
                    ) : (
                        <dl>
                            <dt>{t('arcade.meter.label')}</dt>
                            <dd>{report.tracked}</dd>
                            <dt>{t('arcade.meter.leaked')}</dt>
                            <dd>{report.leaked}</dd>
                            <dt>{t('arcade.meter.texture')}</dt>
                            <dd>
                                {report.textureSources}
                                {previous === null ? '' : drift === 0 ? ' ±0' : ` ${drift > 0 ? '+' : ''}${drift}`}
                            </dd>
                        </dl>
                    )}
                </div>
            )}
        </div>
    );
}

export function TopBar() {
    const scene = useArcadeStore((s) => s.scene);

    return (
        <header className="top">
            <div className="top-left">
                <BackLink />
                <PlayerChip />
            </div>
            {/*
                牌桌上右上角**還有一顆畫在畫布裡的齒輪**（見 common/table/tableLayout.ts
                的 MORE_TOP）。它跟這一列是同一條水平線上的鄰居，但分屬 canvas 與 DOM
                兩層，誰也擋不了誰——所以讓位只能用 padding 手動談好
            */}
            <div className={`top-right${isTableScene(scene) ? ' top-right--gear' : ''}`}>
                <ResourceMeter />
            </div>
        </header>
    );
}
