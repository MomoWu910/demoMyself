import { uiScale } from '../../core/layout';
import type { Rect } from '../../common/table/tableLayout';

/**
 * 輪盤桌的排版。
 *
 * 為什麼不共用 `common/table/tableLayout`：那一份是**照百家樂的骨架**長出來的
 * （中央一塊發牌區、注區兩列、路單一條、六張椅子左右夾住），兩張百家樂桌共用它是對的，
 * 因為它們真的是同一種桌子。輪盤不是——它的主體是一個很扁的橢圓加一整片很寬的桌布，
 * 硬套那份排版只會得到一堆用不到的欄位和幾個意義被扭曲的欄位。
 *
 * 沿用的是**判準**而不是程式碼：每一段都有理想值與底線，空間不夠時從最捨得讓的那一段
 * 開始壓，而不是整體等比縮小（那會讓每一段同時變得半殘）。
 *
 * ---
 *
 * **這張桌子不畫其他玩家的頭像**，這是排版逼出來的取捨。真實輪盤桌邊確實圍著人，
 * 但這一頁的畫面裡，橢圓輪盤與 12 欄的桌布已經把寬度吃光了——六個頭像塞進去只能
 * 疊在桌布上。所以桌上的「別人」用兩件事表達：右下角的線上人數，以及**從畫面邊緣
 * 飛進來的籌碼**（散客本來就沒有座位，見 rouletteCrowd.ts）。少掉的只有頭像，
 * 熱鬧沒有少。
 */

/** 邊界留白 */
const PAD = 12;

/**
 * 頂列實際佔住的高度。
 *
 * 用 64 而不是共用的 `topBarH`（72）：那個值留了語言鈕錯開的那一列，而**桌台上
 * 沒有那顆鈕**——它收進了畫布裡的齒輪（見 store 的 isTableScene）。多讓出來的
 * 八個 px 在手機橫放上是一整格號碼的高度。理由與取值同 common/table/tableLayout.ts。
 */
const TOP_SAFE = 64;

/**
 * 矮螢幕（手機橫放）專用的高度。
 *
 * **不是把上面那組乘一個係數**——等比縮小會讓每一段同時變得半殘。這一組是逐段
 * 重新決定的：輪盤壓到還看得出球在跑、桌布壓到拇指還按得準、籌碼架壓到還認得出面額。
 * 390 高的畫面扣掉頂列只剩三百出頭，四段的理想值加起來是它的一點八倍，
 * 不另備一組的話整張桌子會直接掉出畫面底（第一版就是這樣）。
 */
const SHORT_H = 560;
const BANDS_SHORT: Record<BandKey, number> = {
    wheel: 84,
    banner: 24,
    felt: 116,
    rail: 42,
};

/** 各段的理想高度與底線（未乘 scale） */
const BANDS = {
    wheel: { ideal: 190, min: 104 },
    banner: { ideal: 34, min: 24 },
    felt: { ideal: 232, min: 138 },
    rail: { ideal: 76, min: 48 },
} as const;

type BandKey = 'wheel' | 'banner' | 'felt' | 'rail';

/**
 * 空間不夠時照這個順序壓。
 *
 * 輪盤先讓：它縮小之後仍然看得出球在跑（那是它唯一非做不可的事），而桌布縮小會直接
 * 讓人押錯格子。籌碼架排最後——按不準面額是這張桌上最貴的一種錯。
 */
const SHRINK_ORDER: BandKey[] = ['wheel', 'felt', 'banner', 'rail'];

/** 桌布再寬也不必超過這個值：12 欄的格子大到某個程度只是浪費，反而要橫著掃視 */
const FELT_MAX_W = 980;

/** 輪盤區與看板之間的縫 */
const GAP = 10;

export interface RouletteLayout {
    scale: number;
    /** 輪盤中心與半徑 */
    wheel: { x: number; y: number; radius: number };
    /** 開獎歷史看板 */
    history: Rect;
    /** 階段膠囊 */
    banner: Rect;
    /** 桌布 */
    felt: Rect;
    /** 籌碼架的可視範圍 */
    chipRail: Rect;
    /** 我自己的座位（左下） */
    mySeat: Rect;
    /** 收回上一注 */
    undo: Rect;
    /** 重複上一局 */
    repeat: Rect;
    /** 線上人數膠囊的左上角 */
    online: { x: number; y: number };
    /** 讀數區左上角 */
    stats: { x: number; y: number };
    /** 齒輪的右上角 */
    more: { x: number; y: number };
    /**
     * 讀數那一列要不要畫。
     *
     * 手機橫放關掉——那裡頂列與輪盤之間根本沒有一條 26px 的空帶可用，硬放會疊在
     * 輪盤的外框上。關掉之後那些數字仍然拿得到：局號在階段膠囊旁邊，
     * 押注與輸贏在齒輪選單裡。
     */
    showStats: boolean;
    /** 籌碼從場外飛進來的幾個起點（散客用）。繞著桌布外圍一圈 */
    crowdOrigins: Array<{ x: number; y: number }>;
}

