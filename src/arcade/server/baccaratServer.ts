import type { BaccaratC2S, BaccaratS2C, Phase, SeatInfo, SeatResult, TableSnapshot } from '../net/games/baccarat';
import { ONLINE_SEAT } from '../net/games/baccarat';
import { BET_SPOTS, settleBets, type BetSpot, type Bets, type Round } from '../games/baccarat/rules';
import { buildRecords, netExposureValidStake, type PendingBet } from './betSlip';
import { newRoundId, record } from './ledger';
import { checkBet } from './opsConfig';
import { BaccaratShoe } from './baccaratShoe';
import {
    applyTotals,
    emptyTotals,
    onlineBets,
    seatBets,
    spawnSeat,
    toSeatInfo,
    SEAT_COUNT,
    type CrowdSeat,
} from './baccaratCrowd';
import type { GameServer } from './gameServer';
import { Wallet, sessionWallet } from './wallet';

/**
 * 「伺服器」端的百家樂：**一張自己一直在跑的桌子**。
 *
 * 跟 slotServer 的定位差別，正是這一款要證明的事。老虎機是請求驅動的——你按一下，
 * 它算一次，沒人按就什麼都不會發生。這張桌子相反：**它不管有沒有人在看都一局一局
 * 往下跑**，玩家只是中途走過來坐下，看到的是這張桌子當下正好在做的事。
 *
 * 所以它多了老虎機沒有的三個責任：
 *
 * 1. **自己有時鐘**。階段轉換不是任何人按出來的，是時間到了就發生（見 schedule）。
 * 2. **要能被中途加入**。`sit` 回的是一份完整快照而不是「從頭開始」，因為桌子沒有頭。
 * 3. **要有別人**。桌上大部分的注來自假玩家與線上散客（見 baccaratCrowd.ts）——
 *    一張沒有別人的百家樂桌看起來像壞掉了。
 *
 * ---
 *
 * **跟真後端唯一對不上的地方**，寫在這裡而不是假裝沒有：這個 server 就住在同一個
 * 瀏覽器分頁裡，所以分頁被切到背景時它會跟著被節流，甚至整個睡著。醒來時它會對齊
 * `endsAt` 立刻推進到當下該在的階段，但**不會補跑錯過的那幾局**——真的後端在你關著
 * 分頁的那五分鐘裡會照樣打完十幾局，這裡不會。
 *
 * 這件事無法在純前端的 demo 裡修掉（Web Worker 也一樣被節流），所以把它標出來，
 * 而不是讓人以為這裡完全等價於一個真的桌台服務。
 */

/**
 * 每個階段各多久（毫秒）。
 *
 * `dealing` 的 7 秒不是隨便給的：client 那側把一局演完（發四張、翻閒、翻莊、補牌）
 * 大約 6 秒（見 games/baccarat/index.ts 的 playRound），留一秒緩衝。**這個數字是
 * 這套設計裡唯一一處 server 遷就 client 演出時間的地方**，所以它值得被寫成常數並
 * 註明理由——不然哪天有人把翻牌動畫改慢，結果會是結算封包比牌先到。
 *
 * `shuffle` 只在換靴的那一局之後才會排進來。
 */
const PHASE_MS: Record<Phase, number> = {
    betting: 15000,
    dealing: 7000,
    result: 4000,
    shuffle: 3000,
};

/** 下注階段每隔多久推一批別人的注。一秒是實測看起來最像真桌的密度 */
const BET_TICK_MS = 1000;

/** 每局換掉幾張椅子的機率。太高會讓人覺得沒人待得住，太低就露餡 */
const SEAT_CHURN = 0.22;

export class BaccaratServer implements GameServer<BaccaratC2S, BaccaratS2C> {
    public readonly id = 'baccarat' as const;

    private readonly wallet: Wallet;
    private readonly shoe: BaccaratShoe;
    private readonly random: () => number;

    /** 訂閱這張桌的連線。一般只有一條，但介面不該假設這件事 */
    private readonly listeners = new Set<(packet: BaccaratS2C) => void>();

