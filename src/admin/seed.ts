import {
    BET_SPOTS,
    settleBets as settleBaccarat,
    type BetSpot,
    type Bets as BaccaratBets,
} from '../arcade/games/baccarat/rules';
import {
    allBetKeys,
    settleBets as settleRoulette,
    WHEEL_ORDER,
    type Bets as RouletteBets,
} from '../arcade/games/roulette/rules';
import { BaccaratShoe } from '../arcade/server/baccaratShoe';
import { buildRecords, netExposureValidStake, type PendingBet } from '../arcade/server/betSlip';
import { count, PLAYER_ID, record, type BetRecord } from '../arcade/server/ledger';
import { SlotServer } from '../arcade/server/slotServer';
import { Wallet } from '../arcade/server/wallet';

/**
 * 種子資料：後台第一次打開時，把過去七天的注單灌進去。
 *
 * ---
 *
 * **這裡最重要的一個決定：注單是用四款玩法真正的規則跑出來的，不是隨機填的數字。**
 *
 * 老虎機叫的是 `SlotServer.spin()`——同一支被 `yarn check:slot` 拿去驗過期望值的函式。
 * 百家樂用真的牌靴發牌、真的補牌規則。輪盤真的開一個號碼，賠付走 `settleBets`。
 *
 * 差別在報表上看得出來：**儀表板的實際派彩率會往這些遊戲本身的期望值收斂**，
 * 而且局數愈多靠得愈近。如果注單是隨機生的，那個數字就只是當初填的參數，
 * 報表變成一張自己證明自己的圖。
 *
 * 而這正好是這個後台想講的事：**營運報表的價值來自它跟真實遊戲之間那條沒有斷掉的線。**
 *
 * ---
 *
 * 唯一被動手腳的是時間戳。種子是在打開頁面的那一瞬間跑完的，
 * 但後台要展示的是「過去七天」，所以 `settledAt` 由這裡指定
 * （見 arcade/server/betSlip.ts 的 `BuildOptions.settledAt`）。
 */

const DAYS = 7;
/** 每天的局數上下限。不是固定值，浮動一點才像真的營運資料 */
const ROUNDS_PER_DAY = { min: 220, max: 380 };

/** 玩家會用的籌碼面額。小注多、大注少，這是真實的下注分布形狀 */
const CHIPS = [5, 10, 10, 25, 25, 25, 50, 50, 100, 100, 500];

/**
 * 模擬玩家的錢包。
 *
 * 一開始這裡放的是五千萬——夠大就不會跑到一半破產讓資料斷掉。
 * 但那個數字會**從錢包漏到注單上**：注單的「結算後餘額」欄印出 49,991,687，
 * 一眼就看得出不是真的玩家。注單裡的餘額是拿來對帳的欄位，
 * 它不合理的話整張表的可信度就沒了。
 *
 * 改成一個正常的餘額，輸到快見底就補一筆——真實玩家本來就是輸光再儲值，
 * 而真實系統裡那也會是一筆交易紀錄。
 */
const SEED_BALANCE = 50_000;
/** 低於這個數就補值，模擬玩家儲值 */
const TOPUP_AT = 3_000;

function pick<T>(arr: readonly T[], rnd: () => number): T {
    return arr[(rnd() * arr.length) | 0];
}

/**
 * 種子用的亂數是**有種子的**，不是 `Math.random()`。
 *
 * 理由是可重現性：清掉資料重灌，看到的會是同一份數字。
 * demo 的時候如果要重跑一次，不會因為這次剛好開出一串大獎，
 * 讓派彩率變成 130% 而必須臨場解釋那只是變異數。
 *
 * 這是 mulberry32，32 位元的小型 PRNG，夠均勻也夠快。
 */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 內注／外注分開的注別清單 */
interface RouletteKeys {
    inside: string[];
    outside: string[];
}

/**
 * 把輪盤的注別分成內注與外注。
 *
 * 外注是賠率低、命中率高的那些（紅黑、單雙、大小、打注、列注），
 * 內注是壓在號碼上的（直注、分注、街注、角注、線注）。
 * 判準用 key 的前綴，因為 `formatBetKey` 產生的 key 本來就帶著注別種類。
 */
function splitRouletteKeys(): RouletteKeys {
    const OUTSIDE = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen', 'column'];
    const inside: string[] = [];
    const outside: string[] = [];
    for (const k of allBetKeys()) {
        (OUTSIDE.includes(k.split(':')[0]) ? outside : inside).push(k);
    }
    return { inside, outside };
}

