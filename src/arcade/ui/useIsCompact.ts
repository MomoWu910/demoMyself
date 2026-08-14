import { useSyncExternalStore } from 'react';

/**
 * 「畫面窄或矮」的單一判準。
 *
 * 為什麼要有這個東西：底部操作面板在窄畫面必須換一種擺法（次要選項收進抽屜），
 * 而**那個決定同時要在 CSS 與 JS 兩邊生效**——CSS 排格線，React 決定要不要包抽屜。
 * 門檻各寫一份的話，兩邊遲早會錯開一格，出現「CSS 已經換成直排、React 還沒收抽屜」
 * 這種只在某個寬度區間出現的破版。所以門檻寫在這裡一次，style.css 的 media query
 * 照抄同一組數字，改的時候兩邊一起改。
 *
 * 兩個條件是或的關係，因為它們是**同一件事的兩種來源**：手機直式是寬度不夠，
 * 手機橫放是高度不夠，兩種都塞不下攤開的面板。
 */
export const COMPACT_QUERY = '(max-width: 620px), (max-height: 560px)';

/**
 * 手機橫放：矮，而且寬大於高。
 *
 * 這個尺寸下操作面板整個移到畫面**右側**直排，底部讓給路單（見 style.css 的橫版區塊）。
 * 理由是垂直空間在這裡是唯一的稀缺資源：390 高扣掉頂列與一條橫躺的面板只剩 173px，
 * 要塞牌、五個注區、五張路單根本不夠；移到右側之後那 120px 就整段還給了玩法。
 *
 * 用 `min-aspect-ratio` 而不是 `orientation: landscape`，是因為後者在桌機把視窗
 * 拉扁時也會成立，而桌機的高度一點都不缺——真正該問的是「寬高比」加「絕對高度」。
 */
export const LANDSCAPE_DOCK_QUERY = '(max-height: 560px) and (min-aspect-ratio: 1/1)';

function watch(query: string): (cb: () => void) => () => void {
    return (cb) => {
        const mq = window.matchMedia(query);
        mq.addEventListener('change', cb);
        return () => mq.removeEventListener('change', cb);
    };
}

const subscribeCompact = watch(COMPACT_QUERY);
const subscribeLandscape = watch(LANDSCAPE_DOCK_QUERY);

export function useIsCompact(): boolean {
    return useSyncExternalStore(
        subscribeCompact,
        () => window.matchMedia(COMPACT_QUERY).matches,
        // SSR 沒有 window。這個站不做 SSR，但 useSyncExternalStore 要求給，
        // 給 false（攤開版）是比較安全的預設——少了抽屜仍然每個控制項都在
        () => false
    );
}

/** 面板該貼右側（手機橫放）還是貼底部（其他所有尺寸）。 */
export function useDockSide(): 'bottom' | 'right' {
    const landscape = useSyncExternalStore(
        subscribeLandscape,
        () => window.matchMedia(LANDSCAPE_DOCK_QUERY).matches,
        () => false
    );
    return landscape ? 'right' : 'bottom';
}
