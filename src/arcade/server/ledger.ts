import type { GameId } from '../net/protocol';

/**
 * 注單流水帳：**遊戲產生的每一筆下注，在這裡留下一筆不會被改的紀錄。**
 *
 * 這一層原本不存在——四款玩法各自算完賠付、更新錢包，然後那一局就消失了。
 * 對玩家來說夠用（他只在意現在有多少錢），但**營運端要的東西完全不同**：
 * 昨天這款遊戲賠了多少、某個玩家是不是一直押同一個對沖組合、
 * 三天前那局爭議單當時的餘額是多少。這些問題錢包答不出來，
 * 因為錢包只有「現在」，沒有「發生過什麼」。
 *
 * 所以注單表的第一個設計原則是 **append-only**：只增不改。
 * 結算錯了要開一筆沖正單，不是回頭去改原本那筆——原本那筆是證據。
 *
 * ---
 *
 * **為什麼欄位裡要存餘額前後？**
 * 對帳用。玩家來客訴「我明明有 500 為什麼押不下去」的時候，
 * 要能重建那一刻的錢包狀態，而不是只看得到現在的餘額。
 * 這個欄位是冗餘的（理論上可以從頭累加算出來），
 * 但**對帳資料就是要冗餘**，不然出事的時候沒有第二個來源可以互相驗證。
 *
 * **為什麼有效投注要跟下注額分開？**
 * 輪盤同時押紅跟黑，下注額是兩份，但風險幾乎是零。
 * 抽水跟返水如果照下注額算，這種對沖注就變成穩賺的套利。
 * 所以「有效投注」是另一個數字，由玩法自己決定怎麼算。
 * 這個 demo 的計法很簡化（見各 server 的呼叫點），但**欄位要在**——
 * 這是那種一開始沒留、之後補起來要動整張表的欄位。
 */

/** 一筆注單。欄位順序照真實後台的閱讀習慣排：識別 → 內容 → 金額 → 狀態 → 時間 */
export interface BetRecord {
    /** 注單號。demo 用時間戳 + 序號，真實系統會是全域唯一的發號器 */
    id: string;
    /** 局號。同一局裡的多筆注單共用，注單查詢要能用它把一局撈齊 */
    roundId: string;
    game: GameId;
    /**
     * 玩家識別。這個 demo 只有一個玩家，但欄位一定要在——
     * 少了它，之後要支援多玩家就得動整張表跟所有查詢
     */
    player: string;
    /** 注別。老虎機是 'spin'，百家樂是 'banker'/'player'/'tie'，輪盤是注別 key */
    betType: string;
    /** 下注額 */
    stake: number;
    /** 有效投注。對沖注要打折，見檔頭說明 */
    validStake: number;
    /** 派彩總額（**含本金返還**）。沒中就是 0 */
    payout: number;
    /** 淨輸贏 = payout − stake。正數是玩家贏，負數是平台贏 */
    net: number;
    balanceBefore: number;
    balanceAfter: number;
    /** 結算狀態。demo 只會產生 settled，欄位留著是因為爭議單要能標記 */
    status: 'settled' | 'void';
    betAt: number;
    settledAt: number;
}

/** 注單查詢的條件。**這組參數是照「送給後端」的形狀設計的**，理由見 query() */
export interface LedgerQuery {
    game?: GameId | 'all';
    /**
     * 只看某個玩家。**玩家頁與風控查詢的地基**——
     * 沒有這個條件，「調出這個帳號的所有注單」就得把全站的注單撈回前端再過濾
     */
    player?: string;
    /** 只看某一局。點開一筆注單要看「同一局還押了什麼」時用 */
    roundId?: string;
    /** 時間區間（毫秒時間戳），開區間都可省略 */
    from?: number;
    to?: number;
    /** 下注額下限，用來找大額注單 */
    minStake?: number;
    /** 只看贏的／只看輸的 */
    outcome?: 'all' | 'win' | 'loss';
    sortBy?: 'settledAt' | 'stake' | 'net';
    sortDir?: 'asc' | 'desc';
    /** 從 0 起算 */
    page?: number;
    pageSize?: number;
}