/** 一局的注單（已經帶好時間），累積起來最後一次寫入 */
type Row = Omit<BetRecord, 'id' | 'status'>;

/** 老虎機：真的轉，真的算連線 */
function seedSlot(at: number, rnd: () => number, server: SlotServer, wallet: Wallet): Row[] {
    const bet = pick(CHIPS, rnd);
    const balanceBefore = wallet.get();
    const res = server.spin(bet);
    if ('error' in res) return [];

    return [
        {
            roundId: `slot-${at.toString(36)}`,
            game: 'slot',
            player: PLAYER_ID,
            betType: 'spin',
            stake: bet,
            validStake: bet,
            payout: res.totalWin,
            net: res.totalWin - bet,
            balanceBefore,
            balanceAfter: res.balance,
            betAt: at - 2000,
            settledAt: at,
        },
    ];
}

/** 百家樂：真的牌靴、真的補牌規則、真的賠付 */
function seedBaccarat(
    game: 'baccarat' | 'baccaratLive',
    at: number,
    rnd: () => number,
    shoe: BaccaratShoe,
    wallet: Wallet,
): Row[] {
    const draw = shoe.draw();

    // 押 1~2 個注區。莊閒各半，偶爾押和或對子——這是真實牌桌的下注分布
    const spots: BetSpot[] = rnd() < 0.5 ? ['banker'] : ['player'];
    if (rnd() < 0.18) spots.push(pick(['tie', 'playerPair', 'bankerPair'] as const, rnd));

    const pending: PendingBet[] = [];
    const bets: BaccaratBets = {};
    for (const spot of spots) {
        const amount = pick(CHIPS, rnd);
        const balanceBefore = wallet.get();
        if (!wallet.debit(amount)) continue;
        pending.push({ spot, amount, betAt: at - 8000, balanceBefore });
        bets[spot] = (bets[spot] ?? 0) + amount;
    }
    if (!pending.length) return [];

    const payouts = settleBaccarat(bets, draw.round);
    wallet.credit(BET_SPOTS.reduce((s, spot) => s + payouts[spot], 0));

    return buildRecords(game, `${game}-${at.toString(36)}`, pending, payouts, {
        settledAt: at,
        validStakeOf: netExposureValidStake,
    });
}

/**
 * 輪盤：真的開一個號碼，賠付走跟遊戲同一支 settleBets。
 *
 * **注別分成內外兩堆再抽，不是從一百多種裡平均亂挑**，理由是報表會被它決定：
 * 直注賠 35 倍，均勻亂挑的話直注會佔到四分之一，一局中一次就把當天的派彩率
 * 拉高幾十個百分點。真實玩家的分布不長那樣——外注（紅黑、單雙、大小、打注、列注）
 * 才是主力，內注是少數人在押的。
 *
 * 這件事本身就是這個 demo 想講的：**報表上那個看起來不對勁的數字，
 * 常常是下注結構的問題，不是系統的問題。**
 */
function seedRoulette(at: number, rnd: () => number, keys: RouletteKeys, wallet: Wallet): Row[] {
    const winning = pick(WHEEL_ORDER, rnd);

    // 輪盤玩家通常一局押好幾注
    const n = 1 + ((rnd() * 4) | 0);
    const pending: PendingBet[] = [];
    const bets: RouletteBets = {};
    for (let i = 0; i < n; i++) {
        // 七成押外注、三成押內注
        const key = pick(rnd() < 0.7 ? keys.outside : keys.inside, rnd);
        const amount = pick(CHIPS, rnd);
        const balanceBefore = wallet.get();
        if (!wallet.debit(amount)) continue;
        pending.push({ spot: key, amount, betAt: at - 12000, balanceBefore });
        bets[key] = (bets[key] ?? 0) + amount;
    }
    if (!pending.length) return [];

    const payouts = settleRoulette(bets, winning);
    wallet.credit(Object.values(payouts).reduce((s, v) => s + v, 0));

    return buildRecords('roulette', `roulette-${at.toString(36)}`, pending, payouts, {
        settledAt: at,
        validStakeOf: netExposureValidStake,
    });
}

/** 後台開啟時呼叫。已經有資料就什麼都不做 */
export function seedIfEmpty(): number {
    if (count() > 0) return 0;
    return seed();
}

/** 產生並寫入種子注單，回傳筆數 */
export function seed(): number {
    const rows = generate();
    record(rows);
    return rows.length;
}

export interface GenerateOptions {
    days?: number;
    roundsPerDay?: { min: number; max: number };
    seed?: number;
}

