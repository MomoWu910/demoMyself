/**
 * 玩法排版共用的量。
 *
 * 只放**兩款玩法都得知道、而且必須是同一個數字**的東西。各玩法自己的比例
 * （路圖佔多高、格子多寬）留在自己那支檔案裡——那些是該款玩法的設計決定，
 * 抽到這裡只會讓改一款的時候不小心動到另一款。
 */

/**
 * 設計基準的畫布尺寸。
 *
 * 這一頁所有寫死的 px（字級、卡片大小、讓位高度）都是在這個尺寸下調出來的。
 * 有了基準才有「現在比當初大幾倍」這個問題可問——沒有的話，每個數字都只是
 * 某次微調留下的常數，換一塊螢幕就沒人知道該乘多少。
 */
const DESIGN_W = 1440;
const DESIGN_H = 860;

/**
 * 放大的上限。
 *
 * 有上限是因為**再往上就不是「看得清楚」而是「放大鏡模式」**了：4K 螢幕前面的人
 * 跟筆電前面的人距離差不多，字放到兩倍只會讓一屏塞不下幾張卡。1.5 是「2560 寬時
 * 卡片標題從 15px 變 22px」——那個大小在一臂遠讀得很輕鬆，版面又還留得住五欄卡片。
 */
const SCALE_MAX = 1.5;

/**
 * 整頁的 UI 縮放係數。
 *
 * **只放大、不縮小**（下限鎖在 1）。窄畫面另有一整套換版面的分支（見 lobby/index.ts
 * 與 style.css 的 media query），那些是「換排法」而不是「等比縮小」——手機上把桌機版
 * 整組縮成 0.6 倍，得到的是一頁誰都點不到的迷你按鈕。
 *
 * 取寬高兩者的**較小值**：只看寬度的話，一面 2560×720 的超寬螢幕會被判定成
 * 「空間充足」，然後用 1.5 倍的字把只剩 500px 的內容區撐爆。
 *
 * canvas 與 DOM 兩側共用這一個值——canvas 那側直接乘進尺寸，DOM 那側由
 * core/stage.ts 寫成 CSS 變數 `--ui-scale`（見 style.css 開頭的說明）。
 * 兩邊各算各的話，放大後頂列與盤面之間就會錯開一截。
 */
export function uiScale(w: number, h: number): number {
    return Math.max(1, Math.min(SCALE_MAX, Math.min(w / DESIGN_W, h / DESIGN_H)));
}

/**
 * 頂列（返回鍵、連線徽章、語言鈕）佔住的高度。
 *
 * 算出來而不是去量 DOM：這幾個元素的位置由 CSS 的 `top` 決定，不隨內容變動。
 * 會變的是底部面板——語言、玩法、抽屜開合都會改變它的高度，那個才值得實測回報
 * （見 store 的 dockHeight 與 ui/Hud.tsx 的 useDockMeasure）。
 *
 * 基準值的來源：`.top` 從 16px 開始、高約 34px，語言鈕再往下錯開一列到 58px、高約 34px，
 * 所以右上角實際被佔到 92px。取 72 是因為左半邊只有返回鍵那一列，玩法的盤面
 * 多半是置中的，用最保守的 92 會白白讓出一截。
 *
 * 乘上 scale 是因為 CSS 那側整條頂列也跟著放大了——**這裡不跟著乘，大螢幕上
 * 盤面就會被放大後的頂列壓到**。
 */
export const TOP_BAR = 72;
export function topBarH(scale: number): number {
    return TOP_BAR * scale;
}

/**
 * 大廳的分類 tab 列與頁腳各佔多高。
 *
 * 這兩條也是 DOM 畫的、canvas 要讓位的東西，但**它們不像操作面板那樣需要實測**：
 * tab 是固定一列膠囊、頁腳是固定一列圖示，內容再怎麼換語言都不會多長出一行。
 * 判準就是那句老話——**會變的才量，不會變的算得出來**（見 ui/Hud.tsx 的 useDockMeasure）。
 *
 * 改這裡要同步改 style.css 的 `.lobby-tabs` 與 `.lobby-foot`，兩邊是同一組數字，
 * 而且兩邊都要吃同一個 scale。
 */
export const LOBBY_TAB_H = 48;
export const LOBBY_FOOTER_H = 66;
export function lobbyTabH(scale: number): number {
    return LOBBY_TAB_H * scale;
}
export function lobbyFooterH(scale: number): number {
    return LOBBY_FOOTER_H * scale;
}
