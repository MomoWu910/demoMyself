/**
 * 返回鈕的行為：**優先回上一頁**（`history.back()`），而不是導向父頁。
 *
 * 為什麼：把返回做成導向父頁的 `<a href>`／`location.href` 是「前進導航」，每按一次就 push 一筆
 * 新歷史紀錄——點來點去瀏覽器的上一頁就堆滿重複頁面。改用 `history.back()` 只移動歷史指標、
 * 不新增紀錄，也不會有「導向 referrer」造成的頁面互指死循環（那是另一種寫法的坑）。
 *
 * 自然動線下「上一頁」就等於我們想回的父頁（首頁→節點頁、實驗結論→壓測），所以 back 會正確落點。
 * 只有「直接開這頁」（沒有同源 referrer，例如貼網址進來）才 fallback 導到指定父頁。
 */
export function goBack(fallbackHref: string): void {
    let cameFromSameSite = false;
    try {
        cameFromSameSite = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
        /* referrer 解析失敗就當作直接造訪 */
    }
    if (cameFromSameSite && window.history.length > 1) {
        window.history.back();
    } else {
        window.location.replace(fallbackHref); // replace：直接造訪時也不多留一筆歷史
    }
}

/**
 * 把一個既有的返回連結接上 goBack。
 * 保留原 href 當 middle-click / cmd-click / 直接造訪的 fallback，左鍵點擊改走 goBack。
 */
export function wireGoBack(el: HTMLAnchorElement | null): void {
    if (!el) return;
    const fallback = el.getAttribute('href') || './index.html';
    el.addEventListener('click', (e) => {
        // 讓「開新分頁 / 新視窗」等組合鍵維持瀏覽器原生行為
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        goBack(fallback);
    });
}
