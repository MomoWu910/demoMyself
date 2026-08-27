/**
 * 輪盤的規則：袋位順序、注別、賠率、結算。
 *
 * 跟另外三款的 rules.ts 同一個定位——**只有規則，沒有外觀也沒有亂數**。
 *
 * 輪盤在這個遊樂場裡補的是前三款都沒有的一件事：**注別本身是有幾何結構的**。
 * 老虎機押的是「一把」，百家樂押的是五個固定注區，而輪盤的注是「桌布上的一個位置」——
 * 押在 5 和 6 中間那條線上是分注、押在四格交會的那個點上是角注。所以這裡的注別不能是
 * 一串列舉，得是**能被解析、能被驗證、能反推回它蓋住哪些號碼**的東西。
 *
 * 注別用字串當 key（`split:5-6`）而不是物件，理由是它要能當 `Record` 的鍵、能原封不動
 * 塞進封包、能在 store 裡比對。物件做不到這三件事的任何一件，除非每次都再序列化一次。
 * 代價是字串可以亂寫，所以**進 server 的每一個 key 都要過 `parseBetKey`**——
 * 它是這一層唯一的入口驗證。
 */

/**
 * 輪盤上袋位的實際順序（歐式單零，順時針）。
 *
 * 這串數字**不是 0~36 排一排**，而是輪盤製造商定下來的順序，它有兩個刻意的性質：
 * 紅黑交替，而且相鄰的兩個號碼在桌布上離得很遠。這讓「押桌布上連成一片的號碼」
 * 跟「押輪盤上連成一片的袋位」變成兩件不同的事——賭桌上那些鄰注玩法就是建立在這上面的。
 *
 * 對前端來說它還有一個更實際的用途：**球要停在哪個角度，是從這串順序反推出來的**
 * （見 wheel.ts 的 pocketAngle）。順序抄錯的話，球會停在正確號碼的隔壁格，
 * 而那種錯只有在對著畫面數格子時才看得出來。
 */
export const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
    10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

/** 袋位總數。歐式 37 格（單零）——美式的雙零會讓莊家優勢從 2.7% 翻成 5.26% */
export const POCKET_COUNT = WHEEL_ORDER.length;

/** 紅色號碼。剩下的非 0 號碼就是黑色，不必再列一份（列兩份就會有一天對不上） */
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type PocketColor = 'red' | 'black' | 'green';

export function colorOf(n: number): PocketColor {
    if (n === 0) return 'green';
    return RED.has(n) ? 'red' : 'black';
}

/**
 * 桌布上的號碼格：3 列 × 12 欄，0 在左端獨自跨三列。
 *
 * `r` 由上往下數（0=最上列 3,6,9…），`c` 由左往右數。這個對應關係在畫桌布、
 * 做命中判定、算籌碼落點三個地方都要用到，所以它是規則的一部分而不是畫圖的細節。
 */
export function numberAt(r: number, c: number): number {
    return c * 3 + (3 - r);
}

/** 反過來：某個號碼在桌布的第幾列第幾欄。0 沒有格位（它在左端那一塊），回 null */
export function cellOf(n: number): { r: number; c: number } | null {
    if (n < 1 || n > 36) return null;
    const c = Math.floor((n - 1) / 3);
    return { r: 3 - (n - c * 3), c };
}

// ---- 注別 -------------------------------------------------------------------

/**
 * 一注押的是什麼。
 *
 * 前五種是**內注**（押在號碼格上，賠率高），後五種是**外注**（押在桌布外圈，接近五五開）。
 * 這個分界不只是賠率的差別：內注的位置由桌布幾何決定（哪兩格相鄰才有分注），
 * 外注的位置是固定的幾塊區域。命中判定因此是兩套邏輯（見 felt.ts）。
 */
export type BetType =
    | { kind: 'straight'; n: number }
    | { kind: 'split'; a: number; b: number }
    | { kind: 'street'; row: number }
    | { kind: 'corner'; base: number }
    | { kind: 'line'; row: number }
    | { kind: 'dozen'; index: number }
    | { kind: 'column'; index: number }
    | { kind: 'red' }
    | { kind: 'black' }
    | { kind: 'odd' }
    | { kind: 'even' }
    | { kind: 'low' }
    | { kind: 'high' };

export type BetKind = BetType['kind'];

/** 一注的字串鍵。格式見 `formatBetKey` */
export type BetKey = string;

/** 注單：鍵是注別，值是押了多少 */
export type Bets = Record<BetKey, number>;

