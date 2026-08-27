import type { Phase, RouletteC2S, RouletteS2C, RouletteBet, RouletteSnapshot, SpinOutcome } from '../net/games/roulette';
import type { SeatInfo } from '../net/games/baccarat';
import { parseBetKey, settleBets, totalStake, type BetKey, type Bets } from '../games/roulette/rules';
import { applyTotals, seatBets, onlineBets, spawnSeat, toSeatInfo, SEAT_COUNT, type CrowdSeat } from './rouletteCrowd';
import type { GameServer } from './gameServer';
import { Wallet, sessionWallet } from './wallet';

/**
 * 「伺服器」端的輪盤：跟百家樂一樣是**一張自己一直在跑的桌子**。
 *
 * 骨架刻意跟 baccaratServer 一致（setTimeout 鏈的時鐘、可被中途加入的快照、
 * 假玩家與散客），差別只在這張桌子的結果是**一個號碼**。
 *
 * 那一個號碼帶來一件百家樂沒有的事：**結果在球停下來之前十秒就已經定案並送出去了**。
 * 這正是「輸贏由 server 決定」最極端的展示——client 手上握著答案，卻只能照著把它演完。
 * 反過來說，這也是為什麼下注階段一結束就不能再收注：`spin` 封包一旦送出，
 * 誰都不能再改變任何事。
 *
 * 開獎用的亂數就是 `Math.random`，沒有假裝成什麼可證明公平的東西。真實平台這裡是
 * 一台通過認證的 RNG 或一顆真的球，而**那是這個 demo 唯一不打算模擬的部分**——
 * 值得展示的是資料流與呈現，不是自己搓一個沒人該相信的亂數源。
 */

/**
 * 每個階段各多久（毫秒）。
 *
 * `spinning` 的 12 秒裡有 10 秒是球真的在跑（見 SPIN_SECONDS），剩下兩秒是球落袋後
 * 停在那裡讓人看清楚開了什麼。這是這套設計裡唯一一處 server 遷就 client 演出時間的
 * 地方，所以它值得被寫成常數並註明理由。
 */
const PHASE_MS: Record<Phase, number> = {
    betting: 18000,
    spinning: 12000,
    result: 6000,
};

/** 球在畫面上跑多久（秒）。比 `spinning` 短，落袋後要留時間讓玩家看清楚號碼 */
const SPIN_SECONDS = 10;

const BET_TICK_MS = 1000;
const SEAT_CHURN = 0.22;

/** 歷史看板留幾局。夠算冷熱又不會讓快照肥起來 */
const HISTORY_MAX = 40;

export class RouletteServer implements GameServer<RouletteC2S, RouletteS2C> {
    public readonly id = 'roulette' as const;

    private readonly wallet: Wallet;
    private readonly random: () => number;
    private readonly listeners = new Set<(packet: RouletteS2C) => void>();

    private phase: Phase = 'betting';
    private endsAt = 0;
    private roundNo = 0;

    private totals: Bets = {};
    private myBets: Bets = {};
    /**
     * 訪客這一局下注的**順序**。`undo` 要靠它知道最後一筆是哪一注。
     *
     * 記順序而不是只記金額，是因為同一個位置可以押好幾次——收回的應該是最後那一次
     * 押上去的那幾百塊，不是把那一格整疊拿回來。
     */
    private myOrder: Array<{ key: BetKey; amount: number }> = [];
    private crowdBets: Bets = {};

    private seats: Array<CrowdSeat | null> = [];
    private history: number[] = [];

    /** 這一趟的結果。進 spinning 時定案，結算時要用 */
    private spin: SpinOutcome | null = null;
    /** 球從什麼時候開始跑。中途加入的人要靠它把球接在正確的位置 */
    private spinStartedAt = 0;

    private timer: ReturnType<typeof setTimeout> | null = null;
    private betTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(wallet: Wallet = new Wallet(), random: () => number = Math.random) {
        this.wallet = wallet;
        this.random = random;

        for (let i = 0; i < SEAT_COUNT; i++) this.seats.push(spawnSeat(i, random));
        this.enterBetting();
    }

    public getBalance(): number {
        return this.wallet.get();
    }

    // ---- 連線 ----

