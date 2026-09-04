import type { GameServer } from './gameServer';
import type { BaccaratLiveC2S, BaccaratLiveS2C, LiveDealt, LiveSnapshot } from '../net/games/baccaratLive';
import { ONLINE_SEAT, type SeatInfo, type SeatResult } from '../net/games/baccarat';
import type { RoadRound } from '../games/baccarat/roadmap';
import { BET_SPOTS, settleBets, type BetSpot, type Bets } from '../games/baccarat/rules';
import { buildRecords, netExposureValidStake, type PendingBet } from './betSlip';
import { newRoundId, record } from './ledger';
import { checkBet } from './opsConfig';
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
import { Wallet, sessionWallet } from './wallet';
import {
    BETTING_DURATION,
    dealtBy,
    locate,
    phaseAt,
    ROUND_DURATION,
    type LivePhase,
    type RoundCue,
    type StreamCues,
} from '../live/schedule';

/**
 * 視訊百家樂的桌台 server——**它不開局，它讀畫面。**
 *
 * 數位桌台的 server 自己跑碼表：下注 12 秒到了就發牌、發完就結算，時間是它決定的。
 * 這一支不是。它手上有一份跟影片一起生出來的時間表（`cues.json`），照牆鐘算出
 * 「畫面現在演到哪」，再把看到的事情廣播出去。
 *
 * 這個方向跟真實視訊桌台一致：那邊是荷官的實體動作經由讀牌器進 game server，
 * server 只是轉述。**server 從來不是那個決定牌什麼時候出現的人。**
 *
 * 於是「畫面跟桌況對得上」不需要任何對齊機制——兩邊讀的是同一份資料，
 * 而那份資料在素材生成的時候就定案了（見 live/tools/build-stream.mjs）。
 *
 * ## 錢在這裡是真的會動的
 *
 * 讀畫面不代表不管帳。下注、扣款、結算入帳全部由這支負責，走的是跟老虎機、
 * 數位百家樂同一個 `sessionWallet`——**餘額屬於帳號不屬於桌台**（見 wallet.ts）。
 * 它唯一沒有的權力是決定輸贏：牌在素材生成時就定了，這裡只是照 `cues.json` 算賠付。
 *
 * 這正好是視訊桌台在真實世界的樣子：**牌的真相來自實體世界，帳的真相來自 server。**
 * 兩者分屬不同的權威，這支檔案是後者。
 */

/** 多久檢查一次畫面演到哪（毫秒）。100ms 的誤差在一張牌 0.9 秒的節奏下看不出來 */
const TICK_MS = 100;

/** 路圖往回追幾局。真實桌台的路圖大約就是這個長度 */
const HISTORY_LEN = 42;

/** 多久推一次別人的注（秒）。跟數位桌台同頻——每秒一批，畫面上才有持續的籌碼流 */
const BET_TICK = 1;

/** 空位每一局有多少機率來新客人。跟數位桌台同一個值——同一種桌子該有同一種呼吸 */
const SEAT_CHURN = 0.34;

export class BaccaratLiveServer implements GameServer<BaccaratLiveC2S, BaccaratLiveS2C> {
    readonly id = 'baccaratLive' as const;

    private cues: StreamCues | null = null;
    private epoch = 0;

    private readonly wallet: Wallet;
    private readonly random: () => number;

    private readonly listeners = new Set<(p: BaccaratLiveS2C) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;

    /** 上一次推播時畫面演到哪。用來判斷「有沒有新的事情發生」 */
    private last = { round: -1, phase: '' as LivePhase | '', dealt: 0, revealed: false, settled: false };

    /** 這一局各注區的總押注（含我自己、椅子上的人與所有散客） */
    private totals = emptyTotals();
    /** 我這一局押了什麼 */

