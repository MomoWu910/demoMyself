import type { Rect } from '../table/tableLayout';
import type { ScrollableRoad } from './ScrollableRoad';

/**
 * 五張路怎麼擺進畫面最底下那一條。
 *
 * 兩張桌台共用。**排法由寬度決定，不由裝置決定**：
 *
 * - 寬得下就**一排五張**（珠盤／大路／大眼／小路／曱甴），大路拿走剩下的所有寬度——
 *   它是看的人最常盯著的那張，也是唯一會長到幾十欄的。
 * - 放不下就**上下兩排**：上排珠盤加大路，下排三張衍生路平分。格子會變小，
 *   但五張路都還在畫面上。
 *
 * 為什麼不乾脆讓一排五張往旁邊捲：**路單是拿來掃的，不是拿來翻的。** 每一張路自己
 * 已經可以橫捲（看更早的局），再讓整條也能捲，玩家就得先捲到才知道有幾張路。
 *
 * 判準寫成「算出一排需要多寬」而不是抓一個螢幕寬度的門檻，因為需要的寬度是**高度**
 * 的函數——路單越高格子越大，一排就越擠。同一支手機轉個方向就會換排法，那是對的。
 */

export interface RoadSet {
    bead: ScrollableRoad;
    big: ScrollableRoad;
    bigEye: ScrollableRoad;
    small: ScrollableRoad;
    cockroach: ScrollableRoad;
}

/** 珠盤給幾欄可視、衍生路給幾欄。大路吃剩下的 */
const BEAD_COLS = 6;
const DERIVED_COLS = 7;
/** 大路至少要看得到幾欄。少於這個數就不值得排成一排了 */
const BIG_MIN_COLS = 8;

const GAP = 6;

export function placeRoads(roads: RoadSet, rect: Rect, rows: number): void {
    const cell = rect.h / rows;
    const need = cell * (BEAD_COLS + BIG_MIN_COLS + DERIVED_COLS * 3) + GAP * 4;

    if (need <= rect.w) placeSingleRow(roads, rect, rows, cell);
    else placeTwoRows(roads, rect, rows);
}

/** 一排五張。大路吃掉珠盤與三張衍生路之外的全部寬度 */
function placeSingleRow(roads: RoadSet, rect: Rect, rows: number, cell: number): void {
    const beadW = BEAD_COLS * cell;
    const derivedW = DERIVED_COLS * cell;
    const bigW = rect.w - beadW - derivedW * 3 - GAP * 4;

    let x = rect.x;
    const put = (road: ScrollableRoad, width: number): void => {
        road.setViewport(cell, width, rect.h);
        road.position.set(x, rect.y);
        x += width + GAP;
    };
    put(roads.bead, beadW);
    put(roads.big, bigW);
    put(roads.bigEye, derivedW);
    put(roads.small, derivedW);
    put(roads.cockroach, derivedW);
}

/**
 * 兩排：上排珠盤 + 大路，下排三張衍生路。
 *
 * 上排拿 58% 的高度。不是對半分，因為**上面那兩張是主角**——大路是判斷走勢的依據，
 * 珠盤是逐局的原始記錄；底下三張衍生路是從大路推出來的，看的人少，格子小一點還能忍。
 */
function placeTwoRows(roads: RoadSet, rect: Rect, rows: number): void {
    const topH = rect.h * 0.58;
    const botH = rect.h - topH - GAP;
    const topCell = topH / rows;
    const botCell = botH / rows;

    // 珠盤最多吃三成寬度，也最多顯示 12 欄——再寬就是在替一張「逐局清單」
    // 佔走大路的位置
    const beadW = Math.min(rect.w * 0.3, topCell * 12);
    roads.bead.setViewport(topCell, beadW, topH);
    roads.bead.position.set(rect.x, rect.y);
    roads.big.setViewport(topCell, rect.w - beadW - 8, topH);
    roads.big.position.set(rect.x + beadW + 8, rect.y);

    const derivedW = (rect.w - GAP * 2) / 3;
    const botY = rect.y + topH + GAP;
    const derived = [roads.bigEye, roads.small, roads.cockroach];
    for (let i = 0; i < derived.length; i++) {
        derived[i].setViewport(botCell, derivedW, botH);
        derived[i].position.set(rect.x + (derivedW + GAP) * i, botY);
    }
}