/** 查詢結果。**分頁一定要回總數**，否則前端算不出有幾頁 */
export interface LedgerPage {
    rows: BetRecord[];
    total: number;
    page: number;
    pageSize: number;
}

/** 彙總統計。儀表板用 */
export interface LedgerStats {
    count: number;
    totalStake: number;
    totalValidStake: number;
    totalPayout: number;
    /** 平台的淨收益 = 總下注 − 總派彩。正數代表平台贏 */
    grossWin: number;
    /**
     * 實際派彩率 = 總派彩 ÷ 總下注。
     *
     * 這個數字要跟遊戲設定的 RTP 比對。短期會偏離很遠（那是變異數不是有問題），
     * 局數夠多才會往設定值收斂——**這正是營運報表最容易被誤讀的地方**：
     * 一天的數字偏低就以為機台有問題，其實只是樣本不夠。
     */
    payoutRate: number;
    /**
     * 下注額的平方和。**這個欄位只有一個用途：算有效樣本數**
     * （見 admin/baseline.ts 的 `effectiveSample`）。
     *
     * 派彩率是按金額加權的平均，所以判斷它「偏離得算不算多」時，
     * 該用的樣本量不是注單筆數，而是 (Σstake)²/Σstake²。
     * 這個數在資料層算，是因為它要跟總和走同一趟迴圈——
     * 讓前端拿全部注單回去自己平方加總，正是這一層存在要避免的事。
     */
    totalStakeSq: number;
    byGame: Record<string, { count: number; stake: number; stakeSq: number; payout: number }>;
    /**
     * 按玩家彙總。**玩家排行、大戶監控、對沖偵測全部從這裡長出來。**
     *
     * 這裡多帶了 `validStake`，因為玩家維度最有用的一個指標是
     * **有效投注比 = 有效投注 ÷ 下注額**：正常玩家接近 1，
     * 押莊又押閒的對沖客會掉到 0.2 以下。這個比值不用另外算模型，
     * 它是既有欄位相除就得到的，而且**它是返水成本的直接來源**。
     *
     * 幾十個玩家的規模下，在這裡一次算完比讓前端逐人查詢便宜得多。
     * 真實系統上百萬個帳號時，這支要換成資料庫的 GROUP BY 加上時間區間的物化表。
     */
    byPlayer: Record<string, { count: number; stake: number; validStake: number; payout: number }>;
}

const STORAGE_KEY = 'arcade:ledger';
/**
 * 保留上限。localStorage 通常只有 5MB，一筆注單 JSON 大約 250 bytes。
 *
 * 這個數字從 8000 提到 20000，是因為展示資料從「7 天、1 個玩家」擴到
 * 「30 天、40 個玩家」——**而玩家維度一加進來，需要的樣本量就不是等比例增加的**：
 * 要看得出某個帳號的行為異常，那個帳號自己就得有夠多的注單，
 * 不是全站總筆數夠就好。
 *
 * 實測 30 天種子約 1.3 萬筆、JSON 約 3.4MB，仍在 5MB 之內但已經沒有很多餘裕。
 * 再往上加就該換 IndexedDB 了——localStorage 是同步 API，
 * 檔案再大下去，每次寫注單都會卡住主執行緒。
 *
 * 真實系統不會有這個問題（注單在資料庫裡，舊的搬去冷儲存），
 * 這個常數存在純粹是因為 demo 把「資料庫」放在瀏覽器裡。
 */
const MAX_ROWS = 20000;

/**
 * 這個 demo 的玩家識別。
 *
 * ⚠️ **已經搬到 `players.ts` 的 `SELF_ID`**，這裡只留一個轉出。
 *
 * 搬家的理由值得記一筆：這個常數原本住在注單表裡，因為當時「玩家」只是注單的一個欄位。
 * 等到真的有了玩家名冊，它就該住在名冊那邊——**注單表不該是「玩家是誰」的權威來源**，
 * 它只是引用了一個 id。留在這裡會變成兩個模組各自宣稱自己知道玩家是誰。
 */
export { SELF_ID as PLAYER_ID } from './players';

/** 跨頁廣播用的頻道。後台跟遊戲是兩個分頁，靠這個互相通知 */
export const OPS_CHANNEL = 'arcade:ops';

