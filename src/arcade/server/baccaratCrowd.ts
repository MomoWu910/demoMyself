import { CHIP_VALUES, type ChipValue } from '../common/chips/atlas';
import { ONLINE_SEAT, type OtherBet, type SeatInfo } from '../net/games/baccarat';
import { BET_SPOTS, type BetSpot, type Bets } from '../games/baccarat/rules';

/**
 * 桌上的其他人：六張椅子上的玩家，加上一大群沒有座位的線上散客。
 *
 * 為什麼要做這一整套假人：**一張沒有別人的百家樂桌看起來像壞掉了**。真實桌台在下注
 * 那十幾秒裡是滿畫面的籌碼往中間飛，那個密度本身就是「這桌有在營業」的訊號。
 * 前公司那套也是同一個結構——看得見的貴賓席，加上一個叫 `ON_LINE` 的匯總來源
 * （`SEAT_INDEX.ON_LINE`），大部分的注其實都是後者。
 *
 * 這裡刻意讓每個假人有**自己的脾氣**（慣用面額、偏好注區、多久出手一次），而不是
 * 每秒隨機灑。理由很實際：純隨機灑出來的注會平均分布在五個注區上，於是每一局看起來
 * 都一模一樣。有脾氣之後才會出現「這桌今天押莊的人特別多」這種一眼看得出來的局面，
 * 而那正是玩家在真實桌上會讀的東西。
 */

/** 桌上有幾張椅子。 */
export const SEAT_COUNT = 6;

/**
 * 頭像顏色。全部是壓過飽和度的金屬／寶石色——**同一個家族拉出層次**，
 * 六個頭像擺在一起才像同一張桌子的人，而不是一盒彩色筆。
 */
const TINTS = [0xd9b871, 0xc98f7a, 0x7fa8bd, 0x86a86b, 0xb08d57, 0xa98cc0, 0xc05a5a, 0x8fb0a8];

/** 假名字。前綴＋四位數，跟訪客自己的 `GuestXXXX` 同一個格式，看起來才像同一個系統發的 */
const HANDLES = [
    'Lucky', 'Dragon', 'Jade', 'Neon', 'Koi', 'Ace', 'Orchid', 'Tiger',
    'Momo', 'Vito', 'Pearl', 'Rook', 'Sable', 'Onyx', 'Kimo', 'Rio',
];

/**
 * 下注偏好。
 *
 * 權重是照真實桌台的注量分布抓的：**莊閒吃掉絕大多數的注**，和局與對子是少數人的
 * 「幸運注」。全部等機率的話，畫面上五個注區會一樣熱鬧，但真桌永遠是中間那兩區最擠。
 */
type Taste = 'banker' | 'player' | 'chaser' | 'mixed';

const TASTE_WEIGHTS: Record<Taste, Array<[BetSpot, number]>> = {
    // 死忠押莊／押閒的人，偶爾順手押個對子
    banker: [['banker', 78], ['bankerPair', 12], ['tie', 5], ['player', 5]],
    player: [['player', 78], ['playerPair', 12], ['tie', 5], ['banker', 5]],
    // 追賠率的人：專挑和局與對子，輸多贏少但贏一次很大
    chaser: [['tie', 40], ['playerPair', 25], ['bankerPair', 25], ['banker', 5], ['player', 5]],
    mixed: [['banker', 35], ['player', 35], ['tie', 12], ['playerPair', 9], ['bankerPair', 9]],
};

const TASTES: Taste[] = ['banker', 'banker', 'player', 'player', 'mixed', 'mixed', 'chaser'];

export interface CrowdSeat {
    seat: number;
    name: string;
    tint: number;
    balance: number;
    /** 這一局押了什麼。每局開始清空 */
    bets: Bets;
    taste: Taste;
    /** 慣用面額。同一個人整局用同一種籌碼，畫面上就看得出「這個人下手很重」 */
    chip: ChipValue;
    /** 每個下注 tick 出手的機率（0~1） */
    eagerness: number;
    /** 還打算待幾局。歸零就離桌，換別人坐下 */
    staying: number;
}

export function pick<T>(list: readonly T[], rng: () => number): T {
    return list[Math.floor(rng() * list.length)];
}

