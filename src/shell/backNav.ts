import { t, onLangChange } from '../i18n';

/**
 * 「返回」要回到**實際來源頁**，而不是寫死的目的地。
 *
 * shader_lab 與 findings 同時能從首頁 render graph 和 pixi_hub 進入，
 * 以前 back 寫死一個 href，於是「從首頁進 shader lab、按返回卻回到 pixiJS 實驗場」。
 * 這裡改成看 referrer：同源就回上一頁、否則回首頁，標籤也跟著來源與語言變。
 */
interface BackTarget {
    href: string;
    labelKey: string;
}

function resolveBack(): BackTarget {
    try {
        const ref = document.referrer;
        if (ref) {
            const u = new URL(ref);
            if (u.origin === window.location.origin && u.href !== window.location.href) {
                const page = u.pathname.split('/').pop() || 'index.html';
                if (page === '' || page === 'index.html') return { href: u.href, labelKey: 'nav.backHome' };
                if (page === 'pixi_hub.html') return { href: u.href, labelKey: 'nav.backHub' };
                return { href: u.href, labelKey: 'nav.back' };
            }
        }
    } catch {
        /* referrer 解析失敗就退回首頁 */
    }
    return { href: './index.html', labelKey: 'nav.backHome' };
}

/**
 * 把一個既有的返回連結接上「回到來源頁」的行為。
 * 標籤依來源動態、跟著語言切換；移掉 data-i18n 免得 i18n 的 applyDom 又把文字改回去。
 */
export function wireBack(el: HTMLAnchorElement | null): void {
    if (!el) return;
    const target = resolveBack();
    el.href = target.href;
    el.removeAttribute('data-i18n');
    const paint = () => {
        el.textContent = t(target.labelKey);
    };
    paint();
    onLangChange(paint);
}
