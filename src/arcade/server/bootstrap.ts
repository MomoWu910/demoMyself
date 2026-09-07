import * as auditLog from './auditLog';
import * as ledger from './ledger';
import * as players from './players';
import * as txLedger from './txLedger';

/**
 * 把四張表從持久層灌進記憶體。**每個進入點都要 await 它一次。**
 *
 * ---
 *
 * **不呼叫會怎樣：遊戲端的第一次下注會清空整張注單表。**
 *
 * 資料層的讀取是同步的（從記憶體快取），而快取在 `init()` 之前是空的。
 * 於是 `record()` 做的事變成「拿空陣列接上這一筆，然後整張表寫回去」——
 * 一萬多筆歷史注單就這樣被一筆新注單取代了。
 *
 * 這個坑在 localStorage 時代不存在（那時候 `load()` 是同步讀磁碟，
 * 什麼時候呼叫都拿得到完整資料），**是換成非同步持久層之後新長出來的**。
 * 所以它值得一支專門的函式加這一段註解，而不是讓每個進入點自己記得要做。
 *
 * 兩個進入點都要：後台（admin/index.tsx）與遊樂場（arcade/index.tsx）。
 * 遊樂場那邊尤其重要——它是**會寫入**的那一端。
 */
export async function bootstrapServerData(): Promise<void> {
    // 四張表互不相干，可以同時讀
    await Promise.all([
        ledger.init(),
        txLedger.init(),
        players.init(),
        auditLog.init(),
    ]);
}