/** 照權重抽一個注區。 */
function pickSpot(taste: Taste, rng: () => number): BetSpot {
    const weights = TASTE_WEIGHTS[taste];
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    let roll = rng() * total;
    for (const [spot, w] of weights) {
        roll -= w;
        if (roll <= 0) return spot;
    }
    return weights[0][0];
}

/**
 * 生一個新玩家坐上某張椅子。
 *
 * `staying` 給 4~14 局：**座位要會換人**，一整晚都是同六個名字的桌子看久了會露餡。
 * 換人也順帶讓「有人剛贏了一大筆就跑」這種真實桌上的戲碼自己發生。
 */
export function spawnSeat(seat: number, rng: () => number): CrowdSeat {
    const taste = pick(TASTES, rng);
    // 面額跟脾氣掛鉤：追賠率的人押得小（那些注很傷），押莊閒的人才敢下重手
    const chipPool: ChipValue[] =
        taste === 'chaser' ? [25, 50, 100] : rng() < 0.25 ? [500, 1000] : [50, 100, 500];

    return {
        seat,
        name: `${pick(HANDLES, rng)}${Math.floor(1000 + rng() * 9000)}`,
        tint: pick(TINTS, rng),
        balance: Math.floor(20000 + rng() * 380000),
        bets: {},
        taste,
        chip: pick(chipPool, rng),
        eagerness: 0.18 + rng() * 0.4,
        staying: 4 + Math.floor(rng() * 11),
    };
}

/** 一張椅子對外的樣子。餘額給出去是因為真實桌台的頭像旁邊就是掛著它。 */
export function toSeatInfo(seat: CrowdSeat): SeatInfo {
    return { seat: seat.seat, name: seat.name, tint: seat.tint, balance: seat.balance };
}

/**
 * 這一秒椅子上的人押了什麼。
 *
 * 一次出手押**一到三顆同面額**的籌碼，而不是一顆或一個金額。真人在真桌上就是這樣——
 * 抓一疊丟出去，不是一顆一顆放。飛起來也比較好看：三顆連著飛的節奏感是單顆做不出來的。
 */
export function seatBets(seats: CrowdSeat[], rng: () => number): OtherBet[] {
    const out: OtherBet[] = [];
    for (const seat of seats) {
        if (rng() > seat.eagerness) continue;

        const spot = pickSpot(seat.taste, rng);
        const count = 1 + Math.floor(rng() * 3);
        const amount = seat.chip * count;
        // 假人也會沒錢。不擋的話跑幾百局之後畫面上會出現餘額負幾百萬的玩家
        if (seat.balance < amount) continue;

        seat.balance -= amount;
        seat.bets[spot] = (seat.bets[spot] ?? 0) + amount;
        out.push({ seat: seat.seat, spot, chip: seat.chip, count });
    }
    return out;
}

/**
 * 這一秒線上散客押了什麼。
 *
 * 他們沒有座位也沒有餘額——**只是一股流量**。桌上大部分的注量與畫面上大部分的籌碼
 * 都來自這裡，籌碼從畫面邊緣飛進來（見 ONLINE_SEAT 的說明）。
 *
 * `heat` 讓一局之內有起伏：剛開盤零星幾筆，中段變密，倒數最後幾秒又衝一波——
 * 那個「最後五秒大家搶著押」的節奏是真桌最有辨識度的一段，平均分布做不出來。
 */
export function onlineBets(heat: number, rng: () => number): OtherBet[] {
    const out: OtherBet[] = [];
    const batches = Math.round(2 + heat * 5);

    for (let i = 0; i < batches; i++) {
        const spot = pickSpot('mixed', rng);
        // 散客用小面額的多。大額籌碼留給看得見的座位，畫面上才有輕重之分
        const chip: ChipValue = rng() < 0.72 ? pick([25, 50, 100] as ChipValue[], rng) : pick(CHIP_VALUES, rng);
        out.push({ seat: ONLINE_SEAT, spot, chip, count: 1 + Math.floor(rng() * 2) });
    }
    return out;
}

/** 把一批下注加總進各注區的總額。 */
export function applyTotals(totals: Record<BetSpot, number>, bets: OtherBet[]): void {
    for (const bet of bets) totals[bet.spot] += bet.chip * bet.count;
}

/** 一份空的總額表。每局開始重來 */
export function emptyTotals(): Record<BetSpot, number> {
    const totals = {} as Record<BetSpot, number>;
    for (const spot of BET_SPOTS) totals[spot] = 0;
    return totals;
}
