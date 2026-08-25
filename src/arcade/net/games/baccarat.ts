import type { CommonC2S, CommonS2C } from '../protocol';
import type { ChipValue } from '../../common/chips/atlas';
import type { BetSpot, Bets, Round } from '../../games/baccarat/rules';
import type { RoadRound } from '../../games/baccarat/roadmap';

/**
 * 百家樂的封包定義。
 *
 * 型別是從規則檔借來的（`Round`、`Bets`），不是在這裡重新宣告一份——牌的形狀
 * 若兩邊各寫一次，改動時漏掉一邊就會變成「編譯過了但欄位對不上」，那是最難查的一種錯。
 * 借的都是 type-only import，不會產生執行期相依。
 *
 * ---
 *
 * 這一款是**多人桌台**：桌子自己一局一局往下跑，玩家只是中途走過來坐下。所以封包的
 * 形狀跟老虎機那種「按一下、回一次」完全不同，大部分是 server 主動推的
 * （見 server/gameServer.ts 的 attach）。
 */

/** 牌靴狀態。玩家看得到還剩多少張，是真實桌台會顯示的資訊。 */
export interface ShoeInfo {
    remaining: number;
    total: number;
}

/**
 * 一局的階段。
 *
 * 對照的是前公司那套 `ROOM_STATUS`（IDLE / BET / OPEN / RESULT / SHUFFLE / MAINTAIN）——
 * 這裡只留真的會發生的四段：維護與閒置在 demo 裡沒有對應的情境，留著只是死碼。
 *
 * `shuffle` 只在換靴那一局之後出現，它是**唯一會被跳過的階段**。留著它而不是把清路圖
 * 塞進 `result` 的尾巴，是因為換靴時整片路圖會清空——那是畫面上最大的一次變動，
 * 需要一段自己的時間讓玩家看懂發生了什麼，而不是在結算的最後 0.2 秒突然全空。
 */
export type Phase = 'betting' | 'dealing' | 'result' | 'shuffle';

/**
 * 桌上一個座位。
 *
 * `seat` 是**位置**不是身分：同一張椅子這一局是 A 在坐，下一局可能換成 B。畫面上的
 * 頭像位置由它決定，所以它得是穩定的小整數而不是玩家 id。
 */
export interface SeatInfo {
    seat: number;
    name: string;
    /** 頭像顏色。Pixi 直接吃十六進位，不必再從 CSS 字串轉一次 */
    tint: number;
    balance: number;
}

/**
 * 「線上散客」的座位編號。
 *
 * 真實桌台上大部分的注不是來自看得到的那幾張椅子，而是同時在線的幾百個人。他們沒有
 * 座位，籌碼就從畫面邊緣飛進來。前公司那套用的是同一個手法（`SEAT_INDEX.ON_LINE`，
 * 起點取 `getOnlineBetPos()`）——**沒有這一群人，桌子會冷清得不像在營業**。
 */
export const ONLINE_SEAT = -1;

/**
 * 一筆別人的下注：誰、押哪、什麼面額、幾顆。
 *
 * 送的是**顆數**而不是金額，因為畫面上要飛的是一顆一顆的籌碼。金額 client 自己乘得出來，
 * 但顆數反推不回去（3000 可以是三顆 1000 也可以是六顆 500，飛起來完全不一樣）。
 *
 * 顆數**不在 server 端設上限**：server 說的是事實，畫面上要飛幾顆是 client 的事
 * （見 games/baccarat/index.ts 的 CHIP_BUDGET）。這個分工很重要——把上限做進 server，
 * 帳目就會跟著畫面一起被砍掉。
 */
export interface OtherBet {
    seat: number;
    spot: BetSpot;
    chip: ChipValue;
    count: number;
}

/** 結算後某個座位的輸贏，用來演「籌碼飛回誰面前」。 */
export interface SeatResult {
    seat: number;
    /** 淨輸贏。正數才有籌碼飛回去 */
    delta: number;
    balance: number;
}

