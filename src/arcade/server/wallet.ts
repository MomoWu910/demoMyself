/**
 * 錢包：**餘額屬於帳號，不屬於桌台**。
 *
 * 這件事在只有一款玩法時看不出來——老虎機自己記著餘額也能跑。但遊樂場一旦能切玩法，
 * 「餘額歸誰管」就變成第一個會出事的地方：如果每個玩法 server 各存一份，玩家從老虎機
 * 贏了錢走去百家樂桌，錢會憑空消失（或憑空長回開場值）。這不是 demo 才有的問題，
 * 真實平台的錢包本來就是獨立服務，桌台只是向它請款與入帳。
 *
 * 所以扣款與入帳都只有這裡一個入口，玩法 server 拿到的是這個物件而不是一個數字——
 * 拿數字的話它就會忍不住自己加減，然後兩邊算出不同的餘額。
 */

/** 開場餘額。純 demo 數字。 */
export const START_BALANCE = 10000;

export class Wallet {
    private balance: number;

    constructor(initial = START_BALANCE) {
        this.balance = initial;
    }

    public get(): number {
        return this.balance;
    }

    /**
     * 請款。餘額不足時**不扣款也不丟例外**，回 false 讓呼叫端決定怎麼回覆玩家——
     * 「錢不夠」是預期中的常態，不是錯誤狀況。
     */
    public debit(amount: number): boolean {
        if (!Number.isFinite(amount) || amount <= 0) return false;
        if (amount > this.balance) return false;
        this.balance -= amount;
        return true;
    }

    /** 入帳。0 也接受（沒中獎照樣走這條路，呼叫端就不必分支）。 */
    public credit(amount: number): void {
        if (!Number.isFinite(amount) || amount < 0) return;
        this.balance += amount;
    }
}

/**
 * 整個遊樂場共用的那一個錢包——相當於「登入中的這個帳號」。
 *
 * 玩法 server 預設會**各自 new 一個**（見 GameServer 的建構子），只有 net/fakeSocket.ts
 * 建線時才把這一個傳進去。這個預設值是刻意的：驗證腳本（rtp-check.mjs）需要每個
 * server 實例有獨立餘額才不會互相汙染，而正式流程需要它們共用。
 */
export const sessionWallet = new Wallet();