/** 廣播事件。ledger 只發 'bets'，設定變更由 opsConfig 發 'config' */
export type OpsMessage =
    | { kind: 'bets'; rows: BetRecord[] }
    | { kind: 'config' }
    // 資金流水的變動。訊息由 txLedger 發，ledger 這邊不處理，
    // 但型別要列在這裡——**這個聯合型別是「這條頻道上會出現什麼」的完整清單**，
    // 少列一種，下一個人就會以為自己可以安全地 switch 到 default
    | { kind: 'tx' }
    | { kind: 'cleared' };

let cache: BetRecord[] | null = null;
let seq = 0;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(rows: BetRecord[]) => void>();

/**
 * 惰性取得廣播頻道。
 *
 * 包在 try/catch 裡是因為**驗證腳本會在 Node 底下 import 到玩法 server**
 * （見 package.json 的 check:* 系列），那個環境沒有 BroadcastChannel 也沒有 localStorage。
 * 少了這層保護，跑一次 `yarn check:slot` 就會在 import 階段炸掉。
 */
function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<OpsMessage>) => {
            const msg = ev.data;
            if (msg?.kind === 'bets') {
                // 別的分頁寫進來的注單：把快取作廢，下次查詢重讀 localStorage。
                // 不直接把 msg.rows 併進快取，是因為那樣兩邊的順序可能不一致——
                // localStorage 才是唯一的真相來源，記憶體只是它的快取。
                cache = null;
                for (const fn of listeners) fn(msg.rows);
            } else if (msg?.kind === 'cleared') {
                cache = null;
                for (const fn of listeners) fn([]);
            }
        };
    } catch {
        channel = null;
    }
    return channel;
}

function load(): BetRecord[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as BetRecord[]) : [];
    } catch {
        cache = [];
    }
    return cache;
}

function save(rows: BetRecord[]): void {
    // **記憶體永遠是完整的那一份。** 這行在 try 外面是刻意的：
    // 持久化失敗是儲存層的問題，不該讓這次工作階段的資料跟著消失。
    //
    // 原本的寫法把砍半後的結果也寫回 cache，結果是——只要 localStorage 不可用
    // （Node 底下的驗證腳本、瀏覽器停用了網站資料、無痕視窗的某些設定），
    // **每寫一次注單就把記憶體裡的資料砍掉一半**。
    // 這個 bug 在正常瀏覽器裡完全看不出來，是 `yarn check:admin` 抓出來的：
    // 寫入 5 筆卻只查得到 2 筆。
    cache = rows;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
        // 可能是配額爆了。丟掉最舊的一半再試一次**持久化**——
        // 注單這種資料新的比舊的有價值，而且舊的在真實系統裡本來就會被搬去冷儲存。
        // 記憶體中的 cache 不動。
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-Math.floor(rows.length / 2))));
        } catch {
            /* 真的寫不進去就只留記憶體，不讓它影響遊戲進行 */
        }
    }
}

/** 產生注單號。時間戳 + 序號，同一毫秒內連開多筆也不會撞號 */
function nextId(now: number): string {
    seq = (seq + 1) % 100000;
    return `${now.toString(36)}-${seq.toString(36).padStart(4, '0')}`;
}

/** 產生局號。同一局的多筆注單要共用它 */
export function newRoundId(game: GameId, now = Date.now()): string {
    return `${game}-${now.toString(36)}`;
}

/** 寫入注單。**這是唯一的寫入口**，玩法 server 都走這裡 */
export function record(entries: Omit<BetRecord, 'id' | 'status'>[]): BetRecord[] {
    if (!entries.length) return [];
    const now = Date.now();
    const rows: BetRecord[] = entries.map((e) => ({ ...e, id: nextId(now), status: 'settled' as const }));

    const all = load().concat(rows);
    // 超過上限就砍最舊的
    save(all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all);

    getChannel()?.postMessage({ kind: 'bets', rows } satisfies OpsMessage);
    for (const fn of listeners) fn(rows);
    return rows;
}

