import type { Rect } from '../../common/table/tableLayout';
import { cellOf, numberAt, parseBetKey, type BetKey } from './rules';

/**
 * 桌布的幾何：**位置就是注別**。
 *
 * 這是輪盤跟前三款玩法最根本的差別，也是它值得被做出來的理由。老虎機押的是「一把」，
 * 百家樂押的是五個矩形注區——按鈕在哪裡不影響它是什麼注。輪盤不是：籌碼壓在 5 這一格的
 * 正中央是直注，往左挪三公釐壓在格線上就變成 4 和 5 的分注，再往上挪到四格交會的
 * 那個點又變成角注。**同一次點擊，差幾個像素就是三種賠率完全不同的注。**
 *
 * 所以命中判定不能用「一堆矩形，看點落在哪一個裡面」——那正是 `common/chips/BetSpotView`
 * 的做法，在這裡撐不住。改成反過來算：先算出點落在哪一格的第幾個角落，再由那個相對位置
 * 決定它是哪一種注。
 *
 * 這一層刻意做成**純幾何、不碰 Pixi**，因為它有一個很強的自我驗證方式：
 * 對每一種注算出它的籌碼落點，再把那個落點丟回命中判定，必須原樣拿回同一個注別。
 * 154 種注全部走一遍就是 154 條斷言（見 roulette-check.mjs 的「桌布命中判定」一節），
 * 而這種錯——點下去押到隔壁那一注——用手點是永遠點不完的。
 */

/** 判定為「壓在線上」的容差，佔一格的比例。太小會很難押中分注，太大則直注會難押 */
const EDGE = 0.2;

/**
 * 街注與線注那條帶子的高度（佔一格的比例）。
 *
 * 它跨在號碼區的下緣線上：**線的內側**吃掉最後一列格子的一小截，**外側**則往外長出來
 * 一段。真桌上街注就是押在那條線上，所以判定帶也得跨著那條線，只在外側的話玩家
 * 會覺得那一注很難押中。
 */
const STREET_IN = 0.22;
const STREET_OUT = 0.5;

export interface FeltGeometry {
    /** 整塊桌布 */
    rect: Rect;
    /** 0 那一格（左端，跨三列） */
    zero: Rect;
    /** 號碼區左上角與格子大小 */
    grid: { x: number; y: number; cellW: number; cellH: number };
    /** 右端三格縱列注，索引與 `column:N` 一致（0 = 1,4,7…） */
    columns: Rect[];
    /** 十二數，索引與 `dozen:N` 一致 */
    dozens: Rect[];
    /** 六個五五開的外注，順序照真桌由左到右 */
    evens: Array<{ key: BetKey; rect: Rect }>;
}

/** 五五開外注在桌布下緣的順序。真桌就是這個排法：紅黑夾在中間，兩端是大小單雙 */
const EVEN_ORDER: BetKey[] = ['low', 'even', 'red', 'black', 'odd', 'high'];

/**
 * 算出整塊桌布的幾何。
 *
 * 比例是照真桌抓的：號碼區佔一半高，剩下的一半給兩排外注——**外注的格子要夠大**，
 * 因為那是新手唯一敢押的地方，而它們在手機上得用拇指按得中。
 */
export function computeFelt(rect: Rect): FeltGeometry {
    const zeroW = rect.w * 0.052;
    const colW = rect.w * 0.072;
    const gridW = rect.w - zeroW - colW;
    const cellW = gridW / 12;

    /*
     * 號碼區與外注那兩排之間的縫。
     *
     * 0.022 太窄了（第一版）：**街注與線注的籌碼壓在號碼區的下緣線上**，一半會伸進
     * 下面那排，把「1st 12」的字整個蓋掉。縫要留得下半顆籌碼才行。
     */
    const gapY = rect.h * 0.055;
    const numbersH = rect.h * 0.48;
    const outerH = (rect.h - numbersH - gapY * 2) / 2;
    const cellH = numbersH / 3;

    const gridX = rect.x + zeroW;
    const gridY = rect.y;

    const columns: Rect[] = [];
    for (let i = 0; i < 3; i++) {
        // column:0 是 1,4,7…，它們住在**最下面**那一列，所以索引要倒過來擺
        const r = 2 - i;
        columns.push({ x: gridX + gridW, y: gridY + r * cellH, w: colW, h: cellH });
    }

    const dozenY = gridY + numbersH + gapY;
    const dozens: Rect[] = [];
    for (let i = 0; i < 3; i++) {
        dozens.push({ x: gridX + i * cellW * 4, y: dozenY, w: cellW * 4, h: outerH });
    }

    const evenY = dozenY + outerH + gapY;
    const evenW = (cellW * 12) / 6;
    const evens = EVEN_ORDER.map((key, i) => ({
        key,
        rect: { x: gridX + i * evenW, y: evenY, w: evenW, h: outerH },
    }));

    return {
        rect,
        zero: { x: rect.x, y: gridY, w: zeroW, h: numbersH },
        grid: { x: gridX, y: gridY, cellW, cellH },
        columns,
        dozens,
        evens,
    };
}

