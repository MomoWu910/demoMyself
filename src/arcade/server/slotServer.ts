import type { SlotC2S, SlotS2C, WinLine } from '../net/games/slot';
import type { GameServer } from './gameServer';
import { Wallet } from './wallet';
import { canSubstitute, LINE_COUNT, PAYLINES, PAYOUTS, REELS, ROWS, Sym, SYMBOLS, WEIGHTS } from '../games/slot/rules';
import { newRoundId, PLAYER_ID, record } from './ledger';
import { checkBet } from './opsConfig';

/**
 * 「伺服器」端的老虎機邏輯：抽盤面、算賠付、記餘額。
 *
 * 它跑在瀏覽器裡，但**被當成遠端**看待——只有 net/fakeSocket.ts 能碰它，
 * 前端的任何一支渲染程式都拿不到它的參考。這個界線是刻意畫的：一旦前端能直接呼叫
 * `spin()`，就會忍不住「先算結果再決定怎麼轉」，那正是真實專案裡最該避免的耦合。
 *
 * 隔著 socket，前端就只剩一條路可走：**等封包、照著演**。
 */

export class SlotServer implements GameServer<SlotC2S, SlotS2C> {
    public readonly id = 'slot' as const;

    /**
     * 錢包不是自己生的，是外面給的（見 server/wallet.ts）——餘額屬於帳號不屬於這張桌。
     *
     * 預設值 `new Wallet()` 是給驗證腳本用的：rtp-check.mjs 會開好幾個 server 實例
     * 各自試餘額邊界，共用錢包的話那些案例會互相汙染。正式流程由 fakeSocket 傳入共用的那一個。
     */
    private readonly wallet: Wallet;

    /** 權重表攤平成一支抽籤陣列，抽一次是 O(1)，不必每次累加權重 */
    private readonly bag: Sym[];

    /**
     * 亂數來源。預設是 `Math.random`，但可以換掉。
     *
     * 換掉的用途有兩個，都不是「為了測試而測試」：
     * 一是**基準線腳本要可重現**——後台的理論派彩率是跑百萬局算出來的，
     * 那個數字每跑一次就變的話，就沒有資格當基準（見 admin/rtp-baseline.mjs）。
     * 二是要重播某一局時，給同一個種子就會抽出同一個盤面。
     *
     * 這跟輪盤 server 的 `random` 是同一個做法。
     */
    private readonly random: () => number;

    constructor(wallet: Wallet = new Wallet(), random: () => number = Math.random) {
        this.wallet = wallet;
        this.random = random;
        this.bag = [];
        for (const s of SYMBOLS) {
            for (let i = 0; i < WEIGHTS[s]; i++) this.bag.push(s);
        }
    }

    public getBalance(): number {
        return this.wallet.get();
    }

    /**
     * 封包入口。握手由 fakeSocket 處理，這裡只認得老虎機自己的指令。
     *
     * **營運設定的檢查與注單的寫入都在這一層，不在 spin() 裡面。**
     * 這條線是刻意畫的：`spin()` 是這款遊戲的數學模型——抽盤面、判連線、算賠付，
     * 它應該只受規則表影響，驗證腳本（`yarn check:slot`）要能直接叫它跑一百萬次驗期望值。
     * 而限紅、維護模式、注單留存是**營運層**的事，屬於「這條連線現在允不允許下注」。
     *
     * 混在一起的代價很具體：限紅一調，數學驗證就跟著壞掉，
     * 而那支腳本正是用來證明賠率沒被改壞的東西。
     */
    public handle(packet: SlotC2S): SlotS2C | null {
        if (packet.type !== 'spin') return null;

        // 營運層的擋人。回代碼不回布林，玩家才知道是限紅擋的還是維護中
        const denied = checkBet(this.id, packet.bet);
        if (denied) return { type: 'error', reason: denied };

        // 餘額要在扣款前抓——注單上的 balanceBefore 是給對帳用的，
        // 事後從 balanceAfter 反推回去是不夠的（中間可能有別的入帳）
        const balanceBefore = this.wallet.get();
        const betAt = Date.now();

        const res = this.spin(packet.bet);
        if ('error' in res) return { type: 'error', reason: res.error };

        record([
            {
                roundId: newRoundId(this.id, betAt),
                game: this.id,
                player: PLAYER_ID,
                betType: 'spin',
                stake: packet.bet,
                // 老虎機沒有對沖的可能（只有一種押法），有效投注就等於下注額
                validStake: packet.bet,
                payout: res.totalWin,
                net: res.totalWin - packet.bet,
                balanceBefore,
                balanceAfter: res.balance,
                betAt,
                settledAt: Date.now(),
            },
        ]);

        return { type: 'spinResult', ...res };
    }