/**
 * 賠率（**不含本金**的倍數）。
 *
 * 全部都是 `(36 / 蓋住幾個號碼) - 1`：直注蓋 1 個賠 35、分注蓋 2 個賠 17、
 * 紅黑蓋 18 個賠 1。這個公式在 37 格的輪盤上算下來，每一種注的期望值都是
 * **-1/37 = -2.7%**——莊家優勢完全來自那個 0，跟你押哪裡無關。
 *
 * 這是輪盤最漂亮的一件事，也是 check 腳本第一條要驗的：**沒有哪一種注比較划算**。
 */
export const PAYOUT: Record<BetKind, number> = {
    straight: 35,
    split: 17,
    street: 11,
    corner: 8,
    line: 5,
    dozen: 2,
    column: 2,
    red: 1,
    black: 1,
    odd: 1,
    even: 1,
    low: 1,
    high: 1,
};

export function formatBetKey(bet: BetType): BetKey {
    switch (bet.kind) {
        case 'straight':
            return `straight:${bet.n}`;
        case 'split':
            return `split:${bet.a}-${bet.b}`;
        case 'street':
            return `street:${bet.row}`;
        case 'corner':
            return `corner:${bet.base}`;
        case 'line':
            return `line:${bet.row}`;
        case 'dozen':
            return `dozen:${bet.index}`;
        case 'column':
            return `column:${bet.index}`;
        default:
            return bet.kind;
    }
}

/**
 * 把字串鍵解回注別，**順便驗證它是不是一個真的存在的注**。
 *
 * 「存在」比「格式正確」嚴格得多：`split:3-4` 格式無誤，但桌布上 3 和 4 不相鄰
 * （3 在第一列的最右、4 在下一欄的最上），那條線根本不存在，所以它得被擋下來。
 * 同理 `corner:33` 不成立（33 在最右欄，右邊沒有格子可以圍成四方）。
 *
 * 這些檢查寫在規則層而不是 UI 層，是因為**注是從網路來的**——UI 只送得出畫面上點得到的
 * 位置，但 server 不能假設對面是自己寫的 UI。
 */
export function parseBetKey(key: BetKey): BetType | null {
    switch (key) {
        case 'red':
        case 'black':
        case 'odd':
        case 'even':
        case 'low':
        case 'high':
            return { kind: key };
    }

    const [kind, rest] = key.split(':');
    if (rest === undefined) return null;

    switch (kind) {
        case 'straight': {
            const n = int(rest);
            return n !== null && n >= 0 && n <= 36 ? { kind: 'straight', n } : null;
        }

        case 'split': {
            const parts = rest.split('-');
            if (parts.length !== 2) return null;
            const a = int(parts[0]);
            const b = int(parts[1]);
            if (a === null || b === null || a >= b) return null;
            return isSplit(a, b) ? { kind: 'split', a, b } : null;
        }

        case 'street': {
            const row = int(rest);
            return row !== null && row >= 0 && row < 12 ? { kind: 'street', row } : null;
        }

        case 'corner': {
            const base = int(rest);
            /*
             * `base` 是那四格裡**號碼最小**的一格，在桌布上位於左下角。
             *
             * 兩個限制：`base % 3 === 0` 的號碼（3、6、9…）在最上列，它的 +1 會跳到
             * 隔壁欄去，圍不成四方；`base > 32` 則是最右邊那一欄，右邊沒有格子了。
             */
            if (base === null || base < 1 || base > 32 || base % 3 === 0) return null;
            return { kind: 'corner', base };
        }

        case 'line': {
            const row = int(rest);
            return row !== null && row >= 0 && row < 11 ? { kind: 'line', row } : null;
        }

        case 'dozen': {
            const index = int(rest);
            return index !== null && index >= 0 && index < 3 ? { kind: 'dozen', index } : null;
        }

        case 'column': {
            const index = int(rest);
            return index !== null && index >= 0 && index < 3 ? { kind: 'column', index } : null;
        }

        default:
            return null;
    }
}

/**
 * 這兩個號碼在桌布上是不是相鄰（分注成立的條件）。
 *
 * 0 是特例：它在桌布左端那一塊，右邊直接靠著 1、2、3 三格，所以 `0-1`、`0-2`、`0-3`
 * 都是成立的分注。少了這三條線，0 就只剩直注可押——真桌上不是這樣。
 */
