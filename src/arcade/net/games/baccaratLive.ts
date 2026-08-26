import type { CommonC2S, CommonS2C } from '../protocol';
import type { OtherBet, SeatInfo, SeatResult } from './baccarat';
import type { BetSpot, Bets, Round } from '../../games/baccarat/rules';
import type { RoadRound } from '../../games/baccarat/roadmap';
import type { LivePhase } from '../../live/schedule';

/**
 * 視訊百家樂的封包。
 *
 * 跟純數位的那一款（`games/baccarat.ts`）比，規則、路圖、賠率一模一樣，
 * **只有一件事變了：誰是節奏的主人。**
 *
 * 數位桌台是 server 說了算——它決定下注 12 秒、發牌 8 秒，client 照著演。
 * 視訊桌台不行：牌真的躺在畫面上，什麼時候出現是**實體世界**決定的，server 只是
 * 把看到的事情廣播出去。所以封包的形狀跟著變了三處，三處都不是為了好看：
 *
 * ### 1. `deal` 是一張一張推的，不是整局一次給完
 *
 * 數位桌台的 `deal` 帶整局的牌，client 自己排 0.16 秒一張演出來——因為那個節奏本來
 * 就是客戶端的自由。視訊桌台沒有這個自由：**第三張牌在畫面上的第 17.3 秒出現，
 * client 就不能在第 16 秒把它畫出來。** 一次給完等於把「還沒發生的事」提前交到
 * client 手上，那是最容易被誤用的一種資料，也是最容易讓 overlay 跟畫面對不上的一種。
 *
 * ### 2. `settle` 不帶「什麼時候演完」的餘裕
 *
 * 數位桌台的 client 收到 `settle` 時可能還在演翻牌，所以那邊要等演出跑完才結算。
 * 這裡沒有這個問題——**牌是影片裡翻的**，server 說結算的那一刻，畫面上的牌就是翻好的。
 * 少掉一整段「等演出」的狀態，是把演出權交出去換來的。
 *
 * ### 3. 座位、注量、輸贏全部沿用數位桌台的型別
 *
 * `SeatInfo`、`OtherBet`、`SeatResult` 直接從 `./baccarat` 借過來，不在這裡重新
 * 宣告一份長得一樣的。**桌上有誰、誰押了什麼、誰贏了多少，跟牌是畫的還是拍的無關**——
 * 兩份各寫一次的話，改動時漏掉一邊就會變成「編譯過了但欄位對不上」，那是最難查的一種錯。
 *
 * 這一版一度把座位拿掉過，理由是「視訊桌台的畫面被荷官佔滿，看不到別人」。那個說法
 * 對半邊：畫面裡確實沒有別人，但**桌台介面裡有**——亞洲市場的 live casino 都會在
 * 視訊旁邊列出同桌玩家與他們的注量，那是這類產品熱度感的主要來源。
 */

/** 桌況快照。中途進桌要能立刻對齊——視訊本來就是接在半路上的 */
export interface LiveSnapshot {
    phase: LivePhase;
    /** 這個階段什麼時候結束（絕對時間戳，毫秒） */
    endsAt: number;
    /** server 現在幾點。client 用 `serverNow - Date.now()` 算時差 */
    serverNow: number;
    /** 這是循環素材裡的第幾局 */
    round: number;
    /** 這一局到現在為止已經落桌的牌 */
    dealt: LiveDealt[];
    /** 已經結束的局。路圖照它畫 */
    history: RoadRound[];
    /** 已經開完的話，整局的牌在這裡 */
    openRound?: Round;
    /** 桌上有誰。座位是**位置**不是身分，所以整份替換而不是送差異 */
    seats: SeatInfo[];
    /** 各注區目前的總押注（含所有人） */
    totals: Record<BetSpot, number>;
    /** 我自己這一局押了多少 */
    myBets: Bets;
    /** 我的餘額。錢包是跨玩法共用的，進桌時要對齊一次 */
    balance: number;
}