    /**
     * 轉一次。回傳盤面、中獎明細與結算後餘額。
     *
     * 餘額由這裡算完給出，前端不自己加減——兩邊各算一次的話，
     * 只要有一次動畫被中斷或封包重送，畫面上的錢就跟帳上的對不起來。
     */
    public spin(bet: number): { grid: number[][]; wins: WinLine[]; totalWin: number; balance: number } | { error: string } {
        if (!Number.isFinite(bet) || bet <= 0) return { error: 'invalid_bet' };
        // 請款與餘額檢查是同一個動作（見 Wallet.debit）——分成「先問夠不夠再扣」的兩步，
        // 中間就有一個窗口能讓另一筆請款插進來，兩把都通過檢查然後把餘額扣成負的
        if (!this.wallet.debit(bet)) return { error: 'insufficient_balance' };

        const grid = this.rollGrid();
        const wins = this.evaluate(grid, bet / LINE_COUNT);
        const totalWin = wins.reduce((sum, w) => sum + w.amount, 0);

        this.wallet.credit(totalWin);
        return { grid, wins, totalWin, balance: this.wallet.get() };
    }

    /** 每一格獨立抽。真的機台是每軸一條環狀帶，這裡簡化成獨立抽樣，期望值的形狀一樣。 */
    private rollGrid(): number[][] {
        const grid: number[][] = [];
        for (let r = 0; r < REELS; r++) {
            const col: number[] = [];
            for (let row = 0; row < ROWS; row++) {
                col.push(this.bag[(this.random() * this.bag.length) | 0]);
            }
            grid.push(col);
        }
        return grid;
    }

    /**
     * 逐線判定。
     *
     * 規則是老虎機的通例：**從最左軸起算連續相同**才算中，中斷就停。
     * 「從左起算」這件事讓判定必須是循序的——不能只數盤面上某個符號出現幾次，
     * 那會把散在各處的同符號誤判成一條線。
     *
     * Wild 的處理是這裡唯一繞的地方：一條線的「目標符號」要取**第一個非 Wild 的符號**，
     * 因為開頭連著幾個 Wild 時，那條線該算成後面那個符號的連線（賠得比較高的話），
     * 而不是算成 Wild 的連線。全 Wild 的線則照 Wild 自己賠。
     */
    private evaluate(grid: number[][], perLine: number): WinLine[] {
        const wins: WinLine[] = [];

        for (let line = 0; line < PAYLINES.length; line++) {
            const path = PAYLINES[line];
            const seq: Sym[] = [];
            for (let r = 0; r < REELS; r++) seq.push(grid[r][path[r]] as Sym);

            // 目標符號＝第一個不是 Wild 的；整條都是 Wild 就以 Wild 自己為目標
            let target: Sym | null = null;
            for (const s of seq) {
                if (s !== Sym.Wild) {
                    target = s;
                    break;
                }
            }
            if (target === null) target = Sym.Wild;

            // Scatter 不走連線賠付，跳過（它該看全盤總數，這個 demo 先不做免費遊戲）
            if (target === Sym.Scatter) continue;

            let count = 0;
            for (const s of seq) {
                const ok = s === target || (s === Sym.Wild && canSubstitute(target));
                if (!ok) break;
                count++;
            }

            const rate = PAYOUTS[target][count];
            if (count >= 3 && rate > 0) {
                wins.push({ line, symbol: target, count, amount: Math.round(rate * perLine) });
            }
        }

        return wins;
    }
}
