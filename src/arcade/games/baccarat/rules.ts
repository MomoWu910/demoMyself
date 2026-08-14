/**
 * 百家樂的規則：牌值、補牌、勝負判定、賠付。
 *
 * 跟老虎機的 rules.ts 同一個定位——**只有規則，沒有外觀也沒有亂數**。假 server 拿它
 * 判牌與結算，前端拿它顯示點數與規則說明，兩邊算出來一定一樣。
 *
 * 百家樂跟老虎機最大的差別是：**它的結果不是抽出來的，是算出來的**。老虎機的盤面
 * 是照權重抽一次就定了，百家樂則是抽牌之後**照一張固定的補牌表**推到底，玩家與莊家
 * 都沒有選擇權。這件事讓整款遊戲的隨機性全部集中在洗牌，也讓補牌規則變成最該被
 * 測試蓋住的地方——寫錯一格，長期回報率會偏掉，但單看幾局完全看不出來。
 */

/** 花色。只影響長相，不影響任何判定。 */
export const SUITS = ['spade', 'heart', 'club', 'diamond'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
    /** 1=A、11=J、12=Q、13=K */
    rank: number;
    suit: Suit;
}

/**
 * 牌點：A 算 1，10/J/Q/K 都算 0，其餘照面值。
 *
 * 「花牌算 0」是百家樂的特徵——它讓十點牌變成最沒用的牌，也讓點數分布跟二十一點
 * 完全不同。這是牌值唯一的轉換，沒有其他特例。
 */
export function cardValue(card: Card): number {
    return card.rank >= 10 ? 0 : card.rank;
}

/** 一手牌的點數：總和取個位數。 */
export function handTotal(cards: Card[]): number {
    return cards.reduce((sum, c) => sum + cardValue(c), 0) % 10;
}

/**
 * 閒家要不要補第三張。
 *
 * 規則簡單到只有一條線：**0~5 補，6~7 停**（8、9 是天牌，在外層就結束了）。
 */
export function playerDraws(total: number): boolean {
    return total <= 5;
}

/**
 * 莊家要不要補第三張。
 *
 * 這是整款遊戲唯一複雜的地方，也是最容易抄錯的一張表。莊家的決定**取決於閒家補到什麼**：
 *
 * | 莊家點數 | 閒家沒補 | 閒家補的第三張是 |
 * |---|---|---|
 * | 0–2 | 補 | 一律補 |
 * | 3 | 補 | 除了 8 都補 |
 * | 4 | 補 | 2–7 才補 |
 * | 5 | 補 | 4–7 才補 |
 * | 6 | 停 | 6–7 才補 |
 * | 7 | 停 | 停 |
 *
 * 「閒家沒補」那一欄跟閒家自己的規則一樣（0~5 補），所以不必另寫一套。
 * 有規律可循的是後面那一欄：**莊家點數越大，能讓他補牌的閒家第三張範圍越窄**，
 * 而且範圍都是往 7 收斂的一段區間——除了 3 那一列的「8 除外」是個例外，
 * 那一格沒有道理可講，就是規則長這樣。
 *
 * @param total 莊家前兩張的點數
 * @param playerThird 閒家補的第三張牌點；`null` = 閒家沒補
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
    if (playerThird === null) return total <= 5;

    switch (total) {
        case 0:
        case 1:
        case 2:
            return true;
        case 3:
            return playerThird !== 8;
        case 4:
            return playerThird >= 2 && playerThird <= 7;
        case 5:
            return playerThird >= 4 && playerThird <= 7;
        case 6:
            return playerThird === 6 || playerThird === 7;
        default:
            // 7 停牌；8、9 是天牌，走不到這裡
            return false;
    }
}

export type Outcome = 'player' | 'banker' | 'tie';

/** 一局的完整結果。這是 server 唯一的輸出，前端照它演出與畫路圖。 */
export interface Round {
    player: Card[];
    banker: Card[];
    playerTotal: number;
    bankerTotal: number;
    outcome: Outcome;
    /** 前兩張同點數（真實規則看的是牌面而不是點數，所以 K 與 Q 不算對子） */
    playerPair: boolean;
    bankerPair: boolean;
    /** 天牌：任一方前兩張就 8 或 9 點，雙方都不補牌 */
    natural: boolean;
}

