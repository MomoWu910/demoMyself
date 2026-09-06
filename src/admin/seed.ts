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
import type { GameId } from '../arcade/net/protocol';
import { BaccaratShoe } from '../arcade/server/baccaratShoe';
import { buildRecords, netExposureValidStake, type PendingBet } from '../arcade/server/betSlip';
import * as audit from '../arcade/server/auditLog';
import { can } from '../arcade/server/auth';
import { clear as clearLedger, count, record, type BetRecord } from '../arcade/server/ledger';
import { forGame } from '../arcade/server/opsConfig';
import {
    clear as clearPlayers,
    count as playerCount,
    SELF_ID,
    seedPlayers,
    type Player,
    type PlayerProfile,
} from '../arcade/server/players';
import { SlotServer } from '../arcade/server/slotServer';
import {
    clear as clearTx,
    count as txCount,
    rebateFor,
    record as recordTx,
    type Transaction,
} from '../arcade/server/txLedger';
import { Wallet } from '../arcade/server/wallet';

/**
 * 種子資料：後台第一次打開時，把過去三十天的營運資料灌進去。
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
 * ---
 *
 * **第二個決定：玩家不是一個人，是四十個有不同行為的帳號。**
 *
 * 第一版只有一個玩家（`demo-player`），注單表的 `player` 欄位存在但只有一個值。
 * 那份資料能撐起「注單查詢」與「派彩率報表」，但**營運後台真正的問題全部問不出來**：
 * 誰輸最多、哪個帳號的有效投注比低到不合理、誰註冊三天就提領五次。
 * 這些不是還沒做的畫面，是資料結構上算不出來的東西。
 *
 * 所以這一版的種子先造人、再讓人去玩。每個帳號有自己的
 * 錢包、籌碼習慣、玩法偏好與活躍度（見 `PERSONA`），
 * 而且**其中有幾個是故意來刷返水的**——後台要有辦法把他們認出來，
 * 才叫做風控。
 *
 * ---
 *
 * **第三個決定：錢的進出另外記一張表。**
 *
 * 上一版玩家快輸光時直接 `wallet.credit()` 補值，那筆錢憑空出現。
 * 報表上的後果是：平台看得到「玩家輸了多少」，卻看不到「玩家存了多少」，
 * 而**後者才是平台真正收到的錢**。這一版每一次儲值、提領、返水都會寫進
 * `txLedger`，於是對帳等式才成立：期初 + 交易 + 注單淨輸贏 = 期末。
 *
 * ---
 *
 * 唯一被動手腳的仍然是時間戳。種子是在打開頁面的那一瞬間跑完的，
 * 但後台要展示的是「過去三十天」，所以 `settledAt` 由這裡指定
 * （見 arcade/server/betSlip.ts 的 `BuildOptions.settledAt`）。
 */

const DAYS = 30;
/**
 * 全站每天的局數上下限。不是固定值，浮動一點才像真的營運資料。
 *
 * 這個數字乘上天數就是資料量，而**資料量有一個真實的天花板**：
 * 注單存在 localStorage（見 ledger 的 `MAX_ROWS`），一筆約 250 bytes。
 * 30 天 × 330 局 × 每局平均 1.3 筆 ≈ 1.3 萬筆 ≈ 3.4MB，這已經逼近可用的餘裕。
 * 要再往上加就得先換掉儲存層。
 */
const ROUNDS_PER_DAY = { min: 260, max: 400 };

/** 玩家人數。四十個是「排行榜看得出梯度、但玩家頁一頁還放得下」的量 */
const PLAYER_COUNT = 40;

/* ────────────────────────────── 玩家 ────────────────────────────── */

/**
 * 暱稱字庫。兩段式組合，`夜行的鶴`、`安靜的錨`。
 *
 * 用組合而不是一份寫死的名單，是因為四十個名字要手寫太蠢；
 * 用意象詞而不是人名，是因為**展示資料裡不該出現看起來像真人的名字**——
 * 那是最容易被誤會成真實個資的東西。
 */
const NICK_HEAD = [
    '夜行', '安靜', '緩慢', '早起', '遠方', '無風', '第七', '半場',
    '逆流', '晴天', '深水', '小數', '斜線', '長考', '空城', '北向',
    '單邊', '零度', '午後', '灰色',
];
const NICK_TAIL = [
    '鶴', '錨', '燈塔', '渡口', '沙丘', '鐘擺', '棋手', '信號',
    '潮汐', '座標', '骨牌', '折線', '風箏', '碼頭', '罐頭', '螺旋',
    '琥珀', '柵欄', '磁鐵', '殘局',
];

