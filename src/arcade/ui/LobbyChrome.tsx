import { useArcadeStore } from '../store';
import { LOBBY_TABS, type LobbyTab } from '../lobby/catalog';
import { useT } from '../../i18n/useT';

/**
 * 大廳的 DOM 外圈：分類 tab 與頁腳。
 *
 * 為什麼這兩條不畫在 canvas 裡：它們是**選單**，要能被 Tab 鍵走到、能被讀螢幕軟體念出來、
 * 換語言時要重排文字寬度。canvas 給不了這些，而它們也不需要每幀重畫。這條分界跟整頁一致
 * （見 lobby/index.ts）。
 *
 * 它們佔的高度是常數（core/layout.ts 的 LOBBY_TAB_H / LOBBY_FOOTER_H），canvas 那側
 * 直接照著讓位——跟操作面板不同，這兩條的高度不會因為語言或內容而改變，
 * 所以不需要 ResizeObserver 那一套（見 Hud.tsx 的 useDockMeasure）。
 */

function Tabs() {
    const t = useT();
    const tab = useArcadeStore((s) => s.lobbyTab);
    const setTab = useArcadeStore((s) => s.setLobbyTab);

    return (
        <nav className="lobby-tabs" aria-label={t('arcade.lobby.categories')}>
            {LOBBY_TABS.map((id: LobbyTab) => (
                <button
                    key={id}
                    type="button"
                    className={`tab${id === tab ? ' on' : ''}`}
                    aria-pressed={id === tab}
                    onClick={() => setTab(id)}
                >
                    {t(`arcade.lobby.tab.${id}`)}
                </button>
            ))}
        </nav>
    );
}

/**
 * 頁腳。
 *
 * 三顆功能鍵照真實大廳的配置（客服／公告／活動），內容還沒做，所以點下去回一句提示
 * 而不是靜靜地沒反應。右邊那行小字是**必要的**：這一頁的活動 banner 做得像真的促銷，
 * 而這是一個作品集網站——不寫清楚會被誤讀成真的在營運什麼。
 */
function Footer() {
    const t = useT();
    const setNotice = useArcadeStore((s) => s.setNotice);

    const keys = ['service', 'news', 'campaign'] as const;

    return (
        <footer className="lobby-foot">
            <div className="foot-btns">
                {keys.map((k) => (
                    <button key={k} type="button" className="foot-btn" onClick={() => setNotice('arcade.notice.comingSoon')}>
                        <span className={`foot-icon ${k}`} aria-hidden="true" />
                        {t(`arcade.foot.${k}`)}
                    </button>
                ))}
            </div>
            <p className="foot-note">{t('arcade.foot.demo')}</p>
        </footer>
    );
}

export function LobbyChrome() {
    return (
        <>
            <Tabs />
            <Footer />
        </>
    );
}
