import type { GameId } from '../net/protocol';

/**
 * 後台與遊戲之間那條廣播頻道的**名字與訊息型別**，單獨放一個檔。
 *
 * ---
 *
 * **為什麼要抽出來：解開一個相依循環。**
 *
 * 這個常數原本住在 `ledger.ts`，其他三張表（金流、玩家、稽核）都從那裡匯入。
 * 一開始沒問題，直到注單需要「作廢」這個功能——
 * 作廢一筆注單要同時做兩件事：把注單標成無效，以及**開一筆沖正交易把錢調回去**。
 * 於是 `ledger` 得匯入 `txLedger`，而 `txLedger` 早就匯入了 `ledger`。
 *
 * 循環匯入在打包器底下不會直接報錯，它的症狀更難查：
 * 其中一邊會在模組初始化的瞬間拿到 `undefined`，
 * 而那個 undefined 要等到執行時才炸，堆疊指向的還是不相干的地方。
 *
 * 解法不是把功能搬來搬去，是把**兩邊都依賴的那一小塊**抽出來自己站著。
 * 這個檔沒有任何 import（除了型別），所以它永遠是相依圖的葉節點。
 */

/** 跨分頁廣播用的頻道名。後台跟遊戲是兩個分頁，靠這個互相通知 */
export const OPS_CHANNEL = 'arcade:ops';

/**
 * 這條頻道上會出現的所有訊息。
 *
 * **這個聯合型別是完整清單**——每張表新增一種廣播都要列在這裡。
 * 少列一種，下一個人就會以為自己可以安全地 switch 到 default。
 */
export type OpsMessage =
    /** 注單寫入。`rows` 只帶新增的那幾筆，收到的一端要作廢自己的快取 */
    | { kind: 'bets'; rows: unknown[] }
    /** 注單被作廢。爭議單處理會發這個 */
    | { kind: 'bets.void'; id: string }
    /** 營運設定變更（上下架、維護、限紅） */
    | { kind: 'config' }
    /** 玩家名冊變更（停用、標記、改等級）。遊戲端靠它知道自己的帳號被停用了 */
    | { kind: 'players' }
    /** 資金流水變更 */
    | { kind: 'tx' }
    /** 操作稽核新增 */
    | { kind: 'audit' }
    /** 後台切換了角色。開著兩個後台分頁時，兩邊的權限要一致 */
    | { kind: 'role' }
    /** 資料被清空 */
    | { kind: 'cleared' };

/** 玩法的顯示名。寫進稽核紀錄用的那一份，見 auditLog 檔頭 */
export const AUDIT_GAME_LABEL: Record<GameId, string> = {
    slot: '幸運轉輪',
    baccarat: '百家樂',
    baccaratLive: '視訊百家樂',
    roulette: '輪盤',
};