/**
 * 查詢注單。
 *
 * **這個函式刻意寫成「後端該做的事」的形狀**：篩選、排序、分頁全部在這裡做完，
 * 只回一頁的資料加上總數。前端拿到 rows 就直接畫，不再過濾。
 *
 * 在 demo 裡這看起來是多餘的——資料就在同一支程式的記憶體裡，
 * 前端自己 filter 也一樣。但真實的注單表是百萬列起跳，
 * **「先全部撈回前端再過濾」在那個量級是直接讓瀏覽器死掉的做法**，
 * 而這種寫法在資料量小的時候完全看不出問題，等資料長大才爆。
 * 所以形狀從一開始就照對的來，之後把這支函式換成 API 呼叫，前端一行都不用改。
 */
export function query(q: LedgerQuery = {}): LedgerPage {
    const {
        game = 'all',
        player,
        roundId,
        from,
        to,
        minStake,
        outcome = 'all',
        sortBy = 'settledAt',
        sortDir = 'desc',
        page = 0,
        pageSize = 25,
    } = q;

    let rows = load();

    if (game !== 'all') rows = rows.filter((r) => r.game === game);
    if (player) rows = rows.filter((r) => r.player === player);
    if (roundId) rows = rows.filter((r) => r.roundId === roundId);
    if (from != null) rows = rows.filter((r) => r.settledAt >= from);
    if (to != null) rows = rows.filter((r) => r.settledAt <= to);
    if (minStake != null) rows = rows.filter((r) => r.stake >= minStake);
    if (outcome === 'win') rows = rows.filter((r) => r.net > 0);
    else if (outcome === 'loss') rows = rows.filter((r) => r.net < 0);

    // 排序前先複製：load() 回的是快取本體，就地排序會把儲存順序也改掉，
    // 而儲存順序是「寫入先後」，那是注單表唯一不該被查詢條件動到的東西
    const sorted = rows.slice().sort((a, b) => {
        const d = a[sortBy] - b[sortBy];
        return sortDir === 'asc' ? d : -d;
    });

    const total = sorted.length;
    const start = page * pageSize;
    return { rows: sorted.slice(start, start + pageSize), total, page, pageSize };
}

/** 彙總。條件跟 query 共用，所以報表跟明細**永遠是同一組篩選算出來的** */
export function stats(q: LedgerQuery = {}): LedgerStats {
    // 借用 query 的篩選但不分頁：pageSize 給一個大數，避免兩邊的篩選邏輯各寫一份而走鐘
    const all = query({ ...q, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows;

    const byGame: LedgerStats['byGame'] = {};
    const byPlayer: LedgerStats['byPlayer'] = {};
    let totalStake = 0;
    let totalStakeSq = 0;
    let totalValidStake = 0;
    let totalPayout = 0;

    for (const r of all) {
        totalStake += r.stake;
        totalStakeSq += r.stake * r.stake;
        totalValidStake += r.validStake;
        totalPayout += r.payout;
        const g = (byGame[r.game] ??= { count: 0, stake: 0, stakeSq: 0, payout: 0 });
        g.count++;
        g.stake += r.stake;
        g.stakeSq += r.stake * r.stake;
        g.payout += r.payout;

        const p = (byPlayer[r.player] ??= { count: 0, stake: 0, validStake: 0, payout: 0 });
        p.count++;
        p.stake += r.stake;
        p.validStake += r.validStake;
        p.payout += r.payout;
    }

    return {
        count: all.length,
        totalStake,
        totalStakeSq,
        totalValidStake,
        totalPayout,
        grossWin: totalStake - totalPayout,
        payoutRate: totalStake > 0 ? totalPayout / totalStake : 0,
        byGame,
        byPlayer,
    };
}

/** 訂閱注單寫入（自己這一頁寫的、或別的分頁廣播過來的都會通知） */
export function subscribe(fn: (rows: BetRecord[]) => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 清空。後台的「清除資料」用，會廣播讓遊戲那一頁也知道 */
export function clear(): void {
    save([]);
    getChannel()?.postMessage({ kind: 'cleared' } satisfies OpsMessage);
}

/** 目前筆數。種子資料要判斷「空的才灌」 */
export function count(): number {
    return load().length;
}
