import type { CommonC2S, CommonS2C } from '../protocol';
import type { ChipValue } from '../../common/chips/atlas';
import type { BetKey, Bets } from '../../games/roulette/rules';
import type { SeatInfo } from './baccarat';

/**
 * 輪盤的封包定義。
 *
 * 跟百家樂一樣是**多人桌台**（桌子自己一局一局跑、玩家中途走過來），所以封包的骨架
 * 幾乎一樣：階段推播、快照、別人的注、結算。這是刻意的——同一套心智模型套第二次，
 * 才證明得了那個模型是對的而不是硬湊出來的。
 *
 * 真正不同的只有一處，也正是這一款的重點：**開獎結果是一個號碼，不是一手牌**，
 * 而那個號碼要被翻譯成一段長達十秒的球軌跡。所以 `spin` 封包送的是
 * 「中獎號碼 ＋ 這一趟要跑多久」，剩下的（球繞幾圈、從哪個角度出發）由 client 自己決定——
 * 那些純粹是手感，不影響任何一分錢。
 */

/**
 * 一局的階段。
 *
 * 只有三段，比百家樂少了換靴——輪盤沒有牌靴，每一局都是獨立事件。這件事在畫面上
 * 也要看得出來：路圖那種「這一靴走到哪裡」的敘事在這裡不成立，所以歷史看板呈現的是
 * 統計而不是走勢（見 games/roulette/history.ts）。
 */
export type Phase = 'betting' | 'spinning' | 'result';

/** 座位型別跟百家樂共用：**桌上的人長什麼樣子跟玩什麼無關** */
export type { SeatInfo } from './baccarat';
export { ONLINE_SEAT } from './baccarat';

/**
 * 一筆別人的下注。
 *
 * 跟百家樂那支 `OtherBet` 的差別只在 `key`：那邊是五選一的注區，這邊是桌布上
 * 一百多種位置中的一個。送**顆數**而不是金額的理由完全一樣——畫面上要飛的是
 * 一顆一顆的籌碼，金額乘得出來但顆數反推不回去。
 */
export interface RouletteBet {
    seat: number;
    key: BetKey;
    chip: ChipValue;
    count: number;
}

/** 這一局的結果。歷史看板與「上一局開什麼」都吃它 */
export interface SpinOutcome {
    winning: number;
    /** 這一趟球要跑多久（秒）。client 照它排動畫，結算才不會比球先停 */
    duration: number;
}

/** 中途加入的人要看的東西：桌子現在正在做什麼 */
export interface RouletteSnapshot {
    phase: Phase;
    endsAt: number;
    serverNow: number;
    round: number;
    /** 最近開出的號碼，**新的在前**。看板與冷熱統計都吃這一份 */
    history: number[];
    seats: SeatInfo[];
    totals: Bets;
    myBets: Bets;
    /**
     * 如果正好在轉，這一趟的結果與**已經跑了多久**。
     *
     * 有了這兩個數字，中途進來的人可以直接把球接在正確的位置上繼續演，
     * 而不是看著一個靜止的輪盤等下一局——那是「桌子一直在跑」這個設定最容易破功的地方。
     */
    spin?: SpinOutcome & { elapsed: number };
}

export type RouletteC2S =
    | CommonC2S
    | { type: 'sit' }
    | { type: 'bet'; key: BetKey; amount: number };

export type RouletteS2C =
    | CommonS2C
    | { type: 'table'; snapshot: RouletteSnapshot }
    | { type: 'phase'; phase: Phase; endsAt: number; serverNow: number; round: number }
    | { type: 'seats'; seats: SeatInfo[] }
    | { type: 'bets'; bets: RouletteBet[]; totals: Bets }
    | { type: 'betOk'; myBets: Bets; totals: Bets; balance: number }
    /** 球開始跑。**這是唯一帶著結果的封包**，而它在球停下來之前十秒就送到了 */
    | { type: 'spin'; outcome: SpinOutcome }
    | {
          type: 'settle';
          winning: number;
          /** 每一注回本多少（含本金）。沒中的注不會出現在裡面 */
          payouts: Bets;
          totalReturn: number;
          balance: number;
          history: number[];
      };
