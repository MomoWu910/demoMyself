import { OPS_CHANNEL } from './ledger';

/**
 * 資金流水：**錢進出帳號的每一筆，跟注單分開記。**
 *
 * ---
 *
 * **為什麼不跟注單同一張表？**
 *
 * 因為它們回答的是不同的問題。注單問「這一局發生了什麼」，
 * 資金流水問「這個帳號的錢從哪來、到哪去」。
 * 把儲值塞進注單表，就得給它一個 `betType`、一個 `roundId`、一個「有效投注」——
 * 全部都是空的，而報表每次加總都要先排除這些空列。
 *
 * 真實平台這兩張表也是分開的，而且**對帳就是拿它們互相驗證**：
 * 期初餘額 + 所有交易 + 所有注單淨輸贏 = 期末餘額。
 * 兩張表混在一起的話，這條等式就沒有第二個來源可以對。
 *
 * ---
 *
 * **`amount` 帶正負號，不是「正數 + 方向欄」。**
 *
 * 真實系統多半存正數再用 kind 判方向，這裡刻意反過來，因為它換來一條
 * 可以直接驗的不變式：**`balanceAfter === balanceBefore + amount`，每一筆都成立**。
 * 有了它，一筆資料是不是被寫壞了，不必回頭比對業務邏輯就看得出來
 * （`yarn check:admin` 驗的就是這條）。
 * 代價是報表要顯示「提領金額」時得取絕對值——這是個便宜的代價。
 */

export type TxKind =
    /** 儲值。玩家把錢放進來 */
    | 'deposit'
    /** 提領。要審核，所以它是唯一會停在 pending 的類型 */
    | 'withdraw'
    /**
     * 返水（也叫回水、洗碼費）。按**有效投注**計算的回饋，每日結算。
     *
     * 這一筆讓 `validStake` 這個欄位第一次有了金錢意義：
     * 在沒有返水的系統裡，對沖下注只是浪費手續費；
     * 有了返水，**押莊又押閒就變成一門幾乎無風險的生意**，
     * 而擋住它的唯一防線就是有效投注的算法。
     */
    | 'rebate'
    /** 人工調整。客訴補償、錯帳沖正。真實系統裡這種單一定要有操作者與原因 */
    | 'adjust';

export type TxStatus = 'done' | 'pending' | 'rejected';

export interface Transaction {
    id: string;
    player: string;
    kind: TxKind;
    /** 帶號金額：入帳為正、出帳為負。見檔頭說明 */
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    status: TxStatus;
    /**
     * 關聯單號。返水關聯到結算的那一天、提領關聯到工單、
     * 人工調整關聯到客訴編號。**沒有這欄的金流表查不了帳**
     */
    ref: string;
    /** 備註。人工調整一定要填，其他類型可空 */
    note: string;
    createdAt: number;
    /** 審核時間。只有 withdraw 會有，pending 的時候是 0 */
    reviewedAt: number;
}

export interface TxQuery {
    player?: string;
    kind?: TxKind | 'all';
    status?: TxStatus | 'all';
    from?: number;
    to?: number;
    sortBy?: 'createdAt' | 'amount';
    sortDir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}

export interface TxPage {
    rows: Transaction[];
    total: number;
    page: number;
    pageSize: number;
}

export interface TxStats {
    count: number;
    /** 儲值總額（正數） */
    deposit: number;
    /** 提領總額（**正數**，方便跟儲值並排比較；已排除 pending 與 rejected） */
    withdraw: number;
    rebate: number;
    adjust: number;
    /** 待審提領的筆數與金額。營運每天早上第一個看的數字 */
    pendingCount: number;
    pendingAmount: number;
    /** 淨存入 = 儲值 − 提領。這是平台真正收到的錢 */
    netDeposit: number;
}

