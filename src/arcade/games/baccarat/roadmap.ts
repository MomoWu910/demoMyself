import type { Outcome } from './rules';

/**
 * 路圖推算：大路、大眼仔、小路、曱甴路。
 *
 * 路圖是百家樂桌上最有辨識度的東西，也是**唯一真正有演算法**的部分——牌局本身是
 * 一張補牌表推到底，路圖卻要把幾百局的歷史壓成四張圖。玩家看它找「規律」，
 * 數學上那些規律不影響下一局的機率，但**畫錯了會被一眼看穿**，所以它值得被測試蓋滿。
 *
 * ## 這支檔案的核心決定：邏輯與版面分開
 *
 * 大路存的是「**一欄 = 一條龍**」，欄的長度不受限制。六列是**畫的時候**才有的約束，
 * 超過六顆的龍要往右拖尾（俗稱龍尾），那純粹是排版。
 *
 * 為什麼一定要分開：三張衍生路是從大路推出來的，而它們比對的是「**前面第幾條龍有多長**」。
 * 如果大路只存網格座標，拖尾過的龍會被切成好幾欄，衍生路就會全部算錯——而且錯得很隱晦，
 * 只有在出現長龍（超過六局同一邊）時才發作，一般測資根本碰不到。
 *
 * 所以：`buildBigRoad` 產出邏輯結構，`layoutColumns` 才把它攤到有限列數的網格上。
 */

/** 大路只記莊閒；和局不佔位（見下方 BigRoadEntry.ties）。 */
export type RoadOutcome = 'player' | 'banker';

/** 推算路圖需要知道的一局。`Round` 的結構相容，可以直接傳進來。 */
export interface RoadRound {
    outcome: Outcome;
    playerPair: boolean;
    bankerPair: boolean;
}

/** 大路上的一顆珠子。 */
export interface BigRoadEntry {
    outcome: RoadOutcome;
    /**
     * 這顆之後連續開了幾次和。
     *
     * 和局**不佔新位置**，而是在最後一顆上畫一條斜線；連開兩次和就畫兩條（或標數字）。
     * 這是規矩不是簡化——和局在百家樂不算輸贏（莊閒注退還），路圖的「勢」也不該被它打斷。
     */
    ties: number;
    /** 這一局有沒有對子。畫在珠子的左上／右下角。 */
    playerPair: boolean;
    bankerPair: boolean;
}

export interface BigRoad {
    /** 一欄 = 一條龍。**長度不受六列限制**，那是排版的事。 */
    columns: BigRoadEntry[][];
    /**
     * 開局連開幾次和——還沒有任何莊閒結果可以掛上去的那幾次。
     *
     * 這是真實牌靴會發生的邊界（機率約 9.5%，一靴八十局裡不算罕見），
     * 而大多數路圖實作會直接把它們吃掉。留著讓繪製那側自己決定要不要畫。
     */
    leadingTies: number;
}

/**
 * 把牌局歷史推成大路。
 *
 * 規則只有三條：
 *   1. 和局 → 掛在最後一顆上（`ties`），不佔新位
 *   2. 跟上一顆非和結果**不同** → 開新的一欄
 *   3. 相同 → 接在同一欄後面
 */
export function buildBigRoad(rounds: RoadRound[]): BigRoad {
    const columns: BigRoadEntry[][] = [];
    let leadingTies = 0;
    let last: BigRoadEntry | null = null;

    for (const round of rounds) {
        if (round.outcome === 'tie') {
            if (last) last.ties++;
            else leadingTies++;
            continue;
        }

        const entry: BigRoadEntry = {
            outcome: round.outcome,
            ties: 0,
            playerPair: round.playerPair,
            bankerPair: round.bankerPair,
        };

        const current = columns[columns.length - 1];
        if (current && current[0].outcome === round.outcome) current.push(entry);
        else columns.push([entry]);

        last = entry;
    }

    return { columns, leadingTies };
}

// ---- 三張衍生路 ----

export type DerivedMark = 'red' | 'blue';
export type DerivedRoadKind = 'bigEye' | 'small' | 'cockroach';

/**
 * 三張衍生路的差別**只有一個數字**：往回看幾欄。
 *
 * 大眼仔看前一欄、小路看前兩欄、曱甴路看前三欄，判定規則一模一樣。
 * 知道這件事之後，三張路就是同一支函式帶不同參數，而不是三份互相抄來抄去的程式碼——
 * 這也是為什麼真實桌上這三張圖看起來「很像但又不一樣」。
 */
const LOOKBACK: Record<DerivedRoadKind, number> = {
    bigEye: 1,
    small: 2,
    cockroach: 3,
};

