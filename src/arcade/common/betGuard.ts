import { arcadeState } from '../store';

/**
 * 送出下注之前的本地檢查。
 *
 * ---
 *
 * **這不是在替代 server 的檢查，是在替代那趟白跑的 RTT。**
 *
 * server 端的 `checkBet()` 一行都不會拿掉——**前端擋是體驗，後端擋才是規則**。
 * 前端這一層存在的理由是下注動畫**樂觀播放**：籌碼先飛、數字等 server
 * （見 games/baccarat/index.ts 的 sendBet）。所以 server 打回來的時候，
 * 籌碼已經飛出去了，玩家看到的是「籌碼飛過去，然後跳一個紅字說超過限紅」。
 *
 * 這個 bug 是真的被回報的。原本前端只擋餘額不足，沒有擋限紅——
 * 而餘額那一條之所以早就有，是因為它一直都在 store 裡；
 * **限紅在後台做出來之後，沒有人回頭把它接進這個判斷。**
 *
 * ---
 *
 * 回傳錯誤代碼而不是布林值，理由同 `opsConfig.checkBet()`：
 * 玩家要知道是為什麼被擋的，而「餘額不足」與「超過限紅」對他來說是兩件事。
 * 代碼與 server 端用的是同一組（見 i18n 的 `arcade.error.*`），
 * 所以不管是哪一層擋下來的，玩家看到的句子都一樣。
 */
export function checkLocalBet(amount: number): string | null {
    const { balance, limits } = arcadeState();

    // 餘額先於限紅：錢不夠的時候，告訴他「超過限紅」是答非所問
    if (amount > balance) return 'insufficient_balance';
    if (amount < limits.minBet) return 'below_min_bet';
    if (amount > limits.maxBet) return 'above_max_bet';
    return null;
}