    /**
     * 這一局玩家實際點過的每一筆注，結算時組成注單。
     *
     * 跟 `myBets` 並存不是重複：`myBets` 是**現在每個注區有多少**（畫面要的），
     * 這一份是**點擊的流水**（帳要的）。同一區押兩次，前者是一個合計數字，
     * 後者是兩筆各自有時間戳的紀錄——客訴要查的是後者。
     */
    private pending: PendingBet[] = [];
    private myBets: Bets = {};
    /**
     * 六張椅子。`null` = 空著。
     *
     * 跟數位桌台同一套（連 `baccaratCrowd` 都是共用的）：**一張沒有別人的百家樂桌
     * 看起來像壞掉了**，而視訊桌台更需要這件事成立——畫面裡只有一個荷官，
     * 桌上有沒有人全靠介面講。
     */
    private readonly seats: Array<CrowdSeat | null> = [];
    /** 散客整團這一局押了什麼。結算時要知道有沒有錢往畫面邊緣飛回去 */
    private crowdBets: Bets = {};
    /** 上一次推散客注是在局內第幾秒。每局重來 */
    private lastBetTick = -1;

    /** 有人在等桌況但 cues 還沒到。載入完成時補送 */
    private pendingSit = false;

    constructor(cuesUrl: string, wallet: Wallet = new Wallet(), random: () => number = Math.random) {
        this.wallet = wallet;
        this.random = random;
        for (let i = 0; i < SEAT_COUNT; i++) this.seats.push(spawnSeat(i, random));
        void this.load(cuesUrl);
    }

    private async load(url: string): Promise<void> {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`cues ${res.status}`);
            const raw = (await res.json()) as StreamCues & { epoch: number };
            this.cues = { rounds: raw.rounds, duration: raw.duration };
            this.epoch = raw.epoch;

            this.syncMarker();

            // 載入期間如果已經有人坐下，現在補一份桌況給他。
            // **順序不能反**：syncMarker 得先跑，快照才不會拿到還沒初始化的 last
            if (this.pendingSit) {
                this.pendingSit = false;
                this.emit({ type: 'table', snapshot: this.snapshot() });
            }