/** 一張已經落桌的牌 */
export interface LiveDealt {
    side: 'player' | 'banker';
    /** 該側的第幾張（0-based）。2 就是補牌 */
    index: number;
    suit: Round['player'][number]['suit'];
    rank: number;
    /** 這張牌在畫面上翻開了沒。前四張要等荷官一起攤 */
    faceUp: boolean;
}

export type BaccaratLiveC2S =
    | CommonC2S
    /** 進桌：要一份桌況快照 */
    | { type: 'sit' }
    /**
     * 押一注。**押出去就不能撤**，跟真實桌台一樣。
     *
     * 視訊桌台的截止比數位桌台更硬：數位桌台的「時間到」是 server 自己排的碼表，
     * 邊界上鬆個半秒沒人看得出來；這裡的截止是**畫面上荷官伸手的那一刻**，
     * 晚到的注若被收下，玩家會在影片裡看到自己押在一手已經開始發的牌上。
     */
    | { type: 'bet'; spot: BetSpot; amount: number };

export type BaccaratLiveS2C =
    | CommonS2C
    /** 桌況快照。只在 `sit` 之後送一次 */
    | { type: 'table'; snapshot: LiveSnapshot }
    /**
     * 階段換了。
     *
     * 跟數位桌台一樣帶**絕對時間戳**而不是「還剩幾秒」：分頁被切到背景時
     * `setTimeout` 會被節流到秒級甚至更久，client 靠每秒扣一的話切回來就停在錯的數字。
     *
     * 但這裡的 `endsAt` 還有第二層意義——它是**從視訊時間軸推出來的**，
     * 所以倒數歸零的那一刻，畫面上的荷官也正好把手伸向牌靴……**如果畫面沒有延遲的話。**
     * 延遲有多少，只有 client 知道（見 games/baccaratLive/index.ts 的延遲區）。
     */
    | { type: 'phase'; phase: LivePhase; endsAt: number; serverNow: number; round: number }
    /** 一張牌落桌了。**現在**落的，不是等一下要落的 */
    | { type: 'deal'; card: LiveDealt }
    /** 荷官把前四張攤開了 */
    | { type: 'reveal'; cards: LiveDealt[] }
    /**
     * 這一秒有哪些人押了什麼。下注階段每秒一則。
     *
     * `totals` 一起帶是刻意的**冗餘**：注區上的總額直接照它顯示，不要 client 自己
     * 把每一筆加起來。累加的版本只要漏收一則封包就會永遠偏掉，而且偏了不會有人發現。
     */
    | { type: 'bets'; bets: OtherBet[]; totals: Record<BetSpot, number> }
    /** 我自己的注被接受了。餘額在這裡才扣——server 說了算 */
    | { type: 'betOk'; myBets: Bets; totals: Record<BetSpot, number>; balance: number }
    /**
     * 結果與結算。牌都翻完之後才送。
     *
     * 數位桌台把開牌與結算拆成兩則，因為那邊的 client 收到 `deal` 之後還要花幾秒
     * 演發牌。這裡不必拆：**演出在影片裡已經播完了**，server 說結算的那一刻，
     * 畫面上的牌就是攤開的。
     */
    | {
          type: 'settle';
          round: Round;
          /** 路圖要接上的這一局 */
          road: RoadRound;
          /** 每個注區拿回多少（含本金）。0 = 全輸，見 rules.ts 的 settleBets */
          payouts: Record<BetSpot, number>;
          /** 這一局總共拿回多少。押注時已經扣款，所以這是**入帳額**不是淨輸贏 */
          totalReturn: number;
          balance: number;
          /** 桌上其他人的輸贏，用來演籌碼飛回誰面前 */
          seats: SeatResult[];
      }
    /** 有人坐下或離開。座位是位置不是身分，所以整份重送而不是送差異 */
    | { type: 'seats'; seats: SeatInfo[] };
