import { CHIP_VALUES, type ChipValue } from '../common/chips/atlas';
import { ONLINE_SEAT, type RouletteBet } from '../net/games/roulette';
import type { SeatInfo } from '../net/games/baccarat';
import { allBetKeys, type BetKey, type Bets } from '../games/roulette/rules';

/**
 * 輪盤桌上的其他人。
 *
 * 骨架跟 baccaratCrowd 一樣（六張椅子＋一群線上散客），但**脾氣的定義完全不同**，
 * 而那個不同正是輪盤這張桌子的長相：
 *
 * 百家樂只有五個注區，所以「脾氣」只能是押莊還是押閒。輪盤有一百多個位置，於是
 * 真實桌上會出現幾種一眼認得出來的人：只押紅黑的保守派、專押某幾個號碼的幸運數字派、
 * 把整片桌布鋪滿籌碼的鋪桌派。**這三種人在畫面上長得完全不一樣**——保守派的籌碼
 * 都疊在桌布下緣那幾塊大區，數字派的籌碼孤零零地站在格子中央。
 *
 * 沒有這個差異的話，假人會把注平均灑在 154 個位置上，桌面看起來像雜訊而不像有人在玩。
 */

export const SEAT_COUNT = 6;

const TINTS = [0xd9b871, 0xc98f7a, 0x7fa8bd, 0x86a86b, 0xb08d57, 0xa98cc0, 0xc05a5a, 0x8fb0a8];

const HANDLES = [
    'Lucky', 'Dragon', 'Jade', 'Neon', 'Koi', 'Ace', 'Orchid', 'Tiger',
    'Momo', 'Vito', 'Pearl', 'Rook', 'Sable', 'Onyx', 'Kimo', 'Rio',
];

/** 五五開的外注。保守派整晚只碰這幾格 */
const EVEN_MONEY: BetKey[] = ['red', 'black', 'odd', 'even', 'low', 'high'];
/** 賠 2 倍的區塊注 */
const BLOCKS: BetKey[] = ['dozen:0', 'dozen:1', 'dozen:2', 'column:0', 'column:1', 'column:2'];
/** 內注的母體（直注、分注、街注、角注、線注），從規則層產生而不是另抄一份 */
const INSIDE = allBetKeys().filter((k) => k.includes(':') && !k.startsWith('dozen') && !k.startsWith('column'));

/**
 * 脾氣。
 *
 * - `outside`：只押紅黑單雙大小。押得重、贏得少，桌布下緣那幾塊永遠是他們的籌碼
 * - `blocks`：押十二數與縱列，一次蓋十二個號碼
 * - `numbers`：**認定幾個幸運號碼**，整晚都押同一批。這是輪盤最有辨識度的一種玩家，
 *   所以他的號碼在 `spawnSeat` 時就抽好存起來，而不是每次出手重抽——每局換一批號碼
 *   的話，那個「他又押那幾個號碼了」的特徵就消失了
 * - `spread`：鋪桌派，內外都押，一次撒好幾個位置
 */
type Taste = 'outside' | 'blocks' | 'numbers' | 'spread';

const TASTES: Taste[] = ['outside', 'outside', 'blocks', 'numbers', 'numbers', 'spread'];

export interface CrowdSeat {
    seat: number;
    name: string;
    tint: number;
    balance: number;
    bets: Bets;
    taste: Taste;
    /** 幸運號碼（只有 `numbers` 用得到）。整晚不變 */
    lucky: BetKey[];
    chip: ChipValue;
    eagerness: number;
    staying: number;
}

export function pick<T>(list: readonly T[], rng: () => number): T {
    return list[Math.floor(rng() * list.length)];
}

/** 照脾氣挑一個下注位置 */
function pickKey(seat: Pick<CrowdSeat, 'taste' | 'lucky'>, rng: () => number): BetKey {
    switch (seat.taste) {
        case 'outside':
            return pick(EVEN_MONEY, rng);
        case 'blocks':
            return pick(BLOCKS, rng);
        case 'numbers':
            return pick(seat.lucky, rng);
        case 'spread':
            return rng() < 0.55 ? pick(INSIDE, rng) : pick([...EVEN_MONEY, ...BLOCKS], rng);
    }
}

export function spawnSeat(seat: number, rng: () => number): CrowdSeat {
    const taste = pick(TASTES, rng);
    // 押得越散、單注越小。鋪桌派一次要押五六個位置，面額跟著小下來才合理
    const chipPool: ChipValue[] =
        taste === 'outside' ? [100, 500, 1000] : taste === 'numbers' ? [25, 50, 100] : [50, 100, 500];

    const lucky: BetKey[] = [];
    const luckyCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < luckyCount; i++) lucky.push(`straight:${Math.floor(rng() * 37)}`);

    return {
        seat,
        name: `${pick(HANDLES, rng)}${Math.floor(1000 + rng() * 9000)}`,
        tint: pick(TINTS, rng),
        balance: Math.floor(20000 + rng() * 380000),
        bets: {},
        taste,
        lucky,
        chip: pick(chipPool, rng),
        eagerness: 0.2 + rng() * 0.45,
        staying: 4 + Math.floor(rng() * 11),
    };
}

export function toSeatInfo(seat: CrowdSeat): SeatInfo {
    return { seat: seat.seat, name: seat.name, tint: seat.tint, balance: seat.balance };
}

/**
 * 這一秒椅子上的人押了什麼。
 *
 * 鋪桌派一次出手押好幾個位置（那是他的特徵），其餘的一次押一處。
 */
export function seatBets(seats: CrowdSeat[], rng: () => number): RouletteBet[] {
    const out: RouletteBet[] = [];

    for (const seat of seats) {
        if (rng() > seat.eagerness) continue;

        const picks = seat.taste === 'spread' ? 2 + Math.floor(rng() * 3) : 1;
        for (let i = 0; i < picks; i++) {
            const key = pickKey(seat, rng);
            const count = seat.taste === 'outside' ? 1 + Math.floor(rng() * 3) : 1;
            const amount = seat.chip * count;
            if (seat.balance < amount) continue;

            seat.balance -= amount;
            seat.bets[key] = (seat.bets[key] ?? 0) + amount;
            out.push({ seat: seat.seat, key, chip: seat.chip, count });
        }
    }
    return out;
}

/**
 * 這一秒線上散客押了什麼。
 *
 * 他們沒有座位也沒有餘額，只是一股流量。分布刻意偏向外注與整區注（七成），
 * 因為那是真實輪盤桌上大部分的錢所在——內注押的人多，但押的錢少。
 */
export function onlineBets(heat: number, rng: () => number): RouletteBet[] {
    const out: RouletteBet[] = [];
    const batches = Math.round(2 + heat * 4);

    for (let i = 0; i < batches; i++) {
        const roll = rng();
        const key = roll < 0.45 ? pick(EVEN_MONEY, rng) : roll < 0.7 ? pick(BLOCKS, rng) : pick(INSIDE, rng);
        const chip: ChipValue = rng() < 0.72 ? pick([25, 50, 100] as ChipValue[], rng) : pick(CHIP_VALUES, rng);
        out.push({ seat: ONLINE_SEAT, key, chip, count: 1 + Math.floor(rng() * 2) });
    }
    return out;
}

/** 把一批下注加總進各位置的總額 */
export function applyTotals(totals: Bets, bets: RouletteBet[]): void {
    for (const bet of bets) totals[bet.key] = (totals[bet.key] ?? 0) + bet.chip * bet.count;
}
