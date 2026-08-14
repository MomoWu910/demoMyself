import type { CommonC2S, CommonS2C } from '../protocol';
import type { BetSpot, Bets, Round } from '../../games/baccarat/rules';
import type { RoadRound } from '../../games/baccarat/roadmap';

/**
 * 百家樂的封包定義。
 *
 * 型別是從規則檔借來的（`Round`、`Bets`），不是在這裡重新宣告一份——牌的形狀
 * 若兩邊各寫一次，改動時漏掉一邊就會變成「編譯過了但欄位對不上」，那是最難查的一種錯。
 * 借的都是 type-only import，不會產生執行期相依。
 */

/** 牌靴狀態。玩家看得到還剩多少張，是真實桌台會顯示的資訊。 */
export interface ShoeInfo {
    remaining: number;
    total: number;
}

export type BaccaratC2S =
    | CommonC2S
    /** 進桌：要一份桌況（這一靴到目前為止的歷史，用來畫路圖） */
    | { type: 'sit' }
    | { type: 'deal'; bets: Bets };

export type BaccaratS2C =
    | CommonS2C
    /**
     * 桌況。**進桌時給一次整份歷史**，之後每局只送新的那一局。
     *
     * 這個切法跟真實桌台一樣：路圖是「這一靴」的歷史，玩家中途坐下來也要看得到
     * 前面發生過什麼；但之後每局重傳整份就純粹是浪費，client 自己接上去即可。
     */
    | { type: 'table'; history: RoadRound[]; shoe: ShoeInfo }
    | {
          type: 'dealResult';
          round: Round;
          /** 每個注區拿回多少（含本金）。0 = 全輸，見 rules.ts 的 settleBets */
          payouts: Record<BetSpot, number>;
          /** 這一局總共拿回多少。押注時已經扣款，所以這是**入帳額**不是淨輸贏 */
          totalReturn: number;
          balance: number;
          shoe: ShoeInfo;
          /**
           * 這一局打完之後換了新靴。
           *
           * 換靴要**清掉路圖**——路是「這一靴」的歷史，跨靴接下去是沒有意義的。
           * 用旗標而不是讓 client 自己從 `shoe.remaining` 變大推斷：推斷得對的前提是
           * client 記得上一局的值，漏收一個封包就會靜默地把兩靴接在一起。
           */
          shoeChanged: boolean;
      };