/**
 * 每種分型的行為參數。**這張表是整份展示資料的形狀來源。**
 *
 * 為什麼要分型而不是讓每個玩家隨機取參數：因為隨機取出來的四十個帳號
 * 會全部長得差不多（大數法則會把他們拉向平均），
 * 而**營運後台的價值正好在於看出「不一樣的那幾個」**。
 * 沒有大戶就看不出單一帳號如何拉歪當日派彩率，
 * 沒有對沖客就沒有東西可以被風控抓到。
 */
interface Persona {
    /** 活躍度權重。抽「這一局是誰在玩」時用 */
    weight: number;
    /** 常用籌碼面額。重複的面額代表更常用 */
    chips: number[];
    /** 玩法偏好的累積機率門檻：[slot, baccarat, baccaratLive]，其餘歸輪盤 */
    mix: [number, number, number];
    /**
     * 初始餘額，也是每次儲值的基準金額。
     *
     * **這個數字要小到讓錢包真的會見底。** 第一版給得太寬裕（一般玩家三萬），
     * 結果是三十天玩下來餘額幾乎沒動——沒有人需要儲值，也沒有人贏到想提款，
     * 於是金流表裡只剩下四十筆開戶儲值，`deposit`／`withdraw` 兩個功能
     * 都沒有資料可以展示。**那不是功能少寫了，是參數把它餓死了。**
     *
     * 順帶一提，這個數字還會**從錢包漏到注單上**：注單有一欄「結算後餘額」，
     * 給一個五千萬的初始值，那一欄就會印出 49,991,687，
     * 一眼就看得出不是真的玩家。注單裡的餘額是拿來對帳的欄位，
     * 它不合理的話整張表的可信度就沒了。
     */
    balance: number;
    /** VIP 等級範圍 */
    vip: [number, number];
    /**
     * 是否對沖下注。true 的話百家樂會同時押莊閒、輪盤同時押紅黑——
     * 下注額很大但 `netExposureValidStake` 算出來的有效投注趨近於零
     */
    hedge: boolean;
}

const PERSONA: Record<PlayerProfile, Persona> = {
    // 大戶：注額是別人的十倍，局數不多。單一個人就能把當日的派彩率拉歪
    whale: { weight: 1.2, chips: [500, 500, 1000, 1000, 2500], mix: [0.08, 0.6, 0.85], balance: 12_000, vip: [4, 5], hedge: false },
    regular: { weight: 2.0, chips: [10, 25, 25, 50, 50, 100], mix: [0.4, 0.65, 0.77], balance: 900, vip: [1, 3], hedge: false },
    casual: { weight: 0.7, chips: [5, 5, 10, 10, 25], mix: [0.6, 0.75, 0.8], balance: 250, vip: [0, 1], hedge: false },
    // 苦工：幾乎只轉老虎機，注額小但局數是別人的兩倍。返水對他是主要收入
    grinder: { weight: 4.0, chips: [5, 10, 10], mix: [0.95, 0.97, 0.98], balance: 300, vip: [2, 3], hedge: false },
    // 對沖客：押莊又押閒。下注額進了報表，風險卻留在門外。
    // 他的餘額最穩——對沖幾乎不輸錢，所以他很少需要儲值，這件事本身就是個訊號
    hedger: { weight: 1.2, chips: [50, 100, 100, 250], mix: [0.05, 0.45, 0.7], balance: 4_000, vip: [3, 4], hedge: true },
};

/** 名冊的組成。刻意不是均勻分布——真實平台就是少數人貢獻多數流水 */
const ROSTER: [PlayerProfile, number][] = [
    ['whale', 3],
    ['hedger', 4],
    ['grinder', 6],
    ['regular', 15],
    ['casual', 12],
];

/** 種子跑的時候，一個玩家隨身帶的東西 */
interface Actor {
    player: Player;
    persona: Persona;
    wallet: Wallet;
    /** 這個帳號自己的老虎機實例。錢包綁在建構子上，所以不能共用 */
    slot: SlotServer;
    /** 當日累計有效投注。日終結算返水用，結算完歸零 */
    dailyValid: number;
    /** 這個帳號今天下過注沒有。沒下注就不該有返水單 */
    playedToday: boolean;
}