/** 進桌時拿到的完整桌況。中途坐下來要能立刻對齊，靠的就是這一包。 */
export interface TableSnapshot {
    phase: Phase;
    /** 這個階段什麼時候結束（絕對時間戳，毫秒）。見下面 `phase` 封包的說明 */
    endsAt: number;
    /**
     * server 現在幾點。
     *
     * client 用 `serverNow - Date.now()` 算出時差，之後所有 `endsAt` 都先補這個差值。
     * 我們的 server 就住在同一個分頁裡，這個差值必定是 0——留著它是因為**換成真後端時
     * 這裡是唯一要改的地方**，而不是到時候才發現倒數全部差三秒。
     */
    serverNow: number;
    /** 這是這一靴的第幾局。client 用它判斷自己是不是漏接了整局 */
    round: number;
    history: RoadRound[];
    shoe: ShoeInfo;
    seats: SeatInfo[];
    /** 各注區目前的總押注（含所有人） */
    totals: Record<BetSpot, number>;
    /** 我自己這一局押了多少 */
    myBets: Bets;
    /** 正在開牌或剛結算完的話，牌在這裡。中途進桌要看得到桌上已經翻開的牌 */
    openRound?: Round;
}

export type BaccaratC2S =
    | CommonC2S
    /** 進桌：要一份桌況快照 */
    | { type: 'sit' }
    /**
     * 押一注。**押出去就不能撤**，跟真實桌台一樣。
     *
     * 所以它是一顆一顆送的（點一次注區送一次），不是把整局的注攢起來最後一次送。
     * 攢起來送會多出一個「還沒送出的注」狀態，而那個狀態在倒數歸零的瞬間就會變成
     * 一個沒人想處理的問題：到底算不算數？
     */
    | { type: 'bet'; spot: BetSpot; amount: number };

export type BaccaratS2C =
    | CommonS2C
    /** 桌況快照。只在 `sit` 之後送一次 */
    | { type: 'table'; snapshot: TableSnapshot }
    /**
     * 階段換了。
     *
     * 帶的是 **`endsAt` 絕對時間戳而不是「還剩幾秒」**。這不是為了省封包，是因為
     * 分頁被切到背景時瀏覽器會把 `setTimeout` 節流到一秒甚至更久——client 若靠
     * 「每秒扣一」累計，切回來就會停在錯的數字；用時間戳則一回來就自動對齊。
     * 真後端也是這樣給的：server 給的是截止時刻，不是碼表。
     */
    | { type: 'phase'; phase: Phase; endsAt: number; serverNow: number; round: number }
    /**
     * 這一秒有哪些人押了什麼。下注階段每秒一則。
     *
     * `totals` 一起帶是刻意的**冗餘**：注區上的總額直接照它顯示，不要 client 自己
     * 把每一筆加起來。累加的版本只要漏收一則封包就會永遠偏掉，而且偏了不會有人發現——
     * 每次推播都帶一份權威值，就沒有「累積誤差」這種東西。
     */
    | { type: 'bets'; bets: OtherBet[]; totals: Record<BetSpot, number> }
    /** 我自己的注被接受了。餘額在這裡才扣——server 說了算 */
    | { type: 'betOk'; myBets: Bets; totals: Record<BetSpot, number>; balance: number }
    /** 開牌。整局的牌一次給完，client 照著演發牌與翻牌 */
    | { type: 'deal'; round: Round }
    /**
     * 結算。
     *
     * 跟 `deal` 分成兩則而不是合成一則，是因為它們在時間軸上差了好幾秒——牌要一張一張
     * 翻完才輪到算錢。合成一則的話 client 就得自己抓著結算資料等演出結束，那份資料
     * 在等待期間是「已經知道但不能用」的狀態，是最容易被誤用的一種資料。
     */
    | {
          type: 'settle';
          /** 每個注區拿回多少（含本金）。0 = 全輸，見 rules.ts 的 settleBets */
          payouts: Record<BetSpot, number>;
          /** 這一局總共拿回多少。押注時已經扣款，所以這是**入帳額**不是淨輸贏 */
          totalReturn: number;
          balance: number;
          shoe: ShoeInfo;
          /** 路圖要接上的這一局 */
          road: RoadRound;
          /** 桌上其他人的輸贏，用來演籌碼回收 */
          seats: SeatResult[];
          /**
           * 這一局打完之後換了新靴。
           *
           * 換靴要**清掉路圖**——路是「這一靴」的歷史，跨靴接下去是沒有意義的。
           * 用旗標而不是讓 client 自己從 `shoe.remaining` 變大推斷：推斷得對的前提是
           * client 記得上一局的值，漏收一個封包就會靜默地把兩靴接在一起。
           */
          shoeChanged: boolean;
      }
    /** 有人坐下或離開。座位是位置不是身分，所以整份重送而不是送差異 */
    | { type: 'seats'; seats: SeatInfo[] };
