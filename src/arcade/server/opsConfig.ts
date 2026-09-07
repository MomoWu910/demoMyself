import type { GameId } from '../net/protocol';
import * as audit from './auditLog';
import { can } from './auth';

/**
 * 玩法的顯示名。**稽核紀錄要存顯示名而不是 id**——
 * 三年後查紀錄的人不一定知道 `baccaratLive` 是哪一款
 * （見 auditLog 檔頭：稽核紀錄必須能獨立閱讀）。
 *
 * 這份對照跟 admin/format.ts 的 `GAME_LABEL` 內容一樣但故意各存一份：
 * 那一份是**顯示層**的，會跟著 i18n 走；這一份是**寫進紀錄裡**的，
 * 一旦寫下去就不該再變。
 */
const GAME_LABEL: Record<GameId, string> = {
    slot: '幸運轉輪',
    baccarat: '百家樂',
    baccaratLive: '視訊百家樂',
    roulette: '輪盤',
};
import { OPS_CHANNEL, type OpsMessage } from './ledger';

/**
 * 營運設定：**後台寫、遊戲讀**的那一組值。
 *
 * 這是整個後台跟遊戲之間唯一的接觸面。後台改一個限紅，遊戲那一端就真的押不進去；
 * 後台把一款遊戲切成維護中，玩家就真的進不去。
 *
 * 這一層存在的意義不是「多一個設定檔」，而是**把哪些值可以被營運改、
 * 哪些值是程式的一部分，這條線畫清楚**。
 * 賠率表不在這裡（那是玩法規則，改了等於換一款遊戲），
 * 限紅跟開關在這裡（那是營運每天在動的東西）。
 * 這條線畫錯的代價很具體：畫太寬，營運一個手滑就能改掉遊戲的數學模型；
 * 畫太窄，每次調限紅都要工程師改 code 重新部署。
 *
 * ---
 *
 * **為什麼設定要有版本號？**
 * 因為它會被兩個地方改（後台的表單、還原預設值），而讀它的是另一個分頁。
 * 版本號讓讀的那一端知道「這是不是我已經套過的那一份」，
 * 而不是每次收到廣播都無條件重套一次。
 *
 * **為什麼維護模式跟上下架要分開？**
 * 上下架是產品決策（這款遊戲不賣了），維護是臨時狀態（在修，等一下回來）。
 * 兩者對玩家要顯示的訊息不同，對報表的處理也不同——
 * 維護中的遊戲當天還是會有注單，下架的不會。
 */

/** 單一玩法的營運設定 */
export interface GameOps {
    /** 上下架。false = 大廳不顯示 */
    enabled: boolean;
    /** 維護模式。大廳顯示得到但進不去 */
    maintenance: boolean;
    /** 單注下限 */
    minBet: number;
    /** 單注上限（限紅）。**這是後台最常被動的一個值** */
    maxBet: number;
}

export interface OpsConfig {
    /** 每次寫入都會 +1。讀的那一端用它判斷要不要重套 */
    version: number;
    games: Record<GameId, GameOps>;
}

/**
 * 預設值。
 *
 * 限紅刻意設得寬（單注上限 1000，開場餘額才 10000），
 * 因為 demo 的重點是**改下去會生效**，不是限得多嚴。
 * 面試時把上限調到 100，當場就能看到遊戲那邊押不進去。
 */
const DEFAULTS: OpsConfig = {
    version: 1,
    games: {
        slot: { enabled: true, maintenance: false, minBet: 5, maxBet: 1000 },
        baccarat: { enabled: true, maintenance: false, minBet: 10, maxBet: 1000 },
        baccaratLive: { enabled: true, maintenance: false, minBet: 10, maxBet: 1000 },
        roulette: { enabled: true, maintenance: false, minBet: 5, maxBet: 1000 },
    },
};

const STORAGE_KEY = 'arcade:opsConfig';

let cache: OpsConfig | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(cfg: OpsConfig) => void>();

/** 同 ledger：Node 底下沒有 BroadcastChannel，驗證腳本不能因此炸掉 */
function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.addEventListener('message', (ev: MessageEvent<OpsMessage>) => {
            if (ev.data?.kind !== 'config') return;
            cache = null;
            const cfg = get();
            for (const fn of listeners) fn(cfg);
        });
    } catch {
        channel = null;
    }
    return channel;
}

/**
 * 把存下來的設定跟預設值合併。
 *
 * 一定要合併不能直接用存下來的那一份：加了新玩法之後，
 * 舊的 localStorage 裡沒有那一款的設定，直接用會拿到 undefined，
 * 然後 `cfg.games.roulette.maxBet` 就炸了。
 * **設定檔的向下相容一律用「預設值打底、存檔覆蓋」處理。**
 */
function merge(saved: Partial<OpsConfig> | null): OpsConfig {
    const games = {} as Record<GameId, GameOps>;
    for (const id of Object.keys(DEFAULTS.games) as GameId[]) {
        games[id] = { ...DEFAULTS.games[id], ...(saved?.games?.[id] ?? {}) };
    }
    return { version: saved?.version ?? DEFAULTS.version, games };
}

/**
 * 讀設定。遊戲那一端每次要用就呼叫，不要自己快取——快取了就收不到後台的變更。
 *
 * ---
 *
 * **這張表刻意留在 localStorage，沒有跟著搬去 IndexedDB。**
 *
 * 另外四張表搬家是因為它們會長大（注單一萬多筆、約 3MB）。
 * 營運設定是四款遊戲各四個欄位，不到 1KB，**永遠不會長大**。
 *
 * 更關鍵的是：搬過去就得跟其他表一樣先 `await init()` 才讀得到，
 * 而 `checkBet()` 是在**封包層的同步流程裡**被呼叫的——
 * 玩家按下下注的那一刻，限紅檢查不能等一個非同步讀取。
 *
 * 一句話：**會長大的資料搬去 IndexedDB，要同步讀的小設定留在 localStorage。**
 * 兩種儲存各有適合的東西，不必為了一致而統一。
 */
