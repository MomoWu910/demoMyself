/**
 * 節點的形狀——一片葉子。
 *
 * 節點原本是圓的，但 scene.ts 的漂浮邏輯從一開始寫的就是「浮在水面上的葉子：被別人的漣漪
 * 推著晃」。既然整個首頁是一面映著天色的水，節點就該真的是葉子，不是圓形加一個符號。
 * 一併拿掉的是圓心那個 glyph（⊕ ⇄ ∿ ◈ ▤）——那五個字元沒有共通的語彙，讀者無從解碼，
 * 識別本來就是靠顏色與葉子下方的文字標籤在做。
 *
 * **形狀是算出來的，不是貼圖**，理由是節點外框要一段一色地標示技術棧（見 projects.ts 的
 * stack 欄位）。換成 PNG／SVG 素材就只剩一個剪影，那段資訊會整個消失；程序化畫則能沿著
 * 葉緣分段上色，還能在天色翻面時直接換色、不吃任何載入成本。
 *
 * 這裡只出幾何，不碰顏色也不碰 Pixi：scene.ts 拿點陣列畫 Graphics，Shell.tsx 拿同一組
 * 公式產 SVG path 畫 inspector 上那片迷你葉。兩邊形狀完全一致，因為是同一個函式。
 */

/** 半寬 / 半長。0.34 落在披針形與卵形之間——再寬就讀成葉片以外的東西，再窄就容不下葉脈。 */
const LEAF_WIDTH = 0.34;

/**
 * 葉基的飽滿度：`u^BASE` 那個指數。越小葉基越圓鈍（心形葉），越大越楔形。
 * 0.6 是圓鈍與楔形之間，葉柄端收得夠快、不會胖成一顆水滴。
 */
const LEAF_BASE = 0.6;

/**
 * 葉子的半長相對節點半徑 r 的倍率。
 *
 * 1.15 不是隨手取的：葉子比同半徑的圓瘦得多（面積約只有四成），照 r 畫會比原本的圓
 * 明顯「輕」，在圖上跟其他元素的視覺重量就對不上。沿長軸拉長把重量補回來，
 * 而短軸方向仍比圓窄，節點之間反而更不容易碰在一起。
 */
export const LEAF_LEN = 1.15;

/**
 * 葉緣的形狀函數：`u^a · (1-u)^b`（此處 b = 1）這一族曲線正好長成葉片的側影——
 * u→0 那端張開、u→1 那端收成一個尖點，峰值落在 `u = a/(a+b)`（這裡是 0.375，
 * 最寬處偏葉柄側，跟真的葉子一樣）。
 *
 * 除以峰值做正規化，回傳 0..1：改 LEAF_BASE 調葉基形狀時，最寬處仍固定是 LEAF_WIDTH，
 * 兩個參數因此互不干擾。
 */
const LEAF_PEAK = Math.pow(LEAF_BASE / (LEAF_BASE + 1), LEAF_BASE) / (LEAF_BASE + 1);

function leafProfile(u: number): number {
    if (u <= 0 || u >= 1) return 0;
    return (Math.pow(u, LEAF_BASE) * (1 - u)) / LEAF_PEAK;
}

export interface Pt {
    x: number;
    y: number;
}

/**
 * 葉緣閉環上的一點，**參數是 s，不是弧長**。s ∈ [0,1) 繞葉子一圈，起點是葉柄。
 *
 * 前半圈 s<0.5 走上緣（葉柄 → 葉尖），後半圈走下緣回到葉柄，兩半共用同一段 tau 值域，
 * 所以閉環是嚴格鏡射對稱的。**起點放葉柄不是任意選的**：分段上色的接縫落在 s=0，
 * 而葉柄那裡本來就有一條伸出去的柄擋著，缺口讀不出來；換成從葉尖起算的話，
 * 三段（最常見的段數）的第一道縫就會切在葉尖上，把葉子最尖銳的那個特徵磨鈍。
 *
 * 對外請一律用 leafEdgeByArc——s 在葉基附近跑得比葉尖慢（葉緣是 u^0.6，導數在 u→0 發散），
 * 直接拿 s 均分會讓分段長短差好幾倍、取樣也疏密不均。
 */
function leafEdge(s: number, L: number): Pt {
    const up = s < 0.5;
    // tau：0 = 葉柄、1 = 葉尖
    const u = up ? s * 2 : 2 - s * 2;
    return {
        x: L * (2 * u - 1),
        y: (up ? -1 : 1) * L * LEAF_WIDTH * leafProfile(u),
    };
}

/**
 * 弧長查表：把「走了整圈的百分之幾」換算回 s。
 *
 * 需要它是因為葉緣各處的疏密差很大——葉基那頭 `u^0.6` 的導數在 u→0 時發散，同樣的 Δs
 * 在那裡只走一點點距離，在葉身中段卻跨很遠。少了這張表會壞掉兩件事：
 *   ① 分段上色會長短不一（實測三段中最短的那段只剩最長的四分之一，根本讀不出是一段）
 *   ② 輪廓取樣會疏密不均，葉尖被一條長弦切掉、葉基被削成平頭
 *
 * 表建在 L=1 上、模組載入時算一次；弧長對 L 是線性的，任何尺寸都可以直接查同一張表。
 */
const ARC_SAMPLES = 2048;
const ARC_S = new Float64Array(ARC_SAMPLES + 1);
const ARC_D = new Float64Array(ARC_SAMPLES + 1);