    private phase: Phase = 'betting';
    /** 這個階段什麼時候結束（絕對時間戳）。見協定裡 `phase` 封包的說明 */
    private endsAt = 0;
    private roundNo = 0;

    /** 各注區的總押注（所有人）。每局開始清零 */
    private totals = emptyTotals();
    /**
     * 訪客自己這一局押了什麼。
     *
     * 它住在桌台而不是連線上，是因為 demo 只有一個訪客。真系統這裡會是
     * `Map<userId, Bets>`，而**其餘的邏輯一行都不會變**——這是刻意留的形狀。
     */

    /**
     * 這一局玩家實際點過的每一筆注，結算時組成注單。
     *
     * 跟 `myBets` 並存不是重複：`myBets` 是**現在每個注區有多少**（畫面要的），
     * 這一份是**點擊的流水**（帳要的）。同一區押兩次，前者是一個合計數字，
     * 後者是兩筆各自有時間戳的紀錄——客訴要查的是後者。
     */
    private pending: PendingBet[] = [];
    private myBets: Bets = {};

    private seats: Array<CrowdSeat | null> = [];
    /**
     * 線上散客這一局押了什麼（整團加總）。
     *
     * 要記它是因為結算時得知道「有沒有錢往畫面邊緣飛回去」。用總額反推
     * （總額減掉我的再減掉六張椅子的）也算得出來，但那是把一個現成的事實
     * 拆成三個減法——只要哪天多一種下注來源，那個減法就會靜默地算錯。
     */
    private crowdBets: Bets = {};

    /** 正在開的那一局。`sit` 進來的人要看得到桌上已經翻開的牌 */
    private openRound: Round | null = null;
    /** 這一局從牌靴抽出來的完整結果。開牌時算好，結算時要用 */
    private lastDraw: ReturnType<BaccaratShoe['draw']> | null = null;
    /** 這一局打完要不要換靴。從 result 走到 shuffle 的依據 */
    private shoeChanging = false;

    private timer: ReturnType<typeof setTimeout> | null = null;
    private betTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(wallet: Wallet = new Wallet(), random: () => number = Math.random) {
        this.wallet = wallet;
        this.random = random;
        this.shoe = new BaccaratShoe(random);

        for (let i = 0; i < SEAT_COUNT; i++) this.seats.push(spawnSeat(i, random));
        this.enterBetting();
    }

    public getBalance(): number {
        return this.wallet.get();
    }

    // ---- 連線 ----

    public attach(emit: (packet: BaccaratS2C) => void): void {
        this.listeners.add(emit);
    }

    public detach(emit: (packet: BaccaratS2C) => void): void {
        this.listeners.delete(emit);
    }

    /**
     * 只有 `sit` 與 `bet` 是玩家送得出來的。
     *
     * **沒有「發牌」這個指令**——這是這一款跟老虎機最根本的差別。開牌不是玩家按出來的，
     * 時間到了它自己就會發生。
     */
    public handle(packet: BaccaratC2S): BaccaratS2C | null {
        switch (packet.type) {
            case 'sit':
                return { type: 'table', snapshot: this.snapshot() };

            case 'bet':
                return this.bet(packet.spot, packet.amount);

            default:
                return null;
        }
    }

    /** 桌台停擺。整頁卸載時才會用到，留著是為了不讓 timer 活過它的主人 */
    public shutdown(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        if (this.betTimer !== null) clearTimeout(this.betTimer);
        this.timer = null;
        this.betTimer = null;
        this.listeners.clear();
    }

    // ---- 玩家下注 ----