    public attach(emit: (packet: RouletteS2C) => void): void {
        this.listeners.add(emit);
    }

    public detach(emit: (packet: RouletteS2C) => void): void {
        this.listeners.delete(emit);
    }

    public handle(packet: RouletteC2S): RouletteS2C | null {
        switch (packet.type) {
            case 'sit':
                return { type: 'table', snapshot: this.snapshot() };

            case 'bet':
                return this.bet(packet.key, packet.amount);

            case 'undo':
                return this.undo();

            default:
                return null;
        }
    }

    public shutdown(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        if (this.betTimer !== null) clearTimeout(this.betTimer);
        this.timer = null;
        this.betTimer = null;
        this.listeners.clear();
    }

    // ---- 玩家下注 ----

    /**
     * 押一注。
     *
     * `parseBetKey` 是這一層唯一的入口驗證，而它擋的不只是打錯字：桌布上不存在的
     * 分注（`split:3-4`）在格式上完全正確，但那條線根本沒有——放它進來的話，
     * 玩家會押到一個永遠不可能中的位置。
     */
    private bet(key: BetKey, amount: number): RouletteS2C {
        if (this.phase !== 'betting') return { type: 'error', reason: 'bet_closed' };
        if (!parseBetKey(key)) return { type: 'error', reason: 'invalid_bet' };
        if (!Number.isFinite(amount) || amount <= 0) return { type: 'error', reason: 'invalid_bet' };
        if (!this.wallet.debit(amount)) return { type: 'error', reason: 'insufficient_balance' };

        this.myBets[key] = (this.myBets[key] ?? 0) + amount;
        this.totals[key] = (this.totals[key] ?? 0) + amount;
        this.myOrder.push({ key, amount });

        return this.betOk();
    }

    /**
     * 收回最後一筆注。
     *
     * 百家樂沒有這個功能，輪盤有——差別在**注的顆粒度**。百家樂一局最多押五個注區，
     * 押錯了再押一次就好；輪盤一局可能點二十幾個位置，而且相鄰位置只差幾個像素，
     * 點錯格子是常態而不是意外。沒有 undo 的話，玩家對付誤觸的唯一辦法是認賠。
     */
    private undo(): RouletteS2C {
        if (this.phase !== 'betting') return { type: 'error', reason: 'bet_closed' };

        const last = this.myOrder.pop();
        if (!last) return { type: 'error', reason: 'nothing_to_undo' };

        this.myBets[last.key] -= last.amount;
        if (this.myBets[last.key] <= 0) delete this.myBets[last.key];
        this.totals[last.key] -= last.amount;
        if (this.totals[last.key] <= 0) delete this.totals[last.key];

        this.wallet.credit(last.amount);
        return this.betOk();
    }

    private betOk(): RouletteS2C {
        return {
            type: 'betOk',
            myBets: { ...this.myBets },
            totals: { ...this.totals },
            balance: this.wallet.get(),
        };
    }

    // ---- 一局的生命週期 ----

    private enterBetting(): void {
        this.roundNo++;
        this.totals = {};
        this.myBets = {};
        this.myOrder = [];
        this.crowdBets = {};
        this.spin = null;

        let seatsChanged = false;
        for (let i = 0; i < this.seats.length; i++) {
            const seat = this.seats[i];
            if (seat) {
                seat.bets = {};
                seat.staying--;
                if (seat.staying <= 0) {
                    this.seats[i] = null;
                    seatsChanged = true;
                }
            } else if (this.random() < SEAT_CHURN) {
                this.seats[i] = spawnSeat(i, this.random);
                seatsChanged = true;
            }
        }
        if (seatsChanged) this.emit({ type: 'seats', seats: this.seatInfos() });

        this.enter('betting', () => this.enterSpinning());
        this.scheduleBetTick();
    }

    /**
     * 開球：**這一刻結果就定了**，而畫面上還要再跑十秒。
     *
     * 號碼與時長一起送出去，client 拿它反推球的軌跡（見 games/roulette/spin.ts）。
     * 送時長而不是讓 client 自己挑，是因為結算的時間是 server 排的——兩邊各自決定
     * 要跑多久的話，總有一天球還在半空中結算封包就到了。
     */
    private enterSpinning(): void {
        this.clearBetTick();

        const winning = Math.floor(this.random() * 37);
        this.spin = { winning, duration: SPIN_SECONDS };
        this.spinStartedAt = Date.now();

        this.enter('spinning', () => this.enterResult());
        this.emit({ type: 'spin', outcome: this.spin });
    }

