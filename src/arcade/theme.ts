/**
 * 遊樂場的色票——**Pixi 這側的唯一來源**。
 *
 * 以前顏色是散在十幾支檔案裡的十六進位字面值（`0xffd93d` 在六個地方各寫一次）。
 * 那種寫法在只有一款玩法時沒差，要換整套調性時就變成一場考古：漏掉一處，
 * 大廳換好了、轉軸的中獎線還是舊配色，而且那條線只有中獎才畫得出來，
 * 不玩到中獎不會發現。
 *
 * CSS 那半邊的同一組值在 style.css 的 `:root`。**兩邊要一起改**——canvas 與 DOM
 * 疊在同一個畫面上，色差一格就看得出來。這個重複沒辦法消掉（CSS 變數讀不進 Pixi，
 * 而每幀去 getComputedStyle 是不划算的），但可以讓它只發生在一個地方。
 *
 * ---
 *
 * 調性是**黑金**：近黑的暖底，金色只用在邊緣、文字與強調，大面積留給黑。
 * 高級感來自**漸層與層次**而不是色相——同一個金拉出亮金／金／古銅三階，
 * 光打在哪裡就亮哪裡，而不是把整塊塗成金色。
 */

/** 舞台底色。帶一點暖的近黑；純黑會讓金色看起來髒 */
export const BG = 0x0a0908;
/**
 * 面板／卡片的底。
 *
 * 比背景亮**一階半**（0x1a1714 對 0x0a0908）。第一版只亮了半階，結果卡片整片融進
 * 背景裡，一排機台看起來像牆上的浮雕——黑金的層次全靠這點明度差，不能省。
 */
export const INK = 0x1a1714;
/** 比 INK 再深一點，用在凹進去的地方（轉軸的窗、路圖的格子底） */
export const WELL = 0x0d0c0a;

/** 金色三階。亮金是高光，金是主色，古銅是陰影與收邊 */
export const GOLD_BRIGHT = 0xf0dcac;
export const GOLD = 0xd9b871;
export const GOLD_DEEP = 0x8a6a33;

/** 文字。暖白配黑底，純白在這個底色上會刺眼 */
export const TEXT = 0xf2ece1;
export const MUTED = 0x9a9083;

/** 語意色。都壓過飽和度——霓虹紅綠配黑金會把整個畫面拉回廉價感 */
export const HOT = 0xc05a5a;
export const COOL = 0x7fa8bd;
export const GOOD = 0x86a86b;

/** 撲克牌與骰子的牌面。象牙白，不是純白 */
export const IVORY = 0xf4efe6;
/**
 * 還沒做的那些機台，圖示上的牌面用這個。
 *
 * 不能沿用 IVORY——那些卡片整體是壓暗的，**但象牙白的牌面不會跟著暗**，
 * 結果是一排「灰白色塊」比真正能玩的兩張還搶眼，視線完全被帶錯地方。
 */
export const IVORY_DIM = 0x8f887c;

/**
 * 機台的識別色階。
 *
 * 全部是金屬色——**同一個家族拉出層次**，所以一整排掃過去是一套東西，
 * 但每張卡仍然認得出自己。用不同色相（粉／藍／紫）去區分就會變成調色盤展示。
 */
export const METAL = {
    gold: 0xc9a227,
    champagne: 0xe3c88f,
    rose: 0xc98f7a,
    copper: 0xa9714b,
    bronze: 0x8c7853,
    steel: 0x8a8f98,
    oldGold: 0xb08d57,
    brass: 0xbf9f4f,
    pewter: 0x9c9285,
    sand: 0xcdb891,
} as const;

/** 還沒做的機台。暖灰——不是彩色的、但也沒暗到看不清楚 */
export const DIM = 0x6b6357;

/**
 * 百家樂的莊閒和。
 *
 * 紅莊藍閒是牌桌的通用語言，**不能為了配色改掉**——改了之後路圖上的紅藍就跟
 * 全世界的百家樂桌對不起來。能做的是把飽和度壓下來，讓它們在黑金裡不刺眼。
 */
export const BANKER = 0xc2454f;
export const PLAYER = 0x5f93b8;
export const TIE = 0x6faa72;