function isSplit(a: number, b: number): boolean {
    if (a === 0) return b >= 1 && b <= 3;
    if (a < 1 || b > 36) return false;
    // 同一欄的上下相鄰：差 1，且 a 不是那一欄最上面那格（3、6、9… 的下一個號碼是隔壁欄）
    if (b - a === 1 && a % 3 !== 0) return true;
    // 左右相鄰的兩欄同一列：差 3
    return b - a === 3;
}

/** 一注蓋住哪些號碼。結算、賠率驗證、桌布高亮全部走這一支 */
export function numbersOf(bet: BetType): number[] {
    switch (bet.kind) {
        case 'straight':
            return [bet.n];
        case 'split':
            return [bet.a, bet.b];
        case 'street':
            return [bet.row * 3 + 1, bet.row * 3 + 2, bet.row * 3 + 3];
        case 'corner':
            return [bet.base, bet.base + 1, bet.base + 3, bet.base + 4];
        case 'line':
            return Array.from({ length: 6 }, (_, i) => bet.row * 3 + 1 + i);
        case 'dozen':
            return Array.from({ length: 12 }, (_, i) => bet.index * 12 + 1 + i);
        case 'column':
            return Array.from({ length: 12 }, (_, i) => i * 3 + bet.index + 1);
        case 'red':
            return [...RED].sort((x, y) => x - y);
        case 'black':
            return range36().filter((n) => colorOf(n) === 'black');
        case 'odd':
            return range36().filter((n) => n % 2 === 1);
        case 'even':
            return range36().filter((n) => n % 2 === 0);
        case 'low':
            return range36().filter((n) => n <= 18);
        case 'high':
            return range36().filter((n) => n >= 19);
    }
}

/**
 * 這一注有沒有中。
 *
 * **0 讓所有外注都輸**——沒有「退一半」也沒有「關進監獄」（那是某些賭場的 en prison
 * 規則，會把莊家優勢砍半）。這裡採最單純的歐式規則，因為它讓每一種注的期望值一致，
 * 而那正是這一層最值得被驗的性質。
 */
export function covers(bet: BetType, n: number): boolean {
    if (n === 0) return bet.kind === 'straight' ? bet.n === 0 : bet.kind === 'split' && bet.a === 0;
    return numbersOf(bet).includes(n);
}

/**
 * 結算：每一注**回本多少**（含本金，沒中就是 0）。
 *
 * 語意跟百家樂那支 `settleBets` 一致——回的是「拿回來多少」而不是「淨賺多少」，
 * 因為錢包那側要做的事是 credit，不是加加減減。
 */
export function settleBets(bets: Bets, winning: number): Record<BetKey, number> {
    const out: Record<BetKey, number> = {};

    for (const [key, stake] of Object.entries(bets)) {
        if (!Number.isFinite(stake) || stake <= 0) continue;
        const bet = parseBetKey(key);
        if (!bet) continue;
        out[key] = covers(bet, winning) ? stake + stake * PAYOUT[bet.kind] : 0;
    }
    return out;
}

/** 一份注單押了多少錢。飛幣、限紅、結算摘要都要用 */
export function totalStake(bets: Bets): number {
    return Object.values(bets).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
}

/**
 * 桌上所有合法的注別，共 154 種。
 *
 * 產生出來而不是手寫一張表：手寫的話 `corner` 那 22 種一定會漏掉幾個，而漏掉的那幾格
 * 在畫面上點下去只會「沒反應」，是最難被發現的一種錯。這份清單同時是 check 腳本的
 * 受測集合，也是散客隨機挑注時的母體。
 */
export function allBetKeys(): BetKey[] {
    const keys: BetKey[] = [];

    for (let n = 0; n <= 36; n++) keys.push(`straight:${n}`);
    for (let a = 0; a <= 36; a++) {
        for (let b = a + 1; b <= 36; b++) if (isSplit(a, b)) keys.push(`split:${a}-${b}`);
    }
    for (let row = 0; row < 12; row++) keys.push(`street:${row}`);
    for (let base = 1; base <= 32; base++) if (base % 3 !== 0) keys.push(`corner:${base}`);
    for (let row = 0; row < 11; row++) keys.push(`line:${row}`);
    for (let i = 0; i < 3; i++) keys.push(`dozen:${i}`, `column:${i}`);
    keys.push('red', 'black', 'odd', 'even', 'low', 'high');

    return keys;
}

function range36(): number[] {
    return Array.from({ length: 36 }, (_, i) => i + 1);
}

function int(text: string): number | null {
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
}