(function buildArcTable(): void {
    let prev = leafEdge(0, 1);
    let d = 0;
    for (let i = 1; i <= ARC_SAMPLES; i++) {
        const s = i / ARC_SAMPLES;
        const p = leafEdge(s, 1);
        d += Math.hypot(p.x - prev.x, p.y - prev.y);
        ARC_S[i] = s;
        ARC_D[i] = d;
        prev = p;
    }
})();

const ARC_TOTAL = ARC_D[ARC_SAMPLES];

/**
 * 葉緣上「沿輪廓走了 t 圈」的那一點。t ∈ [0,1]，0 與 1 都是葉柄。
 *
 * 這是畫葉子唯一該用的取點函式：t 等分就是弧長等分，分段長度因此相等、取樣密度也均勻。
 */
export function leafEdgeByArc(t: number, L: number): Pt {
    const target = ((t % 1) + 1) % 1 * ARC_TOTAL;

    // 二分找出 target 落在哪一格，再在格內線性內插——表夠密，格內當直線看誤差遠在次像素以下
    let lo = 0;
    let hi = ARC_SAMPLES;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ARC_D[mid] <= target) lo = mid;
        else hi = mid;
    }
    const span = ARC_D[hi] - ARC_D[lo];
    const f = span > 0 ? (target - ARC_D[lo]) / span : 0;
    return leafEdge(ARC_S[lo] + (ARC_S[hi] - ARC_S[lo]) * f, L);
}

/** 葉柄：從葉基再往外接一小段。它是「這是葉子不是柳葉刀」最省事的線索。 */
export function leafStem(L: number): { from: Pt; to: Pt } {
    return { from: { x: -L, y: 0 }, to: { x: -L * 1.3, y: L * 0.05 } };
}

/** 一條側脈：從中脈某處分出、往葉緣弧彎過去。二次貝茲，`c` 是控制點。 */
export interface Vein {
    from: Pt;
    c: Pt;
    to: Pt;
}

/** 中脈的終點（葉尖前一點點收住，畫到底會跟葉緣的尖角疊在一起糊掉）。 */
export function leafMidribEnd(L: number): Pt {
    return { x: L * 0.9, y: 0 };
}

/**
 * 側脈。真葉子的側脈是**朝葉尖弧彎**的，不是直直的魚骨——只差這一點，
 * 讀起來就從「圖示」變成「葉子」。每對兩條，上下鏡射。
 */
export function leafVeins(L: number): Vein[] {
    const out: Vein[] = [];
    const pairs = 5;
    const x = (u: number) => L * (2 * u - 1);
    const w = (u: number) => L * LEAF_WIDTH * leafProfile(u);

    for (let i = 0; i < pairs; i++) {
        // 起點沿中脈均分在 0.14..0.70 之間：太靠葉柄會擠在葉基那個窄處，
        // 太靠葉尖就沒有距離可以彎了。上限 0.70 讓最後一對仍搆得到葉尖那一段。
        const u0 = 0.14 + (i / (pairs - 1)) * 0.56;
        const u1 = Math.min(u0 + 0.2, 0.94);
        for (const dir of [-1, 1]) {
            const tip = dir * w(u1) * 0.82; // 收在葉緣內側，碰到就會跟分段的描邊搶同一條線
            out.push({
                from: { x: x(u0), y: 0 },
                /*
                 * 控制點靠起點那頭、但已經拉到接近末端的高度：出發時斜率陡（脈以大角度
                 * 離開中脈），末段斜率平（轉成與葉緣同向）。真葉子的側脈就是這樣朝葉尖弧彎的，
                 * 少了這個彎，八條線會讀成平行的斜線網格而不是葉脈。
                 */
                c: { x: x(u0 + (u1 - u0) * 0.25), y: tip * 0.85 },
                to: { x: x(u1), y: tip },
            });
        }
    }
    return out;
}

/**
 * 整片葉子的 SVG path（含葉柄與葉脈），畫在一個 size×size 的 viewBox 裡、葉尖朝右上。
 * 給 Shell.tsx 的 inspector 用：那裡要的是一個靜態小圖示，沒必要為它搬一套 Pixi。
 *
 * 回傳分開的兩段：`outline` 要填色＋描邊，`veins` 只描邊。合成一條 path 的話，
 * 葉脈會被 fill-rule 當成要填的區域而糊成一塊。
 */
export function leafSvgPaths(size: number): { outline: string; veins: string } {
    // 0.36 而不是 0.5：葉柄往葉基外再伸 0.3L，而 viewBox 是正方形（葉子要能任意旋轉），
    // 半長得留下這段餘裕，轉到任何角度才都不會被裁掉
    const L = size * 0.36;
    const steps = 48;

    const pt = (p: Pt) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    let outline = `M ${pt(leafEdgeByArc(0, L))}`;
    for (let i = 1; i < steps; i++) outline += ` L ${pt(leafEdgeByArc(i / steps, L))}`;
    outline += ' Z';

    const stem = leafStem(L);
    let veins = `M ${pt(stem.from)} L ${pt(stem.to)}`;
    veins += ` M ${pt({ x: -L, y: 0 })} L ${pt(leafMidribEnd(L))}`;
    for (const v of leafVeins(L)) {
        veins += ` M ${pt(v.from)} Q ${pt(v.c)} ${pt(v.to)}`;
    }
    return { outline, veins };
}
