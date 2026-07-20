import { useHomeStore } from './store';
import { nodeById, TONE_HEX } from './projects';
import { REVEAL_KEY } from '../shell/reveal';

/** 轉場時長要跟 scene.ts 的 zoom 動畫、CSS 的 overlay 淡出對齊。 */
export const ENTER_MS = 620;

/**
 * 進入一個專案。canvas 的點擊與鍵盤 a11y 連結都走這裡，只有這一處會導頁。
 *
 * 會動的人：設 enteringId → 舞台播放「往節點顏色 zoom」、overlay 淡出 → 到點導頁。
 * prefers-reduced-motion：不放動畫，直接導頁。
 */
export function enterProject(id: string): void {
    const node = nodeById(id);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        window.location.href = node.href;
        return;
    }
    if (useHomeStore.getState().enteringId) return; // 已在轉場中，忽略重複觸發
    // 把 zoom 進去的顏色交棒給落地頁，讓它從同一個顏色 reveal，動線接得起來
    try {
        sessionStorage.setItem(REVEAL_KEY, TONE_HEX[node.tone]);
    } catch {
        /* 無痕模式等情況下 sessionStorage 可能不可用，略過即可 */
    }
    useHomeStore.getState().setEntering(id);
    window.setTimeout(() => {
        handOffToDom(TONE_HEX[node.tone], () => {
            window.location.href = node.href;
        });
    }, ENTER_MS - HANDOFF_MS);
}

/** DOM 交棒遮罩畫出來所需的餘裕，從 ENTER_MS 裡扣掉，總時長維持不變。 */
const HANDOFF_MS = 80;

const EXIT_COVER_CLASS = 'shell-exit-cover';

// 交棒遮罩是 DOM，會跟著首頁一起被存進 bfcache；按返回回來時它原封不動還在，
// 整個畫面就卡在那片純色上（scene.ts 的 pageshow 只清 Pixi 的轉場狀態，管不到這個 div）。
// 模組載入時註冊一次，回到首頁一律清掉；正常首次載入時沒有遮罩，這裡是 no-op。
window.addEventListener('pageshow', () => {
    document.querySelectorAll(`.${EXIT_COVER_CLASS}`).forEach((el) => el.remove());
});

/**
 * zoom 是畫在 Pixi 的 WebGL canvas 上，那個顏色只存在於 canvas 裡。導頁時瀏覽器會拆掉
 * WebGL context，canvas 立刻變空、露出底下的頁面底色，而新頁還沒畫出來——就是那一下黑屏。
 *
 * 所以在導頁前疊一層同色的 DOM div：此刻畫面本來就已經是純節點色，視覺上看不出差別，
 * 但 DOM 圖層不隨 WebGL context 消失，canvas 被拆掉時仍撐著畫面。
 * 要等它真的上畫面（連等兩幀）再導頁，否則遮罩還沒繪製出來就換頁，等於沒蓋。
 */
function handOffToDom(color: string, go: () => void): void {
    const cover = document.createElement('div');
    cover.className = EXIT_COVER_CLASS;
    cover.setAttribute('aria-hidden', 'true');
    Object.assign(cover.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '99999',
        pointerEvents: 'none',
        background: color,
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(cover);

    let done = false;
    const once = () => {
        if (done) return;
        done = true;
        go();
    };
    requestAnimationFrame(() => requestAnimationFrame(once));
    window.setTimeout(once, HANDOFF_MS * 2); // 分頁在背景時 rAF 不跑，保險
}
