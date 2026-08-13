import { REELS, ROWS, type WinLine } from '../net/protocol';
import { canSubstitute, LINE_COUNT, PAYLINES, PAYOUTS, Sym, SYMBOLS, WEIGHTS } from '../games/slot/rules';

/**
 * 「伺服器」端的老虎機邏輯：抽盤面、算賠付、記餘額。
 *
 * 它跑在瀏覽器裡，但**被當成遠端**看待——只有 net/fakeSocket.ts 能碰它，
 * 前端的任何一支渲染程式都拿不到它的參考。這個界線是刻意畫的：一旦前端能直接呼叫
 * `spin()`，就會忍不住「先算結果再決定怎麼轉」，那正是真實專案裡最該避免的耦合。
 *
 * 隔著 socket，前端就只剩一條路可走：**等封包、照著演**。
 */

/** 開場餘額。純 demo 數字。 */
const START_BALANCE = 10000;

export class SlotServer {
    private balance = START_BALANCE;

    /** 權重表攤平成一支抽籤陣列，抽一次是 O(1)，不必每次累加權重 */
    private readonly bag: Sym[];

    constructor() {
        this.bag = [];
        for (const s of SYMBOLS) {
            for (let i = 0; i < WEIGHTS[s]; i++) this.bag.push(s);
        }
    }

    public getBalance(): number {
        return this.balance;
    }

    /**
     * 轉一次。回傳盤面、中獎明細與結算後餘額。
     *
     * 餘額由這裡算完給出，前端不自己加減——兩邊各算一次的話，
     * 只要有一次動畫被中斷或封包重送，畫面上的錢就跟帳上的對不起來。
     */
    public spin(bet: number): { grid: number[][]; wins: WinLine[]; totalWin: number; balance: number } | { error: string } {
        if (!Number.isFinite(bet) || bet <= 0) return { error: 'invalid_bet' };
        if (bet > this.balance) return { error: 'insufficient_balance' };

        this.balance -= bet;

        const grid = this.rollGrid();
        const wins = this.evaluate(grid, bet / LINE_COUNT);
        const totalWin = wins.reduce((sum, w) => sum + w.amount, 0);

        this.balance += totalWin;
        return { grid, wins, totalWin, balance: this.balance };
    }

    /** 每一格獨立抽。真的機台是每軸一條環狀帶，這裡簡化成獨立抽樣，期望值的形狀一樣。 */
    private rollGrid(): number[][] {
        const grid: number[][] = [];
        for (let r = 0; r < REELS; r++) {
            const col: number[] = [];
            for (let row = 0; row < ROWS; row++) {
                col.push(this.bag[(Math.random() * this.bag.length) | 0]);
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