/**
 * 各 VIP 等級的返水率（按有效投注計）。
 *
 * 數字本身是編的，但**級距的形狀是照真實平台的邏輯**：等級越高比例越高，
 * 而且高等級之間的差距會收斂——因為返水率再往上加，平台的抽水就被吃光了。
 *
 * ⚠️ 這張表是**營運參數**不是常數：改它會直接改變平台的成本結構。
 * 放在這裡而不是散在計算式裡，是為了讓「改一次、全站一致」。
 */
export const REBATE_RATE: readonly number[] = [0.003, 0.004, 0.005, 0.006, 0.007, 0.008];

/** 按有效投注與等級算返水。等級超出表格範圍就取最高階 */
export function rebateFor(validStake: number, vipLevel: number): number {
    const rate = REBATE_RATE[Math.min(Math.max(vipLevel, 0), REBATE_RATE.length - 1)];
    // 無條件捨去到整數。返水是平台付出去的錢，四捨五入會讓總成本比預期高
    return Math.floor(validStake * rate);
}

const STORAGE_KEY = 'arcade:transactions';
/**
 * 保留上限。交易的筆數比注單少一個量級（一天幾十筆 vs 幾百筆），
 * 所以這個數字比 ledger 的小，但足夠裝下 30 天
 */
const MAX_ROWS = 6000;

let cache: Transaction[] | null = null;
let seq = 0;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(rows: Transaction[]) => void>();

/** 惰性取得廣播頻道。跟 ledger 共用同一條頻道，用 kind 區分訊息 */
function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<{ kind?: string; rows?: Transaction[] }>) => {
            const msg = ev.data;
            // 只認自己的訊息。同一條頻道上還有 ledger 的 'bets' 與 opsConfig 的 'config'
            if (msg?.kind === 'tx') {
                cache = null;
                for (const fn of listeners) fn(msg.rows ?? []);
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

function load(): Transaction[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as Transaction[]) : [];
    } catch {
        cache = [];
    }
    return cache;
}

function save(rows: Transaction[]): void {
    // 記憶體先更新，持久化失敗不回頭砍它。理由與 ledger.save() 相同
    cache = rows;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-Math.floor(rows.length / 2))));
        } catch {
            /* 只留記憶體 */
        }
    }
}

function nextId(now: number): string {
    seq = (seq + 1) % 100000;
    return `t${now.toString(36)}-${seq.toString(36).padStart(4, '0')}`;
}

/** 寫入交易。唯一的寫入口 */
export function record(entries: Omit<Transaction, 'id'>[]): Transaction[] {
    if (!entries.length) return [];
    const now = Date.now();
    const rows: Transaction[] = entries.map((e) => ({ ...e, id: nextId(now) }));

    const all = load().concat(rows);
    save(all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all);

    getChannel()?.postMessage({ kind: 'tx', rows });
    for (const fn of listeners) fn(rows);
    return rows;
}

/**
 * 審核提領。**這是這張表唯一可以改既有列的操作**，而且只改狀態，不改金額。
 *
 * 為什麼破例改狀態：提領本來就是兩階段的——玩家送出申請、營運放行或退回。
 * 第二階段不是新的一筆錢，是同一筆的狀態推進。
 * 拆成兩列反而會讓「未處理的提領總額」要做集合相減才算得出來。
 *
 * ---
 *
 * **退件為什麼要另外開一筆 adjust，而不是把原單的金額改成 0？**
 *
 * 第一版就是把 amount 歸零、balanceAfter 還原——寫起來只有兩行，
 * 但它毀掉兩件東西：
 *
 * 1. **查不到他原本要提多少。** 一個被退掉的五十萬提領，
 *    在報表上跟一筆從未存在的紀錄長得一模一樣，風控就少了一個訊號。
 * 2. **打破了 `balanceAfter === balanceBefore + amount` 這條不變式。**
 *    退件單的金額變 0 但餘額卻動過，那條可以拿來驗全表的等式就對它不成立了。
 *
 * 所以改成真實系統的做法：**原單留著當證據，退款是另一筆交易**。
 * 這也正是 append-only 的精神——錢流反向，就多記一筆反向的。
 */