/* ────────────────────────────── 亂數 ────────────────────────────── */

function pick<T>(arr: readonly T[], rnd: () => number): T {
    return arr[(rnd() * arr.length) | 0];
}

/**
 * 抽一個注額，**並夾進這款玩法當下的限紅區間**。
 *
 * 這一步是後來補的，補之前種子產生過一批**在真實遊戲裡根本押不進去的注單**：
 * 大戶的籌碼裡有 2500，而四款玩法的單注上限都是 1000。
 * 遊戲端會被 `checkBet()` 擋下來（限紅檢查在封包層），
 * 但種子是直接呼叫 `spin()` 與 `settleBets()` 的，繞過了那一層。
 *
 * 後果不只是「資料不真實」這種抽象的問題，它在報表上是看得見的：
 * 老虎機的派彩率掉到 72%，比理論值低了二十個百分點。
 * 原因是大戶只轉了二十幾局、每局押 2500，
 * **少數幾筆超大注把整款玩法的變異數放大了一個量級**，
 * 而那幾筆本來就不該存在。
 *
 * 所以注額要向營運設定看齊。附帶的好處是：把限紅調小再重新產生資料，
 * 歷史注單會跟著變——後台跟遊戲之間那條線，在種子這一端也接上了。
 */
function chipFor(chips: readonly number[], game: GameId, rnd: () => number): number {
    const ops = forGame(game);
    return Math.min(Math.max(pick(chips, rnd), ops.minBet), ops.maxBet);
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
type Row = Omit<BetRecord, 'id' | 'seq' | 'status'>;
/** 一筆交易（還沒發號） */
type Tx = Omit<Transaction, 'id' | 'seq'>;

/* ────────────────────────────── 各玩法 ────────────────────────────── */

/** 老虎機：真的轉，真的算連線 */
function seedSlot(actor: Actor, at: number, rnd: () => number): Row[] {
    const bet = chipFor(actor.persona.chips, 'slot', rnd);
    const balanceBefore = actor.wallet.get();
    const res = actor.slot.spin(bet);
    if ('error' in res) return [];

    return [
        {
            roundId: `slot-${at.toString(36)}-${actor.player.id}`,
            game: 'slot',
            player: actor.player.id,
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

/**
 * 百家樂：真的牌靴、真的補牌規則、真的賠付。
 *
 * **同一張桌的不同玩家共用一個牌靴，這是對的**——他們本來就坐在同一張桌上看同一副牌。
 * 不能共用的是**兩張不同的桌**，那個坑記在 `generate()` 裡。
 */
function seedBaccarat(
    game: 'baccarat' | 'baccaratLive',
    actor: Actor,
    at: number,
    rnd: () => number,
    shoe: BaccaratShoe,
): Row[] {
    const draw = shoe.draw();
    const { chips, hedge } = actor.persona;

    // 對沖客同時押莊閒，金額接近但不完全相同（完全相同太容易被規則式偵測抓到，
    // 真實的對沖玩家會刻意錯開一點）
    let spots: BetSpot[];
    if (hedge) {
        spots = ['banker', 'player'];
    } else {
        spots = rnd() < 0.5 ? ['banker'] : ['player'];
        // 押 1~2 個注區，偶爾押和或對子——這是真實牌桌的下注分布
        if (rnd() < 0.18) spots.push(pick(['tie', 'playerPair', 'bankerPair'] as const, rnd));
    }

    const base = chipFor(chips, game, rnd);
    const ops = forGame(game);
    const pending: PendingBet[] = [];
    const bets: BaccaratBets = {};
    for (const spot of spots) {
        // 對沖的兩邊金額要接近，所以用同一個 base 加減一階；一般玩家每個注區各抽
        const amount = hedge ? base + (rnd() < 0.5 ? 0 : base * 0.1) : chipFor(chips, game, rnd);
        const rounded = Math.min(Math.max(Math.round(amount), ops.minBet), ops.maxBet);
        const balanceBefore = actor.wallet.get();
        if (!actor.wallet.debit(rounded)) continue;
        pending.push({ spot, amount: rounded, betAt: at - 8000, balanceBefore });
        bets[spot] = (bets[spot] ?? 0) + rounded;
    }
    if (!pending.length) return [];

    const payouts = settleBaccarat(bets, draw.round);
    actor.wallet.credit(BET_SPOTS.reduce((s, spot) => s + payouts[spot], 0));

    return buildRecords(game, `${game}-${at.toString(36)}-${actor.player.id}`, pending, payouts, {
        settledAt: at,
        player: actor.player.id,
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
function seedRoulette(actor: Actor, at: number, rnd: () => number, keys: RouletteKeys): Row[] {
    const winning = pick(WHEEL_ORDER, rnd);
    const { chips, hedge } = actor.persona;

    const pending: PendingBet[] = [];
    const bets: RouletteBets = {};

    /** 押一注。餘額不夠就跳過——真實系統也是這樣，押不進去就是押不進去 */
    const put = (key: string, amount: number): void => {
        const balanceBefore = actor.wallet.get();
        if (!actor.wallet.debit(amount)) return;
        pending.push({ spot: key, amount, betAt: at - 12000, balanceBefore });
        bets[key] = (bets[key] ?? 0) + amount;
    };

    if (hedge) {
        // 紅黑各押一份。除了開到零號的那 2.7%，這一局的淨輸贏是零
        const amount = chipFor(chips, 'roulette', rnd);
        put('red', amount);
        put('black', amount);
    } else {
        // 輪盤玩家通常一局押好幾注
        const n = 1 + ((rnd() * 4) | 0);
        for (let i = 0; i < n; i++) {
            // 八成押外注、兩成押內注。這個比例不只是「像不像真的」的問題：
            // 內注賠 35 倍，比例每多一成，整款玩法的派彩率變異就大一截，
            // 而展示資料的樣本量撐不起那個變異——報表會一直亮黃燈
            put(pick(rnd() < 0.8 ? keys.outside : keys.inside, rnd), chipFor(chips, 'roulette', rnd));
        }
    }
    if (!pending.length) return [];

    const payouts = settleRoulette(bets, winning);
    actor.wallet.credit(Object.values(payouts).reduce((s, v) => s + v, 0));

    return buildRecords('roulette', `roulette-${at.toString(36)}-${actor.player.id}`, pending, payouts, {
        settledAt: at,
        player: actor.player.id,
        validStakeOf: netExposureValidStake,
    });
}

/* ────────────────────────────── 對外 ────────────────────────────── */

/**
 * 後台開啟時呼叫。已經有資料就什麼都不做。
 *
 * **判斷條件是「三張表都有東西」，不是只看注單。**
 *
 * 這一條是為了處理一種真實會發生的情況：舊版的後台只寫注單表，
 * 所以瀏覽器裡可能存著一批**玩家欄全是 `demo-player`、而且沒有任何金流**的注單。
 * 只看注單筆數的話，那批舊資料會讓種子永遠不重灌，
 * 使用者看到的是一個玩家頁空白、金流頁空白、但注單有一萬筆的後台——
 * 而那看起來像功能壞了，不像資料是舊的。
 *
 * 版本升級後第一次打開就重灌，是這個 demo 能做的最誠實的處理。
 * 真實系統這裡會是一支資料庫 migration。
 */
export function seedIfEmpty(): number {
    if (count() > 0 && playerCount() > 0) return 0;
    return seed();
}

/**
 * 產生並寫入三張表，回傳注單筆數。
 *
 * **順序有意義**：先寫玩家名冊，再寫注單與交易。
 * 反過來的話，中間那一瞬間注單裡的 `player` 會指向不存在的帳號，
 * 而後台如果剛好在那時候重繪，玩家欄會是一片空白。
 */
export function seed(): number {
    if (!can('data.manage')) return 0;

    const { players, bets, transactions } = generate();
    clearPlayers();
    clearTx();
    seedPlayers(players);
    recordTx(transactions);
    record(bets);

    audit.record({
        action: 'data.seed',
        target: 'seed',
        targetLabel: '展示資料',
        changes: [],
        note: `重新產生 ${bets.length} 筆注單、${players.length} 個帳號、${transactions.length} 筆交易`,
    });
    return bets.length;
}

/**
 * 清空展示資料。
 *
 * **三張表一起清，而且不清稽核。**
 *
 * 一起清是因為只清注單的話，玩家名冊會留下四十個「一筆注單都沒有」的帳號，
 * 而金流表裡還有他們的返水——那是比空資料更難解釋的狀態。
 *
 * 不清稽核是刻意的，而且這正是稽核表的用途：
 * **資料被清掉之後，「是誰清的、什麼時候清的」還在。**
 * 一個會被同一個按鈕清掉的稽核紀錄，等於沒有稽核。
 *
 * 包成一支函式而不是讓頁面呼叫三個 clear，是為了讓留痕發生在資料層——
 * 理由同 auditLog 的檔頭：記錄要寫在唯一入口裡。
 */
export function clearAll(): void {
    if (!can('data.manage')) return;

    const before = { bets: count(), players: playerCount(), tx: txCount() };
    clearLedger();
    clearPlayers();
    clearTx();

    audit.record({
        action: 'data.clear',
        target: 'all',
        targetLabel: '展示資料',
        changes: [],
        note: `清空 ${before.bets} 筆注單、${before.players} 個帳號、${before.tx} 筆交易`,
    });
}

export interface GenerateOptions {
    days?: number;
    roundsPerDay?: { min: number; max: number };
    seed?: number;
    playerCount?: number;
}

export interface GenerateResult {
    players: Player[];
    bets: Row[];
    transactions: Tx[];
}

/** 建名冊。回傳的順序就是 `p-0001` 起算的編號順序 */
function buildActors(rnd: () => number, now: number, playerCount: number): Actor[] {
    const actors: Actor[] = [];
    const usedNick = new Set<string>();

    /** 照 ROSTER 的比例展開成一串分型，人數不足或超過時按比例縮放 */
    const profiles: PlayerProfile[] = [];
    const total = ROSTER.reduce((s, [, n]) => s + n, 0);
    for (const [profile, n] of ROSTER) {
        const scaled = Math.max(1, Math.round((n / total) * playerCount));
        for (let i = 0; i < scaled; i++) profiles.push(profile);
    }
    while (profiles.length > playerCount) profiles.pop();
    while (profiles.length < playerCount) profiles.push('regular');

    profiles.forEach((profile, i) => {
        const persona = PERSONA[profile];

        // 暱稱要唯一。撞名就重抽，抽不到就補編號——後台的玩家欄位靠它辨識，
        // 兩個同名帳號會讓「這是誰」變成一個要點進去才知道的問題
        let nickname = '';
        for (let tries = 0; tries < 30 && (!nickname || usedNick.has(nickname)); tries++) {
            nickname = `${pick(NICK_HEAD, rnd)}的${pick(NICK_TAIL, rnd)}`;
        }
        if (usedNick.has(nickname)) nickname = `${nickname}${i}`;
        usedNick.add(nickname);

        const [vipMin, vipMax] = persona.vip;
        const player: Player = {
            id: `p-${String(i + 1).padStart(4, '0')}`,
            nickname,
            vipLevel: vipMin + ((rnd() * (vipMax - vipMin + 1)) | 0),
            // 種子產生的帳號一律 active。**凍結是後台的決定，不是資料的初始狀態**——
            // 預先塞一個凍結帳號進去，會讓「這個功能有在運作」變成無法驗證的事
            status: 'active',
            // 標記也一律留空。對沖客要靠後台自己從有效投注比算出來，
            // 種子先標好的話，那個頁面就只是在顯示答案而不是在做風控
            tags: [],
            note: '',
            // 註冊時間散在過去一年內，且一定早於資料區間的開始
            registeredAt: now - (40 + Math.floor(rnd() * 320)) * 86_400_000,
            profile,
        };

        const wallet = new Wallet(0);
        actors.push({
            player,
            persona,
            wallet,
            slot: new SlotServer(wallet, rnd),
            dailyValid: 0,
            playedToday: false,
        });
    });

    return actors;
}

/**
 * 只產生、不寫入。
 *
 * 拆出來是為了讓 `rtp-baseline.mjs` 能在 Node 底下跑同一套產生邏輯，
 * 只是把規模放大幾百倍去算期望值。**基準線必須跟畫面上的資料同源**——
 * 如果基準是查來的、資料是這裡跑的，兩邊對不起來的時候就不知道是誰錯了。
 */
export function generate(opts: GenerateOptions = {}): GenerateResult {
    const days = opts.days ?? DAYS;
    const perDay = opts.roundsPerDay ?? ROUNDS_PER_DAY;
    const playerCount = opts.playerCount ?? PLAYER_COUNT;
    const rnd = seededRandom(opts.seed ?? 20260907);

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

    const actors = buildActors(rnd, now, playerCount);

    /**
     * 遊戲端登入中的那個帳號也放進名冊。
     *
     * 他沒有歷史注單（那是「你」，還沒開始玩），但**必須存在於玩家表裡**，
     * 否則你在遊樂場下的第一注，注單的玩家欄會指向一個查無此人的 id。
     */
    const selfWallet = new Wallet(0);
    const self: Actor = {
        player: {
            id: SELF_ID,
            nickname: '你（本機帳號）',
            vipLevel: 1,
            status: 'active',
            tags: [],
            note: '遊樂場那一頁正在使用的帳號。在遊戲裡下注，注單會即時進到這張表',
            registeredAt: now - 3 * dayMs,
            profile: 'regular',
        },
        persona: PERSONA.regular,
        wallet: selfWallet,
        slot: new SlotServer(selfWallet, rnd),
        dailyValid: 0,
        playedToday: false,
    };

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
     *
     * 反過來說，**同一張桌的不同玩家共用一靴是正確的**，他們本來就在看同一副牌。
     */
    const shoes = {
        baccarat: new BaccaratShoe(rnd),
        baccaratLive: new BaccaratShoe(rnd),
    };
    // 輪盤的注別 key 有一百多種，先分好內外注重複用，不必每局重算
    const rouletteKeys = splitRouletteKeys();

    const bets: Row[] = [];
    const txs: Tx[] = [];

    /** 開戶儲值。每個帳號的第一筆錢，時間點在他註冊的那一天 */
    for (const a of actors) {
        const amount = a.persona.balance;
        txs.push({
            player: a.player.id,
            kind: 'deposit',
            amount,
            balanceBefore: 0,
            balanceAfter: amount,
            status: 'done',
            ref: `open-${a.player.id}`,
            note: '開戶儲值',
            createdAt: a.player.registeredAt + 3600_000,
            reviewedAt: 0,
        });
        a.wallet.credit(amount);
    }

    /** 按活躍度權重抽一個玩家。權重高的被抽中的機率高，這就是「常客」的意思 */
    const totalWeight = actors.reduce((s, a) => s + a.persona.weight, 0);
    const pickActor = (): Actor => {
        let r = rnd() * totalWeight;
        for (const a of actors) {
            r -= a.persona.weight;
            if (r <= 0) return a;
        }
        return actors[actors.length - 1];
    };

    /** 儲值。餘額見底時補，寫成一筆真的交易而不是憑空 credit */
    const topUp = (a: Actor, at: number): void => {
        const balanceBefore = a.wallet.get();
        // 補的金額按分型的基準浮動，不是每次都補一樣多
        const amount = Math.round(a.persona.balance * (0.5 + rnd()));
        a.wallet.credit(amount);
        txs.push({
            player: a.player.id,
            kind: 'deposit',
            amount,
            balanceBefore,
            balanceAfter: balanceBefore + amount,
            status: 'done',
            ref: `dep-${at.toString(36)}`,
            note: '',
            createdAt: at,
            reviewedAt: 0,
        });
    };

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
            const actor = pickActor();

            // 押不動就先儲值。門檻取自己最大籌碼的三倍，因為大戶的「見底」
            // 跟休閒玩家的「見底」不是同一個數字——用一個全站共用的固定值，
            // 不是讓大戶永遠不必儲值，就是讓小玩家每一局都在儲值
            const floor = Math.max(...actor.persona.chips) * 2;
            if (actor.wallet.get() < floor) topUp(actor, at - 60_000);

            const roll = rnd();
            const [mSlot, mBac, mLive] = actor.persona.mix;
            let produced: Row[];
            if (roll < mSlot) produced = seedSlot(actor, at, rnd);
            else if (roll < mBac) produced = seedBaccarat('baccarat', actor, at, rnd, shoes.baccarat);
            else if (roll < mLive) produced = seedBaccarat('baccaratLive', actor, at, rnd, shoes.baccaratLive);
            else produced = seedRoulette(actor, at, rnd, rouletteKeys);

            if (produced.length) {
                actor.playedToday = true;
                for (const r of produced) actor.dailyValid += r.validStake;
            }
            bets.push(...produced);
        }

        /**
         * 日終結算。
         *
         * **返水在隔天凌晨結算，不是即時給的**——這是真實平台的做法，
         * 因為要等當日所有注單都落地才算得準。時間戳給隔天 00:05，
         * 於是報表上會看到一批集中在凌晨的返水單，那個形狀本身就是對的。
         */
        const settleAt = dayStart + dayMs + 300_000;
        for (const a of actors) {
            if (!a.playedToday) continue;

            const amount = rebateFor(a.dailyValid, a.player.vipLevel);
            a.dailyValid = 0;
            a.playedToday = false;
            // 未來的返水不記。跑到今天的時候，明天凌晨的那一批還沒發生
            if (amount <= 0 || settleAt > now) continue;

            const balanceBefore = a.wallet.get();
            a.wallet.credit(amount);
            txs.push({
                player: a.player.id,
                kind: 'rebate',
                amount,
                balanceBefore,
                balanceAfter: balanceBefore + amount,
                status: 'done',
                ref: `rb-${new Date(dayStart).toISOString().slice(0, 10)}`,
                note: `${new Date(dayStart).toISOString().slice(0, 10)} 有效投注返水`,
                createdAt: settleAt,
                reviewedAt: 0,
            });
        }

        /**
         * 提領。贏到一定程度才會有人想領錢，所以門檻掛在「餘額超過基準的一倍半」。
         *
         * **最近兩天的申請留在 pending**：早期的都審完了，
         * 而後台的「待審提領」如果永遠是空的，那個功能就沒有東西可以展示——
         * 但更重要的是，真實的後台早上打開來本來就該有幾筆在等。
         */
        for (const a of actors) {
            if (rnd() > 0.12) continue;
            const balance = a.wallet.get();
            // 贏到帶進場的錢的一倍二就有人想落袋。這個門檻不是憑感覺挑的：
            // 定得太高（例如兩倍）整整三十天只會有零星幾筆提領，
            // 待審佇列永遠是空的，而那不是「這個平台沒人提款」，是參數把它關掉了
            if (balance < a.persona.balance * 1.2) continue;

            const amount = Math.round((balance - a.persona.balance) * (0.3 + rnd() * 0.5));
            if (amount < 100) continue;
            if (!a.wallet.debit(amount)) continue;

            const createdAt = dayStart + dayMs * 0.6;
            if (createdAt > now) continue;
            // 最後三天的申請留在待審。窗口開太窄（只留最後一天）會讓待審佇列
            // 隨機變成空的——那是參數的問題，不是「今天剛好沒人提款」
            const stillPending = d <= 3;
            // 早期的申請裡有一小部分被退件。退件本身是風控訊號，
            // 一個帳號被退過幾次，是後台看得到的事
            const rejected = !stillPending && rnd() < 0.12;

            txs.push({
                player: a.player.id,
                kind: 'withdraw',
                // 出帳記負數。見 txLedger 檔頭：balanceAfter = balanceBefore + amount 要恆成立
                amount: -amount,
                balanceBefore: balance,
                balanceAfter: balance - amount,
                status: stillPending ? 'pending' : rejected ? 'rejected' : 'done',
                ref: `wd-${createdAt.toString(36)}`,
                note: rejected ? '出金帳戶與註冊姓名不符，退件' : '',
                createdAt,
                reviewedAt: stillPending ? 0 : createdAt + 3600_000 * (1 + rnd() * 6),
            });

            if (rejected) {
                // 退件要把錢還回去，而且是**另外一筆交易**——原單留著當證據。
                // 這跟 txLedger.review() 的處理一致，兩邊不一致的話
                // 種子產生的資料就跟後台操作產生的資料長得不一樣
                const back = a.wallet.get();
                a.wallet.credit(amount);
                txs.push({
                    player: a.player.id,
                    kind: 'adjust',
                    amount,
                    balanceBefore: back,
                    balanceAfter: back + amount,
                    status: 'done',
                    ref: `wd-${createdAt.toString(36)}`,
                    note: '提領退件退款',
                    createdAt: createdAt + 3600_000 * 7,
                    reviewedAt: createdAt + 3600_000 * 7,
                });
            }
        }
    }

    // 照時間排好再回傳。兩張表的儲存順序就是寫入順序，
    // 亂序寫進去的話，「最新的在最後面」這個前提就不成立了
    bets.sort((a, b) => a.settledAt - b.settledAt);
    txs.sort((a, b) => a.createdAt - b.createdAt);

    return {
        players: actors.map((a) => a.player).concat(self.player),
        bets,
        transactions: txs,
    };
}