/**
 * 把四張到六張牌推成一局結果。
 *
 * 傳進來的是**已經抽好的牌**而不是牌靴——判定與抽牌分開，這支函式才會是純函式，
 * 驗證腳本能直接餵固定牌組進來比對補牌表（見 roadmap-check.mjs 的作法）。
 *
 * @param deal 依發牌順序排好的牌：閒、莊、閒、莊，之後才是補的牌
 */
export function settleRound(deal: Card[]): Round {
    const player = [deal[0], deal[2]];
    const banker = [deal[1], deal[3]];
    let next = 4;

    const p2 = handTotal(player);
    const b2 = handTotal(banker);
    const natural = p2 >= 8 || b2 >= 8;

    if (!natural) {
        let playerThird: number | null = null;
        if (playerDraws(p2)) {
            const card = deal[next++];
            player.push(card);
            playerThird = cardValue(card);
        }
        if (bankerDraws(b2, playerThird)) {
            banker.push(deal[next++]);
        }
    }

    const playerTotal = handTotal(player);
    const bankerTotal = handTotal(banker);

    return {
        player,
        banker,
        playerTotal,
        bankerTotal,
        outcome: playerTotal === bankerTotal ? 'tie' : playerTotal > bankerTotal ? 'player' : 'banker',
        playerPair: player[0].rank === player[1].rank,
        bankerPair: banker[0].rank === banker[1].rank,
        natural,
    };
}

/** 一局最多用掉幾張牌。發牌前要確認牌靴夠深，中途缺牌是最難處理的錯誤狀態。 */
export const MAX_CARDS_PER_ROUND = 6;

// ---- 下注與賠付 ----

export const BET_SPOTS = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'] as const;
export type BetSpot = (typeof BET_SPOTS)[number];

/** 各注區押了多少。沒押的注區不必出現。 */
export type Bets = Partial<Record<BetSpot, number>>;

/**
 * 賠率（**不含本金**）。
 *
 * 莊家的 0.95 是抽水後的數字：贏了照 1:1 賠，但要抽 5% 的佣金。這 5% 不是賭場貪心，
 * 而是**補牌規則本身就偏向莊家**——莊家後手行動、看得到閒家補什麼，勝率天生高一點。
 * 不抽水的話莊家注會變成玩家期望值為正的押法，整張桌子的數學就垮了。
 *
 * 和局 8:1 與對子 11:1 是常見配置。這兩個注區的莊家優勢遠高於莊閒（和局約 14%），
 * 所以它們在真實桌上叫「幸運注」——賠率好看，長期最傷。
 */
export const PAYOUTS: Record<BetSpot, number> = {
    player: 1,
    banker: 0.95,
    tie: 8,
    playerPair: 11,
    bankerPair: 11,
};

/**
 * 結算：每個注區**拿回多少**（含本金）。0 = 全輸，等於押注額 = 平手退還。
 *
 * 回傳「拿回多少」而不是「淨輸贏」，是因為錢包那側做的是「先請款、後入帳」
 * （見 server/wallet.ts）——押注時錢已經扣走了，結算只需要知道要還多少回去。
 * 用淨額的話兩邊要各自記得本金去哪了，那是對帳最常出錯的地方。
 */
export function settleBets(bets: Bets, round: Round): Record<BetSpot, number> {
    const out = {} as Record<BetSpot, number>;
    for (const spot of BET_SPOTS) out[spot] = 0;

    for (const spot of BET_SPOTS) {
        const stake = bets[spot] ?? 0;
        if (stake <= 0) continue;

        switch (spot) {
            case 'player':
            case 'banker':
                // 和局時莊閒注**退還本金**而不是輸掉——這是百家樂的規矩，
                // 少了這一條，和局的莊家優勢會從 1% 暴增到 14%
                if (round.outcome === 'tie') out[spot] = stake;
                else if (round.outcome === spot) out[spot] = stake + stake * PAYOUTS[spot];
                break;

            case 'tie':
                if (round.outcome === 'tie') out[spot] = stake + stake * PAYOUTS.tie;
                break;

            case 'playerPair':
                if (round.playerPair) out[spot] = stake + stake * PAYOUTS.playerPair;
                break;

            case 'bankerPair':
                if (round.bankerPair) out[spot] = stake + stake * PAYOUTS.bankerPair;
                break;
        }
    }

    return out;
}
