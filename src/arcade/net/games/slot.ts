import type { CommonC2S, CommonS2C } from '../protocol';

/**
 * 老虎機的封包定義。
 *
 * 跟共用協定（../protocol.ts）拼起來才是這款玩法完整的收發範圍——
 * 老虎機的 socket 認得 `SlotC2S`／`SlotS2C`，看不到百家樂的任何欄位。
 */

/** 一條中獎線的結算明細 */
export interface WinLine {
    /** 中的是第幾條賠付線（索引到 PAYLINES） */
    line: number;
    /** 中的符號 id */
    symbol: number;
    /** 從最左邊算起連了幾格 */
    count: number;
    /** 這條線賠多少 */
    amount: number;
}

export type SlotC2S = CommonC2S | { type: 'spin'; bet: number };

export type SlotS2C =
    | CommonS2C
    | {
          type: 'spinResult';
          /**
           * 盤面：`grid[reel][row]` = 符號 id。
           *
           * **這是轉軸唯一的真相來源**——client 收到它才知道要停在哪，
           * 不是轉完了才回頭問結果。
           */
          grid: number[][];
          wins: WinLine[];
          totalWin: number;
          /** 結算後的餘額。不讓 client 自己加減，避免兩邊算出不同的數 */
          balance: number;
      };