/**
 * 只產生、不寫入。
 *
 * 拆出來是為了讓 `rtp-baseline.mjs` 能在 Node 底下跑同一套產生邏輯，
 * 只是把規模放大幾百倍去算期望值。**基準線必須跟畫面上的資料同源**——
 * 如果基準是查來的、資料是這裡跑的，兩邊對不起來的時候就不知道是誰錯了。
 */
export function generate(opts: GenerateOptions = {}): Row[] {
    const days = opts.days ?? DAYS;
    const perDay = opts.roundsPerDay ?? ROUNDS_PER_DAY;
    const rnd = seededRandom(opts.seed ?? 20260907);
    const wallet = new Wallet(SEED_BALANCE);
    // 亂數傳進去，老虎機的盤面才跟其他玩法一樣可重現——
    // 少了這個，基準線腳本每跑一次 slot 的數字就差一個百分點
    const slot = new SlotServer(wallet, rnd);
    /**
     * **兩張桌各給一個牌靴，不能共用。**
     *
     * 共用會出事，而且症狀很隱蔽：兩款的派彩率各自偏離理論值一到兩個百分點，
     * 合起來卻是對的。原因是**一靴牌是有限的，靴內的局並非獨立事件**——
     * 一張桌抽走了大牌，另一張桌就更容易抽到小牌，兩邊產生負相關。
     *
     * 這是這個 demo 過程中真的踩到的：基準線腳本跑出 baccarat 96.92%、
     * baccaratLive 98.73%，差了 1.8 個百分點，而兩者用的是同一套規則與同一份下注分布。
     * 先驗了牌靴本身（50 萬局的莊閒和分布跟理論吻合到小數點後兩位）、
     * 也驗了單注的派彩倍率分布都正常，才回頭發現是這一行共用。
     */
    const shoes = {
        baccarat: new BaccaratShoe(rnd),
        baccaratLive: new BaccaratShoe(rnd),
    };
    // 輪盤的注別 key 有一百多種，先分好內外注重複用，不必每局重算
    const rouletteKeys = splitRouletteKeys();

    const rows: Row[] = [];
    const now = Date.now();
    const dayMs = 86_400_000;

    /**
     * 日界對齊**自然日的午夜**，不是「往回推 24 小時」。
     *
     * 差別在報表上很明顯：後台的「今日」是從今天 00:00 算起，
     * 如果種子用相對 24 小時切，跨過午夜之後那些注單會落在昨天與今天的邊界上，
     * 「今日」就只剩零星幾筆。這不是資料的問題，是分桶的基準跟報表不一致。
     */
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todayStart = midnight.getTime();

    for (let d = days; d >= 1; d--) {
        const dayStart = todayStart - (d - 1) * dayMs;
        const span = perDay.max - perDay.min;
        let rounds = perDay.min + ((rnd() * span) | 0);

        // 今天還沒過完，局數照已經過掉的比例縮——一天才剛開始就灌滿全天的量，
        // 「今日投注」會比昨天還高，那是假的
        const isToday = d === 1;
        const elapsed = isToday ? Math.min(1, (now - todayStart) / dayMs) : 1;
        if (isToday) rounds = Math.max(1, Math.round(rounds * elapsed));

        for (let i = 0; i < rounds; i++) {
            const frac = (i + rnd()) / rounds;
            // 今天只散佈在已經過掉的那一段，不然報表上會出現未來時間的注單
            const at = Math.min(now - 1000, dayStart + frac * dayMs * elapsed);

            // 快輸光就補值。少了這一步，跑到中段錢包見底，
            // 之後所有的 debit 都會失敗，資料就在那裡斷掉——
            // 而症狀是報表最後幾天突然沒有注單，看起來像分桶寫錯
            if (wallet.get() < TOPUP_AT) wallet.credit(SEED_BALANCE - wallet.get());

            const roll = rnd();
            if (roll < 0.45) rows.push(...seedSlot(at, rnd, slot, wallet));
            else if (roll < 0.7) rows.push(...seedBaccarat('baccarat', at, rnd, shoes.baccarat, wallet));
            else if (roll < 0.82) rows.push(...seedBaccarat('baccaratLive', at, rnd, shoes.baccaratLive, wallet));
            else rows.push(...seedRoulette(at, rnd, rouletteKeys, wallet));
        }
    }

    // 照結算時間排好再寫入。ledger 的儲存順序就是寫入順序，
    // 種子亂序寫進去的話，「最新的在最後面」這個前提就不成立了
    rows.sort((a, b) => a.settledAt - b.settledAt);
    return rows;
}