            // 桌子從這一刻起自己跑，**跟有沒有人在看無關**。
            //
            // 原本 timer 是 attach 時才開、detach 時就關的，那在只有「看桌」的版本裡
            // 成立——沒人看的時候不推播，省下來的是幾個空轉的分支。接上下注之後就不成立了：
            // 玩家可以在下注期押完就離桌，timer 一停，那一局永遠不會走到結算，
            // **錢扣了但賠付不會發生**。這種帳不是少算一次動畫，是真的少一筆錢。
            //
            // 所以改成桌子一直跑，listener 只決定有沒有人收得到推播。這也才對得上
            // 檔案開頭那句「它照著影片一局一局跑」——真實桌台不會因為你關掉分頁就停下。
            this.timer = setInterval(() => this.step(), TICK_MS);
        } catch {
            // 素材不在（還沒跑過 build:stream）就安靜地不動。
            // 模組那邊會因為視訊也載不到而顯示錯誤，這裡再喊一次只是重複
        }
    }

    handle(packet: BaccaratLiveC2S): BaccaratLiveS2C | null {
        switch (packet.type) {
            case 'sit':
                if (!this.cues) {
                    // 還在跟桌台同步。回 null 而不是回一份空桌況——空桌況會讓 client 先畫出
                    // 一張沒有牌的桌子再跳成正確的樣子，那一下閃爍比多等 200ms 難看得多
                    this.pendingSit = true;
                    return null;
                }
                return { type: 'table', snapshot: this.snapshot() };

            case 'bet':
                return this.bet(packet.spot, packet.amount);

            default:
                return null;
        }
    }

    attach(emit: (p: BaccaratLiveS2C) => void): void {
        this.listeners.add(emit);
    }

    /**
     * 桌台停擺。整頁卸載時才會用到，留著是為了不讓 timer 活過它的主人。
     *
     * 注意它**不是** detach 的同義詞：離桌只是不再收推播，桌子照樣一局一局跑下去
     * （見 load 裡開 timer 那段的說明）。沒有這個區別的話，玩家押完注就離桌的那一局
     * 永遠不會結算。
     */
    shutdown(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.listeners.clear();
    }

    detach(emit: (p: BaccaratLiveS2C) => void): void {
        this.listeners.delete(emit);
    }

    // ---- 玩家下注 ---------------------------------------------------------

    /**
     * 押一注。**押出去就不能撤**，所以這裡就扣款。
     *
     * 截止的判斷用**畫面的時間**（`phaseAt` 讀 cue），不是 server 自己的碼表——
     * 這張桌沒有碼表。所以「太晚了」的意思是精確的：畫面上荷官已經伸手去拿牌了。
     *
     * 邊界上被拒的注會退回 `bet_closed` 而不是悄悄算進下一局。後者在真實系統裡是
     * 客訴的常見來源：玩家看到錢扣了，但注在他沒打算押的那一局上。而視訊桌台更容易
     * 撞到這條邊界——**玩家看到的畫面是延遲之後的**，他以為還剩三秒的時候可能早就截止了
     * （見 games/baccaratLive/index.ts 的延遲區）。
     */
    private bet(spot: BetSpot, amount: number): BaccaratLiveS2C {
        if (!this.cues) return { type: 'error', reason: 'bet_closed' };

        const { index, local } = locate(this.cues, this.globalNow());
        if (phaseAt(this.cues.rounds[index], local) !== 'betting') return { type: 'error', reason: 'bet_closed' };

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

    // ---- 時間 -------------------------------------------------------------

    /** 從 epoch 起算，這條直播已經播了幾秒 */
    private globalNow(): number {
        return (Date.now() - this.epoch) / 1000;
    }

    /**
     * 把「現在」的狀態記下來但不推播。
     *
     * 開始監看時一定要先做這件事，否則第一個 tick 會把**已經發生過**的事情
     * 全部當成新事件推一遍——中途進桌的玩家會看到四張牌在半秒內全部重發一次。
     */
    private syncMarker(): void {
        if (!this.cues) return;
        const { index, local } = locate(this.cues, this.globalNow());
        const cue = this.cues.rounds[index];
        this.last = {
            round: index,
            phase: phaseAt(cue, local),
            dealt: dealtBy(cue, local).length,
            revealed: local >= cue.revealAt,
            settled: local >= cue.resultAt,
        };
        this.lastBetTick = Math.floor(local / BET_TICK);
    }

    // ---- 監看 -------------------------------------------------------------

    /**
     * 看一眼畫面演到哪，有新事情就廣播。
     *
     * 順序是刻意的：**先推階段、再推牌、最後推結算**。牌落桌一定發生在
     * 「停止下注」之後，結算一定發生在牌翻完之後——照著因果的順序送，client 就
     * 永遠不必處理「結算來了但牌還沒到」這種需要暫存的狀況。
     */
    private step(): void {
        if (!this.cues) return;

        const now = this.globalNow();
        const { index, local } = locate(this.cues, now);
        const cue = this.cues.rounds[index];
        const phase = phaseAt(cue, local);

        // 換局：重設這一局的追蹤，並把階段推出去
        if (index !== this.last.round) {
            this.last = { round: index, phase: '', dealt: 0, revealed: false, settled: false };
            // 注區歸零要跟著換局，不能跟著結算——結算在局內第 19 秒，之後還有收牌那幾秒，
            // 那段時間注區上該留著剛才的數字給人看完自己押了多少
            this.totals = emptyTotals();
            this.myBets = {};
            this.pending = [];
            this.crowdBets = {};
            this.lastBetTick = -1;
            this.rotateSeats();
        }

        if (phase !== this.last.phase) {
            this.last.phase = phase;
            this.emit({
                type: 'phase',
                phase,
                endsAt: Date.now() + (this.phaseEnd(cue, phase) - local) * 1000,
                serverNow: Date.now(),
                round: index,
            });
        }

        if (phase === 'betting') this.pumpCrowd(cue, local);

        const dealt = dealtBy(cue, local);
        for (let i = this.last.dealt; i < dealt.length; i++) {
            const d = dealt[i];
            this.emit({
                type: 'deal',
                card: { side: d.side, index: d.index, suit: d.card.suit, rank: d.card.rank, faceUp: d.index === 2 },
            });
        }
        this.last.dealt = dealt.length;

        if (!this.last.revealed && local >= cue.revealAt) {
            this.last.revealed = true;
            // 前四張一起攤。補牌不在這裡——它落桌就是正面的
            this.emit({ type: 'reveal', cards: dealt.filter((d) => d.index < 2).map(toDealt) });
        }

        if (!this.last.settled && local >= cue.resultAt) {
            this.last.settled = true;
            this.settle(cue);
        }
    }

    /**
     * 這一秒桌上的人押了什麼——六張椅子加上一整群沒有座位的線上散客。
     *
     * 兩層都要：椅子上的人有頭像、有脾氣、押得比較重，是「這桌今天押莊的人特別多」
     * 這種局面的來源；散客沒有位置，但桌上大部分的注量與畫面上大部分的籌碼都是他們的。
     *
     * `heat` 是下注期的進度：剛開盤零星幾筆，倒數最後幾秒衝一波。那個節奏是真桌
     * 最有辨識度的一段，平均分布做不出來。
     */
    private pumpCrowd(cue: RoundCue, local: number): void {
        const tick = Math.floor(local / BET_TICK);
        if (tick === this.lastBetTick) return;
        this.lastBetTick = tick;

        const heat = Math.min(1, local / Math.max(0.001, cue.lockAt));
        const seated = seatBets(this.seats.filter((s): s is CrowdSeat => s !== null), this.random);
        const online = onlineBets(heat, this.random);

        // 散客沒有餘額可以記帳，但整團的注要留著——結算時得知道有沒有錢往邊緣飛回去
        for (const bet of online) {
            const amount = bet.chip * bet.count;
            this.crowdBets[bet.spot] = (this.crowdBets[bet.spot] ?? 0) + amount;
        }

        const bets = [...seated, ...online];
        applyTotals(this.totals, bets);
        this.emit({ type: 'bets', bets, totals: { ...this.totals } });
    }

    /**
     * 換局時的座位輪替：待夠的人走、空位有機會來新人。
     *
     * **座位要會換人**——一整晚都是同六個名字的桌子看久了會露餡，換人也順帶讓
     * 「有人剛贏了一大筆就跑」這種真實桌上的戲碼自己發生。
     */
    private rotateSeats(): void {
        let changed = false;
        for (let i = 0; i < this.seats.length; i++) {
            const seat = this.seats[i];
            if (seat) {
                seat.bets = {};
                seat.staying--;
                // 待夠了就走。空著幾局再來人，桌子才有呼吸
                if (seat.staying <= 0) {
                    this.seats[i] = null;
                    changed = true;
                }
            } else if (this.random() < SEAT_CHURN) {
                this.seats[i] = spawnSeat(i, this.random);
                changed = true;
            }
        }
        if (changed) this.emit({ type: 'seats', seats: this.seatInfos() });
    }

    private seatInfos(): SeatInfo[] {
        return this.seats.filter((s): s is CrowdSeat => s !== null).map(toSeatInfo);
    }

    /**
     * 算帳。
     *
     * 牌不是這裡發的，但賠付是這裡算的——用的是跟數位桌台**同一支** `settleBets`。
     * 那支函式不知道牌是攝影機拍到的還是程式抽的，這正是規則層該有的樣子：
     * 換媒介不換規則。
     */
    private settle(cue: RoundCue): void {
        const payouts = settleBets(this.myBets, cue.round);
        const totalReturn = BET_SPOTS.reduce((sum, spot) => sum + (payouts[spot] ?? 0), 0);
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

        // 椅子上的人各自算一份。他們的餘額是自己記的（不走錢包——錢包是**我的**帳號）
        const seatResults: SeatResult[] = [];
        for (const seat of this.seats) {
            if (!seat) continue;
            const staked = sum(seat.bets);
            if (staked === 0) continue;
            const back = sum(settleBets(seat.bets, cue.round) as Bets);
            seat.balance += back;
            seatResults.push({ seat: seat.seat, delta: back - staked, balance: seat.balance });
        }

        // 散客整團算成一筆。他們沒有餘額，但畫面上要知道有沒有錢往邊緣飛回去
        const crowdBack = sum(settleBets(this.crowdBets, cue.round) as Bets);
        if (crowdBack > 0) {
            seatResults.push({ seat: ONLINE_SEAT, delta: crowdBack - sum(this.crowdBets), balance: 0 });
        }

        this.emit({
            type: 'settle',
            round: cue.round,
            road: toRoad(cue),
            payouts,
            totalReturn,
            balance: this.wallet.get(),
            seats: seatResults,
        });
    }

    private phaseEnd(cue: RoundCue, phase: LivePhase): number {
        switch (phase) {
            case 'betting':
                return cue.lockAt;
            case 'dealing':
                return cue.resultAt;
            case 'result':
                return cue.clearAt;
            case 'clearing':
                return ROUND_DURATION;
        }
    }

    // ---- 桌況 -------------------------------------------------------------

    private snapshot(): LiveSnapshot {
        const cues = this.cues as StreamCues;
        const now = this.globalNow();
        const { index, local } = locate(cues, now);
        const cue = cues.rounds[index];
        const phase = phaseAt(cue, local);
        const revealed = local >= cue.revealAt;

        return {
            phase,
            endsAt: Date.now() + (this.phaseEnd(cue, phase) - local) * 1000,
            serverNow: Date.now(),
            round: index,
            dealt: dealtBy(cue, local).map((d) => ({
                side: d.side,
                index: d.index,
                suit: d.card.suit,
                rank: d.card.rank,
                // 中途進桌看到的必須是**現在**的樣子：已經攤開的牌就該是正面，
                // 不是從頭補演一次翻牌
                faceUp: d.index === 2 || revealed,
            })),
            history: this.history(now),
            openRound: local >= cue.resultAt ? cue.round : undefined,
            seats: this.seatInfos(),
            totals: { ...this.totals },
            myBets: { ...this.myBets },
            balance: this.wallet.get(),
        };
    }

    /**
     * 往回推算的路圖歷史。
     *
     * 素材是循環的，所以「上一局」不是陣列裡的前一項，而是**上一圈的某一項**。
     * 從 epoch 起算已經跑完幾局是算得出來的，於是每個觀眾——不管什麼時候進桌——
     * 看到的路圖都一模一樣。這件事在真實桌台是理所當然的，在循環素材上得刻意做到。
     */
    private history(now: number): RoadRound[] {
        const cues = this.cues as StreamCues;
        const n = cues.rounds.length;
        // 已經**結算完**的局數。用結算時刻而不是局的起點算，
        // 否則正在發牌的這一局會提前出現在自己的路圖上
        const done = Math.floor((now - cues.rounds[0].resultAt) / ROUND_DURATION) + 1;
        const out: RoadRound[] = [];
        for (let k = Math.max(0, done - HISTORY_LEN); k < done; k++) {
            out.push(toRoad(cues.rounds[((k % n) + n) % n]));
        }
        return out;
    }

    private emit(p: BaccaratLiveS2C): void {
        for (const fn of this.listeners) fn(p);
    }
}