    /**
     * 押一注。**押出去就不能撤**，所以這裡就扣款。
     *
     * 只有下注階段收得下。時間到了才送達的注（RTT 剛好卡在邊界）直接回錯誤而不是
     * 悄悄算進下一局——後者在真實系統裡是客訴的常見來源：玩家看到錢扣了，但注在
     * 他沒打算押的那一局上。
     */
    private bet(spot: BetSpot, amount: number): BaccaratS2C {
        if (this.phase !== 'betting') return { type: 'error', reason: 'bet_closed' };
        if (!BET_SPOTS.includes(spot)) return { type: 'error', reason: 'invalid_bet' };
        if (!Number.isFinite(amount) || amount <= 0) return { type: 'error', reason: 'invalid_bet' };
        // 營運層的限紅與維護開關（後台可即時改，見 server/opsConfig.ts）。
        // 擋在扣款之前——扣完才回錯誤，玩家的錢就憑空少一筆
        const denied = checkBet(this.id, amount);
        if (denied) return { type: 'error', reason: denied };

        const balanceBefore = this.wallet.get();
        if (!this.wallet.debit(amount)) return { type: 'error', reason: 'insufficient_balance' };

        this.myBets[spot] = (this.myBets[spot] ?? 0) + amount;
        this.totals[spot] += amount;
        this.pending.push({ spot, amount, betAt: Date.now(), balanceBefore });

        return {
            type: 'betOk',
            myBets: { ...this.myBets },
            totals: { ...this.totals },
            balance: this.wallet.get(),
        };
    }

    // ---- 一局的生命週期 ----

