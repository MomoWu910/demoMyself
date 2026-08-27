import type { GameId } from '../net/protocol';
import { METAL } from '../theme';

/**
 * 大廳的遊戲清單。
 *
 * 為什麼要有「還沒做」的項目：**滑軌只有兩張卡就不成立**——慣性、分頁箭頭、分類切換
 * 全部沒有用武之地，而那些互動本身正是這一頁要展示的東西。所以清單裡有兩款真的能玩，
 * 加四款掛著 SOON 的。
 *
 * 分辨真假是型別的責任而不是良心的責任：`playable` 為真的項目**才有** `gameId`
 * （見 PlayableEntry / ComingEntry 的聯集）。想進一款沒做的遊戲時，程式碼會在編譯期
 * 就拿不到那個 id，而不是在執行期把 'sicbo' 丟進 `enter()` 換來一個空白畫面。
 */

export type LobbyTab = 'all' | 'electronic' | 'table' | 'card';

/** 分類 tab 的顯示順序。'all' 排第一，跟所有真的博弈大廳一樣 */
export const LOBBY_TABS: LobbyTab[] = ['all', 'electronic', 'table', 'card'];

interface EntryBase {
    /** i18n 用的鍵，同時也是圖示的分辨依據（見 rail.ts 的 drawIcon） */
    key: string;
    category: Exclude<LobbyTab, 'all'>;
    /**
     * 卡片主色。
     *
     * 全部取自 `theme.METAL` 這一個金屬色階——**同一個家族拉出層次**，一整排掃過去
     * 是一套東西，但每張卡仍然認得出自己。用不同色相去區分（粉的老虎機、藍的百家樂）
     * 會讓大廳變成調色盤展示，那正是上一版看起來廉價的原因。
     */
    color: number;
}

interface PlayableEntry extends EntryBase {
    playable: true;
    gameId: GameId;
    /** 角標。真的能玩的才配得上 HOT／NEW */
    badge?: 'hot' | 'new';
}

interface ComingEntry extends EntryBase {
    playable: false;
}

export type LobbyEntry = PlayableEntry | ComingEntry;

/**
 * 十一款、兩排。
 *
 * 數量是排出來的而不是湊出來的：**大廳要滿**——真實平台的大廳是一整面機台，
 * 稀稀落落的三五張卡看起來像個還沒上線的頁面。兩排是商用大廳常見的排法（可視區 400 高、
 * 卡片 180），十款剛好排成 2×5，而桌機一次看得到四欄多一點，所以那條軌真的滑得動。
 */
export const CATALOG: LobbyEntry[] = [
    // 能玩的四款拿最亮的那幾階（金、香檳、玫瑰、銅），佔位的往青銅、鋼那頭排——
    // 明度本身就在說「哪些是現在進得去的」
    { key: 'slot', category: 'electronic', color: METAL.gold, playable: true, gameId: 'slot', badge: 'hot' },
    { key: 'baccarat', category: 'table', color: METAL.champagne, playable: true, gameId: 'baccarat', badge: 'new' },
    { key: 'baccaratLive', category: 'table', color: METAL.rose, playable: true, gameId: 'baccaratLive', badge: 'new' },
    { key: 'roulette', category: 'table', color: METAL.copper, playable: true, gameId: 'roulette', badge: 'new' },
    { key: 'dragontiger', category: 'table', color: METAL.steel, playable: false },
    { key: 'sicbo', category: 'table', color: METAL.pewter, playable: false },
    { key: 'ox28', category: 'card', color: METAL.bronze, playable: false },
    { key: 'paigow', category: 'card', color: METAL.oldGold, playable: false },
    { key: 'goldenflower', category: 'card', color: METAL.sand, playable: false },
    { key: 'sangong', category: 'card', color: METAL.pewter, playable: false },
    { key: 'fruit', category: 'electronic', color: METAL.brass, playable: false },
];

export function entriesFor(tab: LobbyTab): LobbyEntry[] {
    return tab === 'all' ? CATALOG : CATALOG.filter((e) => e.category === tab);
}
