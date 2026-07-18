import { useHomeStore } from './store';
import { nodeById } from './projects';

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
    useHomeStore.getState().setEntering(id);
    window.setTimeout(() => {
        window.location.href = node.href;
    }, ENTER_MS);
}