    /**
     * 結算。
     *
     * 假玩家的輸贏**要真的算**：畫面上要演籌碼飛回誰面前，押紅的人在開黑號的局裡
     * 拿到錢，是那種一眼就看得出來的破綻。
     */
    private enterResult(): void {
        const spin = this.spin;
        if (!spin) return;

        const payouts = settleBets(this.myBets, spin.winning);
        const totalReturn = Object.values(payouts).reduce((sum, v) => sum + v, 0);
        this.wallet.credit(totalReturn);

        for (const seat of this.seats) {
            if (!seat) continue;
            const out = settleBets(seat.bets, spin.winning);
            seat.balance += Object.values(out).reduce((sum, v) => sum + v, 0);
        }

        this.history.unshift(spin.winning);
        if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;

        this.enter('result', () => this.enterBetting());
        this.emit({
            type: 'settle',
            winning: spin.winning,
            payouts,
            totalReturn,
            balance: this.wallet.get(),
            history: [...this.history],
        });
    }

    // ---- 時鐘 ----

    /** 跟百家樂同一套 `setTimeout` 鏈，理由也一樣（見 baccaratServer.enter） */
    private enter(phase: Phase, next: () => void): void {
        this.phase = phase;
        this.endsAt = Date.now() + PHASE_MS[phase];

        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            next();
        }, PHASE_MS[phase]);

        this.emit({ type: 'phase', phase, endsAt: this.endsAt, serverNow: Date.now(), round: this.roundNo });
    }

    private scheduleBetTick(): void {
        this.betTimer = setTimeout(() => {
            if (this.phase !== 'betting') return;

            const left = this.endsAt - Date.now();
            const progress = 1 - Math.max(0, left) / PHASE_MS.betting;
            const heat = progress < 0.15 ? 0.2 : progress > 0.78 ? 1 : 0.35 + progress * 0.55;

            const crowd = onlineBets(heat, this.random);
            applyTotals(this.crowdBets, crowd);

            const batch = [...seatBets(this.seats.filter(isSeat), this.random), ...crowd];
            applyTotals(this.totals, batch);
            if (batch.length > 0) this.emit({ type: 'bets', bets: batch, totals: { ...this.totals } });

            this.scheduleBetTick();
        }, BET_TICK_MS);
    }

    private clearBetTick(): void {
        if (this.betTimer !== null) clearTimeout(this.betTimer);
        this.betTimer = null;
    }

    // ---- 對外 ----

    private snapshot(): RouletteSnapshot {
        const snapshot: RouletteSnapshot = {
            phase: this.phase,
            endsAt: this.endsAt,
            serverNow: Date.now(),
            round: this.roundNo,
            history: [...this.history],
            seats: this.seatInfos(),
            totals: { ...this.totals },
            myBets: { ...this.myBets },
        };

        // 正在轉的話，把球已經跑了多久一起給——中途進來的人才接得上這一趟
        if (this.phase === 'spinning' && this.spin) {
            snapshot.spin = { ...this.spin, elapsed: (Date.now() - this.spinStartedAt) / 1000 };
        }
        return snapshot;
    }

    private seatInfos(): SeatInfo[] {
        return this.seats.filter(isSeat).map(toSeatInfo);
    }

    private emit(packet: RouletteS2C): void {
        for (const listener of this.listeners) listener(packet);
    }

    /** 訪客這一局押了多少。限紅與「重複上一局」之後會用到 */
    public myStake(): number {
        return totalStake(this.myBets);
    }
}

function isSeat(seat: CrowdSeat | null): seat is CrowdSeat {
    return seat !== null;
}

/**
 * 整個遊樂場共用的那一張輪盤桌。理由同 `baccaratTable`：
 * **活得比任何一條連線久的東西，就不該由連線持有。**
 */
export const rouletteTable = new RouletteServer(sessionWallet);