export function get(): OpsConfig {
    /**
     * **讀取要先確保廣播頻道已經建立。**
     *
     * 這一行是一個真實 bug 的修正，症狀是：後台把限紅從 1000 改成 100，
     * 遊戲端擋得住；**再改回 1000，遊戲端卻繼續擋**，除非重新整理。
     *
     * 真因是 `getChannel()` 是惰性的——只有 `subscribe()`、`update()`、`reset()`
     * 會呼叫它。而遊戲端只讀設定、既不訂閱也不寫入，
     * **所以那個分頁的 BroadcastChannel 從來沒有被建立過**，
     * 於是它收不到任何 `config` 廣播，`cache` 一旦被填充就永遠是那一份。
     *
     * 為什麼「改小」那次看起來是生效的：那是第一次讀，cache 還是空的，
     * 直接從 localStorage 讀到了新值。**一個只在第一次正確的快取，
     * 比完全不快取更難查**——因為它會讓人以為機制是通的。
     *
     * 修法是讓讀取本身也建立頻道：**「我讀了這份資料」隱含「我要它是最新的」**。
     * `getChannel()` 有 early return，重複呼叫的成本可以忽略。
     */
    getChannel();
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = merge(raw ? (JSON.parse(raw) as Partial<OpsConfig>) : null);
    } catch {
        cache = merge(null);
    }
    return cache;
}

/** 讀單一玩法的設定 */
export function forGame(id: GameId): GameOps {
    return get().games[id];
}

/**
 * 寫入單一玩法的設定。**後台的表單是唯一的呼叫者。**
 *
 * 回傳新的整份設定而不是 void，是為了讓呼叫端不必再讀一次——
 * 「寫完再讀」中間會有一個窗口，另一個分頁的寫入可能插進來。
 */
export function update(id: GameId, patch: Partial<GameOps>): OpsConfig | null {
    // 權限先於一切。**擋在這裡而不是只把按鈕變灰**——
    // 按鈕變灰是體驗，這一行才是權限（見 auth.ts）
    if (!can('ops.write')) return null;

    const cur = get();
    const before = cur.games[id];
    const after: GameOps = { ...before, ...patch };
    const next: OpsConfig = {
        version: cur.version + 1,
        games: { ...cur.games, [id]: after },
    };
    cache = next;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* 寫不進去就只有這一頁生效，不擋住操作 */
    }

    /**
     * 留痕。**寫在這裡而不是讓後台頁面自己記**——
     * 這支函式是設定的唯一入口，記在入口裡，就沒有繞得過去的路徑。
     * 交給呼叫端的話，任何一個忘記記錄的地方都是一個沒有留痕的後門，
     * 而那種遺漏在審查程式碼時看不出來。
     */
    audit.record({
        action: 'ops.update',
        target: id,
        targetLabel: GAME_LABEL[id],
        changes: audit.diff(before, after, {
            enabled: '上架',
            maintenance: '維護中',
            minBet: '單注下限',
            maxBet: '單注上限（限紅）',
        }, {
            enabled: (v) => (v ? '是' : '否'),
            maintenance: (v) => (v ? '是' : '否'),
        }),
        note: '',
    });

    getChannel()?.postMessage({ kind: 'config' } satisfies OpsMessage);
    for (const fn of listeners) fn(next);
    return next;
}

/** 還原預設值 */
export function reset(): OpsConfig | null {
    if (!can('ops.write')) return null;

    // 還原之前先記下現在是什麼。**「他把設定還原了」不夠**，
    // 要回答的是「還原之前限紅是多少」——那個值在下一行就消失了
    const before = get();
    cache = merge(null);
    const changed = (Object.keys(cache.games) as GameId[])
        .filter((id) => JSON.stringify(before.games[id]) !== JSON.stringify(cache!.games[id]))
        .map((id) => `${GAME_LABEL[id]}（限紅 ${before.games[id].minBet}~${before.games[id].maxBet}${before.games[id].enabled ? '' : '、已下架'}${before.games[id].maintenance ? '、維護中' : ''}）`);
    if (changed.length) {
        audit.record({
            action: 'ops.reset',
            target: 'all',
            targetLabel: '全部玩法',
            changes: [],
            note: `還原預設值。原本：${changed.join('，')}`,
        });
    }
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 清不掉就算了，cache 已經是預設值 */
    }
    getChannel()?.postMessage({ kind: 'config' } satisfies OpsMessage);
    for (const fn of listeners) fn(cache);
    return cache;
}

/** 訂閱設定變更。**遊戲那一端一定要訂**，否則後台改了要重整才看得到 */
export function subscribe(fn: (cfg: OpsConfig) => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * 檢查一筆下注是否符合目前的營運設定。
 *
 * **回傳錯誤代碼而不是布林值**，因為玩家要知道是為什麼被擋的——
 * 「維護中」跟「超過限紅」對他來說是完全不同的兩件事，
 * 一律回 false 的話 UI 只能顯示「下注失敗」，那是最沒用的錯誤訊息。
 *
 * 翻譯不在這裡發生（見 net/protocol.ts 的說明），這裡只給代碼。
 */
export function checkBet(id: GameId, amount: number): string | null {
    const ops = forGame(id);
    if (!ops.enabled) return 'game_disabled';
    if (ops.maintenance) return 'game_maintenance';
    if (amount < ops.minBet) return 'below_min_bet';
    if (amount > ops.maxBet) return 'above_max_bet';
    return null;
}
