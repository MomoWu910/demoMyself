import type { GameId } from '../net/protocol';
import { PLAYER_ID, type BetRecord } from './ledger';

/**
 * 注單組裝：把「玩家這一局押了哪幾筆」加上「每個注區賠了多少」，變成一列一列的注單。
 *
 * 這一步看起來只是搬資料，但它處理的是一個真實系統一定會撞到的問題：
 * **下注是一次一筆記的，派彩卻是按注區一起算的。**
 *
 * 玩家在莊那格押了 100，過三秒又押了 50，畫面上合成一疊 150 的籌碼，
 * 結算時 `settleBets` 回來的也是「莊這格賠 291」這一個數字。
 * 但注單不能寫成一筆 150——那樣就對不回玩家實際點過的兩次操作，
 * 客訴的時候查不出他到底哪一筆押錯了。
 *
 * 所以要**按比例把注區的派彩攤回每一筆**，而攤分一定會有除不盡的餘數。
 * 這裡的做法是**最後一筆吃掉差額**，理由是攤分後的總和必須等於實際入帳的金額——
 * 少一塊錢的帳，在對帳報表上就是一個查不完的洞。
 *
 * ---
 *
 * **關於 balanceAfter 的取捨（面試會被問）**：
 * 真實系統會把「下注扣款」跟「派彩入帳」記成**兩筆獨立的交易**，
 * 各自有自己的餘額前後，注單只是關聯到這兩筆。
 * 這個 demo 簡化成一筆注單同時帶下注與派彩，
 * `balanceAfter` 用該筆自身的視角算（扣款前餘額 − 下注 + 派彩）。
 * 代價是：同一局有多筆注單時，這些數字不會首尾相接。
 * 這個取捨是刻意的，因為 demo 要展示的是注單查詢與報表，不是交易帳務系統。
 */

/** 一次成功的下注。玩法 server 在扣款成功的當下記下來 */
export interface PendingBet {
    /** 注別。百家樂是 banker/player/tie，輪盤是注別 key */
    spot: string;
    amount: number;
    betAt: number;
    /** 這一筆扣款**前**的餘額 */
    balanceBefore: number;
}

export interface BuildOptions {
    /**
     * 結算時間。不給就用現在。
     *
     * 這個參數存在只為了種子資料——後台要展示的是「過去七天的營運狀況」，
     * 而種子是在開頁的那一瞬間跑出來的。**遊戲正常執行時不會傳它。**
     */
    settledAt?: number;

    /**
     * 有效投注的算法。不給就等於下注額。
     *
     * 有多個注區的玩法都該給 `netExposureValidStake`——押莊又押閒這種對沖注
     * 幾乎不承擔風險，照全額算的話返水就會被它套利。
     */
    validStakeOf?: (bets: PendingBet[], payoutBySpot: Record<string, number>) => Map<PendingBet, number>;
}

/**
 * 組出這一局的注單。
 *
 * @param payoutBySpot 每個注區的派彩總額（**含本金返還**），由玩法的 settleBets 算出
 */
export function buildRecords(
    game: GameId,
    roundId: string,
    pending: PendingBet[],
    payoutBySpot: Record<string, number>,
    opts: BuildOptions = {},
): Omit<BetRecord, 'id' | 'status'>[] {
    if (!pending.length) return [];

    const settledAt = opts.settledAt ?? Date.now();
    const validStakes = opts.validStakeOf?.(pending, payoutBySpot);

    // 先按注區分組，才能把該注區的派彩攤回組內各筆
    const bySpot = new Map<string, PendingBet[]>();
    for (const b of pending) {
        const list = bySpot.get(b.spot);
        if (list) list.push(b);
        else bySpot.set(b.spot, [b]);
    }

    const out: Omit<BetRecord, 'id' | 'status'>[] = [];

    for (const [spot, list] of bySpot) {
        const spotStake = list.reduce((s, b) => s + b.amount, 0);
        const spotPayout = payoutBySpot[spot] ?? 0;

        let distributed = 0;
        list.forEach((b, i) => {
            const isLast = i === list.length - 1;
            // 最後一筆吃掉除不盡的餘數，保證攤分後的總和等於實際派彩
            const payout = isLast
                ? spotPayout - distributed
                : Math.round((spotPayout * b.amount) / spotStake);
            distributed += payout;

            out.push({
                roundId,
                game,
                player: PLAYER_ID,
                betType: spot,
                stake: b.amount,
                validStake: validStakes?.get(b) ?? b.amount,
                payout,
                net: payout - b.amount,
                balanceBefore: b.balanceBefore,
                balanceAfter: b.balanceBefore - b.amount + payout,
                betAt: b.betAt,
                settledAt,
            });
        });
    }

    return out;
}

/**
 * 有效投注：**用這一局實際承擔的風險算，不是用下注額算。**
 *
 * 為什麼需要這個欄位：返水（洗碼）通常按投注量給。押莊 100 同時押閒 100，
 * 下注額是 200，但和局時兩邊都退本金、莊贏時只輸抽水的那 5 塊——
 * **玩家幾乎沒有承擔風險，卻拿到 200 的投注量。**
 * 這是低風險刷流水的做法，照下注額給返水就是在補貼它。
 *
 * 算法：`曝險 = min(總下注, |這一局的淨輸贏|)`，再按下注比例攤回每一筆。
 * - 押單一注別：贏或輸都是全額，曝險等於下注額，不打折
 * - 押莊又押閒且和局：淨輸贏是 0，曝險 0，這一局不計投注量
 * - 紅黑各押一半：多數情況淨輸贏 0，只有開零號那 2.7% 是全輸
 *
 * ---
 *
 * **一開始寫錯的版本值得記下來**：原本用「窮舉所有開獎結果，取最壞情況的損失」
 * 當風險。數學上沒錯，但它答的是另一個問題——輪盤押紅黑，開零號時兩邊全輸，
 * 最壞情況就是 100%，於是折抵率算出來是 1，等於沒折。
 * **可是有效投注要防的不是「會不會輸光」，是「有沒有真的承擔風險」**，
 * 那要看實際結果，不是看最壞的那個分支。
 *
 * 這個錯是 `yarn check:admin` 發現的：測試預期紅黑對沖要大幅折抵，實際回 [100, 100]。
 */
export function netExposureValidStake(bets: PendingBet[], payoutBySpot: Record<string, number>): Map<PendingBet, number> {
    const result = new Map<PendingBet, number>();
    const totalStake = bets.reduce((s, b) => s + b.amount, 0);
    if (totalStake <= 0) return result;

    // 派彩要按**注區**加總，不能逐筆加——同一注區押兩筆的話，
    // `payoutBySpot` 裡那個數字已經是兩筆合起來的派彩，逐筆加會算成兩倍
    const seen = new Set<string>();
    let payout = 0;
    for (const b of bets) {
        if (seen.has(b.spot)) continue;
        seen.add(b.spot);
        payout += payoutBySpot[b.spot] ?? 0;
    }

    const exposure = Math.min(totalStake, Math.abs(payout - totalStake));

    let distributed = 0;
    bets.forEach((b, i) => {
        const v = i === bets.length - 1
            ? exposure - distributed
            : Math.round((exposure * b.amount) / totalStake);
        distributed += v;
        result.set(b, Math.max(0, v));
    });
    return result;
}