/**
 * 點在這裡會押到哪一注。押不到就回 null（間隙、桌布外）。
 *
 * 判定的順序是**由外而內**：先排除外注那兩排與右端的縱列，剩下的才進號碼區去算
 * 「壓在哪條線上」。倒過來寫的話，外注區的點會先被號碼區的邊界判定吃掉。
 */
export function hitTestFelt(g: FeltGeometry, x: number, y: number): BetKey | null {
    for (const { key, rect } of g.evens) if (inside(rect, x, y)) return key;
    for (let i = 0; i < g.dozens.length; i++) if (inside(g.dozens[i], x, y)) return `dozen:${i}`;
    for (let i = 0; i < g.columns.length; i++) if (inside(g.columns[i], x, y)) return `column:${i}`;

    const { x: gx, y: gy, cellW, cellH } = g.grid;
    const gridRight = gx + cellW * 12;
    const gridBottom = gy + cellH * 3;

    // 號碼區（含下方那條街注／線注的帶子）以外就沒東西了
    if (x < g.zero.x || x > gridRight || y < gy || y > gridBottom + cellH * STREET_OUT) return null;

    const edgeX = cellW * EDGE;
    const edgeY = cellH * EDGE;

    // ---- 街注與線注：跨在號碼區下緣那條線上 ----
    if (y >= gridBottom - cellH * STREET_IN && x >= gx) {
        const raw = (x - gx) / cellW;
        const col = clampInt(Math.floor(raw), 0, 11);
        const fx = raw - col;
        // 壓在兩欄交界上＝線注（一次蓋六個號碼），交界左邊那一欄就是它的起點
        if (fx < EDGE && col >= 1) return `line:${col - 1}`;
        if (fx > 1 - EDGE && col <= 10) return `line:${col}`;
        return `street:${col}`;
    }

    /*
     * ---- 0 那一格與它跟 1/2/3 之間的三條線 ----
     *
     * 這條分界帶**跨在 0 與第一欄的邊界上**，兩邊各吃一點。只判 0 那側的話，
     * 從第一欄押過來的手指會押到 1 的直注而不是 0-1 的分注——而那兩注的賠率差一倍。
     */
    if (x < gx + edgeX) {
        if (x < gx - edgeX) return 'straight:0';
        const r = clampInt(Math.floor((y - gy) / cellH), 0, 2);
        return `split:0-${numberAt(r, 0)}`;
    }

    // ---- 號碼區：由相對位置決定是直注、分注還是角注 ----
    const rawC = (x - gx) / cellW;
    const rawR = (y - gy) / cellH;
    const c = clampInt(Math.floor(rawC), 0, 11);
    const r = clampInt(Math.floor(rawR), 0, 2);
    const fx = rawC - c;
    const fy = rawR - r;

    const onLeft = fx < EDGE && c >= 1;
    const onRight = fx > 1 - EDGE && c <= 10;
    const onTop = fy < EDGE && r >= 1;
    const onBottom = fy > 1 - EDGE && r <= 1;

    // 角注要先判：四格交會的那個點同時滿足兩個邊界條件，先判分注的話就永遠押不到角注
    if (onLeft && onTop) return corner(r - 1, c - 1);
    if (onLeft && onBottom) return corner(r, c - 1);
    if (onRight && onTop) return corner(r - 1, c);
    if (onRight && onBottom) return corner(r, c);

    if (onLeft) return split(numberAt(r, c - 1), numberAt(r, c));
    if (onRight) return split(numberAt(r, c), numberAt(r, c + 1));
    if (onTop) return split(numberAt(r - 1, c), numberAt(r, c));
    if (onBottom) return split(numberAt(r, c), numberAt(r + 1, c));

    return `straight:${numberAt(r, c)}`;
}

