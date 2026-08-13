/**
 * 遊樂場的通訊協定。
 *
 * 這頁沒有真的後端，但**協定這一層是照真的做的**，因為博弈前端有一條鐵律：
 * **輸贏不能由 client 決定**。轉軸要停在哪、賠多少，全部是伺服器算完告訴你的，
 * client 只負責把已經確定的結果演得好看。
 *
 * 這條規則不只是合規要求，它會**倒過來決定前端怎麼寫**：
 * 轉軸不是「轉一轉隨機停」，而是「先收到目標格位，再把轉動演到那裡剛好停住」——
 * 兩者的實作差很多（見 games/slot/reel.ts 的 stopAt）。把假 server 做出來，
 * 就是為了讓這一頁的資料流跟真的一樣，而不是寫一個看起來像但骨子裡是本地亂數的東西。
 *
 * C2S = client to server，S2C = server to client。
 */

/** 客戶端送出的指令 */
export type C2S =
    | { type: 'hello' }
    | { type: 'spin'; bet: number };

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

/** 伺服器送回的封包 */
export type S2C =
    | { type: 'welcome'; balance: number }
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
      }
    | { type: 'error'; reason: string };

/** 盤面尺寸。5×3 是最經典的配置，賠付線的設計也跟著它走。 */
export const REELS = 5;
export const ROWS = 3;