export function computeRouletteLayout(w: number, h: number): RouletteLayout {
    const scale = uiScale(w, h);
    const short = h <= SHORT_H;
    const top = TOP_SAFE * scale;
    const pad = PAD * scale;

    /*
     * 讀數自己佔一列，而不是浮在輪盤的左上角。
     *
     * 第一版讓它往上擠進頂列下緣（`top - 26`），結果「ROUND」被玩家膠囊壓掉半個字。
     * 頂列的高度是 CSS 決定的，畫布這側只能讓開它——**往上擠一定會撞到**。
     * 矮螢幕則整列關掉（`showStats`），那裡連 26px 都擠不出來。
     */
    const headH = short ? 0 : 30 * scale;

    // ---- 高度分配 ----
    const avail = h - top - headH - pad;
    const gaps = GAP * scale * (short ? 1.6 : 2.6);

    const heights = {} as Record<BandKey, number>;
    let want = gaps;
    for (const key of SHRINK_ORDER) {
        heights[key] = (short ? BANDS_SHORT[key] : BANDS[key].ideal) * scale;
        want += heights[key];
    }

    let over = want - avail;
    for (const key of SHRINK_ORDER) {
        if (over <= 0) break;
        const floor = BANDS[key].min * scale * (short ? 0.8 : 1);
        const give = Math.min(over, heights[key] - floor);
        if (give > 0) {
            heights[key] -= give;
            over -= give;
        }
    }

    /*
     * 每一段都壓到底線還是塞不下（極矮的畫面，例如 300 高的分割視窗）。
     *
     * 到這一步就只剩等比縮小了——它會讓每一段同時變小，但**掉出畫面之外更糟**：
     * 那不是「小」而是「不見了」，而玩家沒有捲軸可以把它捲回來。
     */
    if (over > 0) {
        const total = SHRINK_ORDER.reduce((sum, key) => sum + heights[key], 0);
        const k = Math.max(0.4, (avail - gaps) / total);
        for (const key of SHRINK_ORDER) heights[key] *= k;
    }

    // ---- 橫向：桌布置中，寬度有上限 ----
    const feltW = Math.min(w - pad * 2, FELT_MAX_W * scale);
    const feltX = (w - feltW) / 2;

    let y = top + headH;
    const gap = GAP * scale * (short ? 0.6 : 1);

    /*
     * 輪盤與看板並排。
     *
     * 輪盤畫成橢圓之後**高度只有寬度的四成多**，所以它其實很省垂直空間，卻很吃寬度。
     * 看板則相反（它是幾行細長的東西）。兩個擺在同一列剛好互補，比上下疊省一大截高度。
     */
    const wheelBandH = heights.wheel;
    // 橢圓的外框高約 0.95R（見 wheelView 的 TILT 與外框比例），反推半徑
    const radius = Math.min(wheelBandH / 0.95, feltW * 0.3);
    const wheelW = radius * 2.2;

    const wheel = { x: feltX + wheelW / 2, y: y + wheelBandH / 2, radius };
    const history: Rect = {
        x: feltX + wheelW + gap,
        y,
        w: Math.max(0, feltW - wheelW - gap),
        h: wheelBandH,
    };

    y += wheelBandH + gap;

    const banner: Rect = { x: feltX, y, w: Math.min(feltW * 0.42, 260 * scale), h: heights.banner };
    y += heights.banner + gap * 0.6;

    const felt: Rect = { x: feltX, y, w: feltW, h: heights.felt };
    y += heights.felt + gap;

    // ---- 底列：我的座位 ｜ 籌碼架 ｜ 兩顆動作鈕 ----
    const railH = heights.rail;
    const mySeatW = Math.min(116 * scale, w * 0.2);
    const actionW = Math.min(96 * scale, w * 0.16);
    const actionH = Math.min(railH * 0.46, 34 * scale);

    const mySeat: Rect = { x: feltX, y, w: mySeatW, h: railH };
    const undo: Rect = { x: feltX + feltW - actionW, y, w: actionW, h: actionH };
    const repeat: Rect = { x: feltX + feltW - actionW, y: y + railH - actionH, w: actionW, h: actionH };
    const chipRail: Rect = {
        x: mySeat.x + mySeatW + gap,
        y,
        w: Math.max(0, feltW - mySeatW - actionW - gap * 2),
        h: railH,
    };

    return {
        scale,
        wheel,
        history,
        banner,
        felt,
        chipRail,
        mySeat,
        undo,
        repeat,
        online: { x: feltX + feltW - actionW - 88 * scale, y: banner.y + 4 },
        stats: { x: feltX, y: top },
        showStats: !short,
        more: { x: w - PAD * scale, y: 12 * scale },
        // 散客的籌碼從桌布四周飛進來。取六個點繞一圈，而不是全部從同一個角落——
        // 同一個起點的話，一批注飛起來會像一條射線，而不是「四面八方都有人在押」
        crowdOrigins: [
            { x: feltX - 30 * scale, y: felt.y + felt.h * 0.3 },
            { x: feltX - 30 * scale, y: felt.y + felt.h * 0.8 },
            { x: feltX + feltW * 0.3, y: h + 30 * scale },
            { x: feltX + feltW * 0.7, y: h + 30 * scale },
            { x: feltX + feltW + 30 * scale, y: felt.y + felt.h * 0.8 },
            { x: feltX + feltW + 30 * scale, y: felt.y + felt.h * 0.3 },
        ],
    };
}