/**
 * 一注的籌碼要疊在哪裡。
 *
 * 這支跟 `hitTestFelt` 是一組的：**押下去的位置與籌碼出現的位置必須是同一個點**，
 * 不然玩家會覺得籌碼「滑掉了」。所以兩支都從同一份幾何算，而且互為反函式
 * （check 腳本會逐一驗證這件事）。
 */
export function feltAnchor(g: FeltGeometry, key: BetKey): { x: number; y: number } | null {
    const bet = parseBetKey(key);
    if (!bet) return null;

    const { x: gx, y: gy, cellW, cellH } = g.grid;
    const center = (n: number): { x: number; y: number } | null => {
        if (n === 0) return { x: g.zero.x + g.zero.w / 2, y: g.zero.y + g.zero.h / 2 };
        const cell = cellOf(n);
        if (!cell) return null;
        return { x: gx + (cell.c + 0.5) * cellW, y: gy + (cell.r + 0.5) * cellH };
    };

    switch (bet.kind) {
        case 'straight':
            return center(bet.n);

        case 'split': {
            // 0 的三條分注是特例：0 那一格比號碼格寬，取兩個中心的中點會把籌碼推進
            // 第一欄裡面去，看起來就像押在 1 上。它該貼在那條邊界線上
            if (bet.a === 0) {
                const cell = cellOf(bet.b);
                return cell ? { x: gx, y: gy + (cell.r + 0.5) * cellH } : null;
            }
            const a = center(bet.a);
            const b = center(bet.b);
            return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
        }

        /*
         * 街注與線注壓在號碼區的下緣線上，但**籌碼中心要稍微往內縮**。
         *
         * 正好壓在線上的話，籌碼有一半伸進下面那排外注，把「1st 12」的字蓋掉——
         * 真桌上那排離得比較遠，畫面上沒有那個餘裕。往內縮一成，看起來仍然是
         * 壓在線上的那一注，字也留得住。
         */
        case 'street':
            return { x: gx + (bet.row + 0.5) * cellW, y: gy + cellH * (3 - 0.1) };

        case 'line':
            return { x: gx + (bet.row + 1) * cellW, y: gy + cellH * (3 - 0.1) };

        case 'corner': {
            const cell = cellOf(bet.base);
            if (!cell) return null;
            // base 是四格裡最小的那個，它在左下角，所以交點在它的右上
            return { x: gx + (cell.c + 1) * cellW, y: gy + cell.r * cellH };
        }

        /*
         * 外注的籌碼落在**區塊的下半**，不是正中央。
         *
         * 那幾格是整張桌上最多人押的地方，籌碼疊在正中央會把「1st 12」「EVEN」整個蓋掉
         * ——而那幾個字是外注唯一的標示（號碼格至少還有數字可以認）。字往上讓一截、
         * 籌碼往下讓一截，兩邊就都看得見。
         */
        case 'dozen':
            return outsideDrop(g.dozens[bet.index]);

        case 'column':
            return outsideDrop(g.columns[bet.index]);

        default: {
            const found = g.evens.find((e) => e.key === bet.kind);
            return found ? outsideDrop(found.rect) : null;
        }
    }
}

/** 外注區塊裡籌碼疊放的位置：中心偏下 */
export const OUTSIDE_DROP = 0.72;

function outsideDrop(rect: Rect): { x: number; y: number } {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h * OUTSIDE_DROP };
}

function corner(r: number, c: number): BetKey {
    // 傳進來的是四格的左上格；`base` 要的是最小號碼，也就是它正下方那一格
    return `corner:${numberAt(r + 1, c)}`;
}

function split(a: number, b: number): BetKey {
    return a < b ? `split:${a}-${b}` : `split:${b}-${a}`;
}

function inside(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clampInt(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