/** 一份注加總起來多少。`Bets` 是稀疏的，所以不能直接 Object.values */
function sum(bets: Bets): number {
    return BET_SPOTS.reduce((n, spot) => n + (bets[spot] ?? 0), 0);
}

function toDealt(d: ReturnType<typeof dealtBy>[number]): LiveDealt {
    return { side: d.side, index: d.index, suit: d.card.suit, rank: d.card.rank, faceUp: true };
}

function toRoad(cue: RoundCue): RoadRound {
    return { outcome: cue.round.outcome, playerPair: cue.round.playerPair, bankerPair: cue.round.bankerPair };
}

/** 下注期有多長。client 畫倒數條要照它算比例，從這裡再匯出一次免得兩邊各寫一個常數 */
export { BETTING_DURATION };

/**
 * 桌台單例。
 *
 * 跟數位百家樂同理，是 module-level 的一張桌而不是每次進桌 new 一張：**它照著影片
 * 一局一局跑，沒人在看的時候也一樣在跑。** 每次進桌開一張新的，路圖就會跟著玩家走，
 * 那就不是同一張桌了——而視訊桌台比誰都需要「所有人在看同一張桌」這件事成立。
 *
 * 錢包也在這裡才接上，跟數位桌台同一個：從老虎機贏的錢走到這張視訊桌還在。
 */
export const liveTable = new BaccaratLiveServer('public/live/table01/cues.json', sessionWallet);