export function review(id: string, decision: 'done' | 'rejected', at = Date.now()): Transaction | undefined {
    const rows = load();
    const idx = rows.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    const tx = rows[idx];
    if (tx.kind !== 'withdraw' || tx.status !== 'pending') return undefined;

    const next: Transaction = { ...tx, status: decision, reviewedAt: at };
    const copy = rows.slice();
    copy[idx] = next;
    save(copy);

    if (decision === 'rejected') {
        // 退款。餘額基準取原單扣款後的餘額——demo 裡沒有即時錢包可查，
        // 真實系統這裡要向錢包服務請一次當下餘額，因為這中間可能已經有別的交易
        record([{
            player: tx.player,
            kind: 'adjust',
            amount: Math.abs(tx.amount),
            balanceBefore: tx.balanceAfter,
            balanceAfter: tx.balanceAfter + Math.abs(tx.amount),
            status: 'done',
            ref: tx.id,
            note: '提領退件退款',
            createdAt: at,
            reviewedAt: at,
        }]);
    }

    getChannel()?.postMessage({ kind: 'tx', rows: [next] });
    for (const fn of listeners) fn([next]);
    return next;
}

/**
 * 查詢。形狀與 `ledger.query()` 一致——篩選、排序、分頁都在這裡做完。
 * 兩張表的查詢介面長得一樣不是巧合，是因為前端那兩頁該長得一樣
 */
export function query(q: TxQuery = {}): TxPage {
    const {
        player,
        kind = 'all',
        status = 'all',
        from,
        to,
        sortBy = 'createdAt',
        sortDir = 'desc',
        page = 0,
        pageSize = 25,
    } = q;

    let rows = load();
    if (player) rows = rows.filter((t) => t.player === player);
    if (kind !== 'all') rows = rows.filter((t) => t.kind === kind);
    if (status !== 'all') rows = rows.filter((t) => t.status === status);
    if (from != null) rows = rows.filter((t) => t.createdAt >= from);
    if (to != null) rows = rows.filter((t) => t.createdAt <= to);

    const sorted = rows.slice().sort((a, b) => {
        const d = a[sortBy] - b[sortBy];
        return sortDir === 'asc' ? d : -d;
    });

    return { rows: sorted.slice(page * pageSize, page * pageSize + pageSize), total: sorted.length, page, pageSize };
}

/** 彙總。條件與 query 共用，報表與明細永遠是同一組篩選算出來的 */
export function stats(q: TxQuery = {}): TxStats {
    const all = query({ ...q, page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows;

    let deposit = 0;
    let withdraw = 0;
    let rebate = 0;
    let adjust = 0;
    let pendingCount = 0;
    let pendingAmount = 0;

    for (const t of all) {
        if (t.status === 'pending') {
            pendingCount++;
            pendingAmount += Math.abs(t.amount);
            continue;
        }
        // 退件的單不計入金額統計：那筆錢沒有真的出去。
        // 但它**留在表上**，而且它的退款是一筆獨立的 adjust——
        // 「這個帳號被退過三次提領」是風控訊號，不該被清乾淨
        if (t.status === 'rejected') continue;

        if (t.kind === 'deposit') deposit += t.amount;
        else if (t.kind === 'withdraw') withdraw += Math.abs(t.amount);
        else if (t.kind === 'rebate') rebate += t.amount;
        else adjust += t.amount;
    }

    return {
        count: all.length,
        deposit,
        withdraw,
        rebate,
        adjust,
        pendingCount,
        pendingAmount,
        netDeposit: deposit - withdraw,
    };
}

export function subscribe(fn: (rows: Transaction[]) => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function count(): number {
    return load().length;
}

export function clear(): void {
    cache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 同 ledger */
    }
    cache = [];
}