/**
 * 推算一張衍生路。
 *
 * 判定的是**「齊不齊」而不是輸贏**——紅色代表「跟前面比起來有規律」，藍色代表「亂了」。
 * 所以衍生路上的紅藍跟莊閒沒有任何關係，一條全紅的大眼仔可能對應到莊閒交錯的大路。
 *
 * 逐顆走大路的每個邏輯位置 `(c, r)`（第 c 條龍的第 r 顆），令回看距離為 k：
 *
 * - **`r === 0`（這顆開了一條新龍）**：比較前面第 `c-k-1` 條與第 `c-k` 條龍的**長度**。
 *   一樣長 → 紅（換龍的節奏規律），不一樣 → 藍。
 * - **`r > 0`（這顆讓龍變長了）**：看第 `c-k` 條龍在**同樣深度**有沒有牌。
 *   有 → 紅；剛好停在上一格（長度正好是 r）→ 藍；更短 → 紅。
 *
 * 起算點不必寫特例：`r === 0` 需要 `c >= k+1`、`r > 0` 需要 `c >= k`，這兩個條件
 * 自然就長成賭場說的「大眼仔從大路第二欄第二行開始，若第二欄只有一顆則從第三欄第一行開始」。
 *
 * 這裡讀得到 `columns[c-k]` 的最終長度是安全的：`c-k < c`，那條龍在目前這顆落下時
 * 早就結束了。回看距離若是 0 就不成立——所以 LOOKBACK 沒有 0。
 */
export function buildDerivedRoad(road: BigRoad, kind: DerivedRoadKind): DerivedMark[] {
    const k = LOOKBACK[kind];
    const cols = road.columns;
    const len = (i: number): number => cols[i]?.length ?? 0;

    const marks: DerivedMark[] = [];

    for (let c = 0; c < cols.length; c++) {
        for (let r = 0; r < cols[c].length; r++) {
            if (r === 0) {
                if (c < k + 1) continue;
                marks.push(len(c - k - 1) === len(c - k) ? 'red' : 'blue');
            } else {
                if (c < k) continue;
                const reference = len(c - k);
                // 深度夠 → 齊；剛好差一格 → 亂；更短 → 早就不齊了，反而算規律
                marks.push(reference >= r + 1 ? 'red' : reference === r ? 'blue' : 'red');
            }
        }
    }

    return marks;
}

/** 衍生路自己也按「連續同色」分欄，畫法跟大路一樣。 */
export function packDerivedColumns(marks: DerivedMark[]): DerivedMark[][] {
    const columns: DerivedMark[][] = [];
    for (const mark of marks) {
        const current = columns[columns.length - 1];
        if (current && current[0] === mark) current.push(mark);
        else columns.push([mark]);
    }
    return columns;
}

// ---- 排版：把邏輯的龍攤到有限列數的網格上 ----

export interface PlacedCell<T> {
    /** 網格座標（0 = 最左／最上） */
    col: number;
    row: number;
    item: T;
    /** 這顆屬於第幾條龍、在龍裡是第幾顆。繪製時要標長龍或做動畫會用到 */
    columnIndex: number;
    indexInColumn: number;
}

/**
 * 把邏輯欄攤成網格座標，含**拖尾**。
 *
 * 一條龍往下長，撞到底（第 `rows` 列）就轉往右邊繼續，這是路圖最有代表性的形狀。
 * 撞到已經被別條龍佔走的格子也一樣往右——真實桌上這種交纏很常見，而它正是
 * 「不能只用欄索引乘上欄寬來算座標」的原因。
 *
 * 泛型是因為大路與三張衍生路的排版規則完全一樣，差別只在格子裡畫什麼。
 */
export function layoutColumns<T>(columns: T[][], rows: number): Array<PlacedCell<T>> {
    const placed: Array<PlacedCell<T>> = [];
    const taken = new Set<string>();
    const key = (c: number, r: number): string => `${c},${r}`;

    let rightmost = -1;

    for (let ci = 0; ci < columns.length; ci++) {
        // 新的一條龍從目前用到的最右欄再往右開，不是從 ci——前面的拖尾可能已經佔走好幾欄
        let col = rightmost + 1;
        let row = 0;

        for (let i = 0; i < columns[ci].length; i++) {
            if (i > 0) {
                const below = row + 1;
                if (below < rows && !taken.has(key(col, below))) {
                    row = below;
                } else {
                    // 拖尾：列不變，往右找到第一個空格
                    col++;
                    while (taken.has(key(col, row))) col++;
                }
            }

            taken.add(key(col, row));
            rightmost = Math.max(rightmost, col);
            placed.push({ col, row, item: columns[ci][i], columnIndex: ci, indexInColumn: i });
        }
    }

    return placed;
}

// ---- 珠盤路 ----

export interface BeadCell {
    col: number;
    row: number;
    round: RoadRound;
}

/**
 * 珠盤路：**照順序一顆一顆填**，由上往下、填滿一欄換下一欄。
 *
 * 它是四張路裡唯一如實記錄每一局的——和局佔一格、對子標在角上，沒有任何壓縮。
 * 正因為不壓縮，它才是核對其他三張路的基準：其他路怪怪的時候，先看珠盤路對不對。
 */
export function layoutBeadPlate(rounds: RoadRound[], rows: number): BeadCell[] {
    return rounds.map((round, i) => ({
        col: Math.floor(i / rows),
        row: i % rows,
        round,
    }));
}
