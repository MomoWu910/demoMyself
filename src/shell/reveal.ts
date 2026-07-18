import './reveal.css';

/** 首頁把 zoom 進去的顏色寫在這個 key，落地頁讀出來當 reveal 起始色。 */
export const REVEAL_KEY = 'shell:enterTone';

/**
 * 跨頁轉場的落地端：從首頁點某個節點 zoom 進它的顏色後，該專案頁一開就先被同一個顏色蓋住，
 * 再淡出揭開頁面——整站因此讀起來像一個連續的空間，而不是各自獨立的頁。
 *
 * 只有「從 render graph 點進來」（sessionStorage 有色）才放 reveal；直接造訪某頁不放，
 * 免得平白閃一下。尊重 prefers-reduced-motion。
 *
 * 要盡早呼叫（entry 最上面），趕在引擎畫出第一幀之前把畫面蓋住。
 */
export function mountReveal(): void {
    let color: string | null = null;
    try {
        color = sessionStorage.getItem(REVEAL_KEY);
        sessionStorage.removeItem(REVEAL_KEY);
    } catch {
        /* sessionStorage 不可用就當作沒有 */
    }
    if (!color) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const cover = () => {
        const el = document.createElement('div');
        el.className = 'shell-reveal';
        el.style.background = color as string;
        document.body.appendChild(el);

        const remove = () => el.remove();
        el.addEventListener('transitionend', remove, { once: true });
        window.setTimeout(remove, 900); // 保險：transitionend 萬一沒觸發

        // 下一幀再開始收，確保先鋪滿再淡出
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('out')));
    };

    if (document.body) cover();
    else window.addEventListener('DOMContentLoaded', cover, { once: true });
}