    /**
     * 下注階段：清空上一局的注、換掉幾張椅子、開始每秒推別人的注。
     *
     * 座位換人放在這裡而不是結算後，是因為**畫面上的變動要跟階段對齊**。結算時
     * 籌碼正在飛回各家面前，那一刻抽掉一個頭像，玩家會看到籌碼飛向一個空位。
     */
    private enterBetting(): void {
        this.roundNo++;
        this.totals = emptyTotals();
        this.myBets = {};
        this.pending = [];
        this.crowdBets = {};
        this.openRound = null;

        let seatsChanged = false;
        for (let i = 0; i < this.seats.length; i++) {
            const seat = this.seats[i];
            if (seat) {
                seat.bets = {};
                seat.staying--;
                // 待夠了就走。空著幾局再來人，桌子才有呼吸
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

        this.enter('betting', () => this.enterDealing());
        this.scheduleBetTick();
    }

    /**
     * 開牌：跟牌靴要一局，整局一次送給 client 讓它照著演。
     *
     * 為什麼不是一張一張推：真實視訊桌台確實是一張一張的（荷官翻一張推一則），
     * 但那是因為**結果在那一刻還沒發生**。我們的牌是一次算完的，硬要拆成六則推
     * 只是在假裝，還多出六個「漏收一則就對不上」的機會。
     */
    private enterDealing(): void {
        this.clearBetTick();

        const draw = this.shoe.draw();
        this.openRound = draw.round;
        this.shoeChanging = draw.shoeChanged;
        this.lastDraw = draw;

        this.enter('dealing', () => this.enterResult());
        this.emit({ type: 'deal', round: draw.round });
    }

    /**
     * 結算：算訪客的、算每張椅子的，然後把兩邊都推出去。
     *
     * 假玩家的輸贏**要真的算**而不是隨機給個數字，因為畫面上要演「籌碼飛回誰面前」——
     * 押莊的人在莊贏的局裡沒拿到錢，是那種一眼就看得出來的破綻。
     */
    private enterResult(): void {
        const draw = this.lastDraw;
        if (!draw) return;

        const payouts = settleBets(this.myBets, draw.round);
        const totalReturn = BET_SPOTS.reduce((sum, spot) => sum + payouts[spot], 0);
        this.wallet.credit(totalReturn);

        // 注單：一筆一筆記，不是照注區合計記（見 server/betSlip.ts）。
        // 有效投注做對沖折抵——押莊又押閒的風險遠低於下注額，
        // 照全額算返水就會被這種押法套利
        record(
            buildRecords(this.id, newRoundId(this.id), this.pending, payouts, {
                validStakeOf: netExposureValidStake,
            }),
        );
        this.pending = [];

        const seatResults: SeatResult[] = [];
        for (const seat of this.seats) {
            if (!seat) continue;
            const out = settleBets(seat.bets, draw.round);
            const back = BET_SPOTS.reduce((sum, spot) => sum + out[spot], 0);
            const staked = BET_SPOTS.reduce((sum, spot) => sum + (seat.bets[spot] ?? 0), 0);
            if (staked === 0) continue;
            seat.balance += back;
            seatResults.push({ seat: seat.seat, delta: back - staked, balance: seat.balance });
        }

        // 散客整團算成一筆。他們沒有餘額，但畫面上要知道有沒有錢往邊緣飛回去
        const crowdOut = settleBets(this.crowdBets, draw.round);
        const crowdBack = BET_SPOTS.reduce((sum, spot) => sum + crowdOut[spot], 0);
        const crowdStaked = BET_SPOTS.reduce((sum, spot) => sum + (this.crowdBets[spot] ?? 0), 0);
        if (crowdBack > 0) seatResults.push({ seat: ONLINE_SEAT, delta: crowdBack - crowdStaked, balance: 0 });

        this.enter('result', () => (this.shoeChanging ? this.enterShuffle() : this.enterBetting()));
        this.emit({
            type: 'settle',
            payouts,
            totalReturn,
            balance: this.wallet.get(),
            shoe: draw.shoe,
            road: draw.road,
            seats: seatResults,
            shoeChanged: draw.shoeChanged,
        });
    }

    /** 換靴：路圖整片清空，需要一段自己的時間讓玩家看懂發生了什麼。 */
    private enterShuffle(): void {
        this.shoeChanging = false;
        this.enter('shuffle', () => this.enterBetting());
    }

    // ---- 時鐘 ----

    /**
     * 進入一個階段，並排好它結束時要做什麼。
     *
     * 用 **`setTimeout` 鏈而不是 `setInterval`**：分頁被切到背景時瀏覽器會節流計時器，
     * 而 `setInterval` 在恢復時會把積欠的回呼**一次補爆**（catch-up），一瞬間跑掉
     * 三四個階段轉換，畫面上會看到牌還沒翻完就結算了。`setTimeout` 鏈是「這一段結束
     * 才排下一段」，最壞情況只是整桌變慢，不會亂序。
     */
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

    /**
     * 每秒推一批別人的注。
     *
     * `heat` 讓一局之內有起伏：剛開盤零星幾筆，中段變密，**最後幾秒衝一波**——
     * 那個「快封盤了大家搶著押」的節奏是真桌最有辨識度的一段，平均分布做不出來。
     */
    private scheduleBetTick(): void {
        this.betTimer = setTimeout(() => {
            if (this.phase !== 'betting') return;

            const left = this.endsAt - Date.now();
            const progress = 1 - Math.max(0, left) / PHASE_MS.betting;
            const heat = progress < 0.15 ? 0.2 : progress > 0.78 ? 1 : 0.35 + progress * 0.55;

            const crowd = onlineBets(heat, this.random);
            for (const bet of crowd) this.crowdBets[bet.spot] = (this.crowdBets[bet.spot] ?? 0) + bet.chip * bet.count;

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

    private snapshot(): TableSnapshot {
        return {
            phase: this.phase,
            endsAt: this.endsAt,
            serverNow: Date.now(),
            round: this.roundNo,
            history: [...this.shoe.getHistory()],
            shoe: this.shoe.info(),
            seats: this.seatInfos(),
            totals: { ...this.totals },
            myBets: { ...this.myBets },
            openRound: this.openRound ?? undefined,
        };
    }

    private seatInfos(): SeatInfo[] {
        return this.seats.filter(isSeat).map(toSeatInfo);
    }

    private emit(packet: BaccaratS2C): void {
        for (const listener of this.listeners) listener(packet);
    }
}

function isSeat(seat: CrowdSeat | null): seat is CrowdSeat {
    return seat !== null;
}

/**
 * 整個遊樂場共用的那一張桌子。
 *
 * 做成 module-level singleton 而不是每次進桌 new 一個，是「路過的玩家」這個設定
 * 唯一說得通的做法：離桌再回來，路圖應該還接在原本那一靴上，桌上的人也該還是那些人。
 * 每次 new 一張新桌的話，玩家會發現這張桌子的歷史是跟著他走的——那就不是多人桌了。
 *
 * 它跟 `sessionWallet` 是同一個 pattern：**活得比任何一條連線久的東西，就不該由連線持有。**
 * 代價是它從整頁載入的那一刻就開始跑（就算你在大廳），這正是我們要的。
 */
export const baccaratTable = new BaccaratServer(sessionWallet);
