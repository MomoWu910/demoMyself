import { createRoot } from 'react-dom/client';
import { ConfiguratorView } from './configuratorView';
import { initI18n } from '../../../i18n';
import { mountReveal } from '../../../shell/reveal';
import { wireGoBack } from '../../../shell/goBack';
import { selectionOf, useCfgStore } from './store';
import { encodeSelection, readSelection, syncUrl } from './share';
import { Panel } from './ui/Panel';
import { DEFAULT_PRODUCT, PRODUCTS } from './products';

/*
 * 配置器入口。分工同首頁與 Shader Lab：**React 管 canvas 外的面板、Babylon 管 canvas 內，
 * 兩邊靠 store 溝通**。這一頁值得用 React 的理由很具體——面板是資料驅動的
 * （部件清單由模型的 sub-mesh 決定）、而且狀態彼此連動（換部件要還原該部件的
 * finish/tint、按 preset 要連帶跳滑桿）。壓測與 pixiXthree 沒有這個問題：
 * 它們的 UI 根本不在 DOM 裡（lil-gui / Pixi 畫的 HUD），所以刻意維持零框架。
 */

mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開
wireGoBack(document.querySelector('.back-btn')); // 返回＝回上一頁，不新增歷史紀錄

window.addEventListener('DOMContentLoaded', async () => {
    // 套用翻譯 + 右上角語言切換鈕（右上角為空白區，側面板在右側中間）
    initI18n({ style: { top: '20px', right: '20px' } });

    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    // 網址指定了模型就直接載那顆——先載預設再換等於白下載一顆 glb（7.5MB）
    const wanted = new URLSearchParams(window.location.search).get('model');
    const product = PRODUCTS.some((p) => p.id === wanted) ? (wanted as string) : DEFAULT_PRODUCT;

    const view = new ConfiguratorView(canvas);
    const { variants, activeVariant, parts, finishes, tints } = await view.init(product);
    view.run();
    (globalThis as any).__CFG_VIEW__ = view; // debug handle（比照 __PIXI_APP__ 慣例）

    // 先把模型帶回來的選項灌進 store，再掛面板——Panel 在 ready 之前不畫任何東西，
    // 所以不會有「空面板閃一下」的中間態，也不需要舊版那組 display:none 開關。
    useCfgStore.getState().init({ view, parts, finishes, tints, variants, activeVariant, product });

    // 從分享連結還原：一定要在 init 之後（要先知道這顆模型有哪些部件才擋得掉
    // 網址裡不存在的部件），也要在掛面板之前，面板一畫出來就是還原後的樣子。
    const fromUrl = readSelection(window.location.search, parts.map((p) => p.id));
    if (Object.keys(fromUrl).length > 0) useCfgStore.getState().applySelection(fromUrl);

    const root = document.getElementById('panel-root');
    if (root) createRoot(root).render(<Panel />);

    document.getElementById('loading')?.classList.add('hidden');

    /*
     * 設定一變就同步回網址列，使用者直接複製網址也拿得到同一組設定。
     * 用 replaceState + 一拍 rAF 節流：滑桿一路拖過去會連發上百次 set，
     * 每次都寫網址是白費工（history API 本身在部分瀏覽器有頻率限制）。
     */
    let queued = false;
    useCfgStore.subscribe((s) => {
        if (queued || !s.defaults) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            const cur = useCfgStore.getState();
            if (!cur.defaults) return;
            syncUrl(encodeSelection(selectionOf(cur), cur.defaults));
        });
    });
});
