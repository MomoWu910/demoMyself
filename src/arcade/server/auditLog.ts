import { OPS_CHANNEL } from './ledger';

/**
 * 操作稽核：**後台每一個會改到資料的動作，在這裡留下一筆說得出前後值的紀錄。**
 *
 * ---
 *
 * **為什麼這張表非有不可。**
 *
 * 後台可以把百家樂的單注上限從 1000 改成 100000，也可以把一個帳號停用。
 * 這些動作有金錢後果，而在有這張表之前，做完就沒有痕跡了——
 * 「昨晚誰把限紅開到十萬」這個問題，在資料上是問不出來的。
 *
 * 這不是「還可以再加的功能」，是**營運後台的合規底線**：
 * 有權限做的事必須留得下紀錄，否則權限本身就沒有意義。
 *
 * ---
 *
 * **兩個設計決定：**
 *
 * 1. **記前後值，不是只記「他改過」。**
 *    「某某在 3:12 修改了 slot 的設定」這種日誌在事故調查時等於沒有，
 *    因為要回答的問題是「改成了什麼」。所以每一筆都帶 `changes`，
 *    而且**存的是格式化過的字串不是原始值**——三年後回頭查的時候，
 *    欄位可能已經改名或改型別，而稽核紀錄必須能獨立閱讀，
 *    不能依賴當時的程式碼還在。
 *
 * 2. **在資料層記，不在頁面記。**
 *    如果讓頁面在按下儲存之後呼叫 `audit.record()`，
 *    那麼**任何一個忘記呼叫的地方就是一個沒有留痕的入口**——
 *    而那種遺漏在程式碼審查時看不出來，只有出事的時候才會發現。
 *    所以記錄寫在 `opsConfig.update()`、`players.update()`、`txLedger.review()`
 *    這些函式內部：想改資料就一定得經過它們，經過就一定留痕。
 */

export interface AuditChange {
    /** 欄位名（程式用） */
    field: string;
    /** 欄位的顯示名。**存下來而不是查表**，理由見檔頭 */
    label: string;
    before: string;
    after: string;
}

export interface AuditEntry {
    id: string;
    at: number;
    /**
     * 寫入序號。**時間戳不足以排出先後。**
     *
     * 這是被測試抓到的：連續兩次改設定會落在同一毫秒，
     * 於是「最新的那一筆」變成不確定的——`sort` 對相等的鍵不保證穩定，
     * 而稽核紀錄如果排不出先後，「他先關掉遊戲才改限紅，還是先改限紅才關掉」
     * 這種問題就答不了，而那正是調查事故時要問的。
     *
     * 真實系統靠資料庫的自增主鍵解決，這裡自己維護一個。
     */
    seq: number;
    /**
     * 操作者。
     *
     * 這個 demo 沒有登入，所以永遠是 `admin`。
     * 但欄位一定要在——**沒有操作者的稽核紀錄只能證明「有人改過」**，
     * 而稽核要回答的第一個問題就是誰。等到權限系統接上來，
     * 這裡換成登入者的識別就好，表的形狀不用動。
     */
    actor: string;
    /** 動作類型。用點分命名空間，方便之後按類別篩選 */
    action: 'ops.update' | 'ops.reset' | 'player.update' | 'tx.review' | 'data.seed' | 'data.clear';
    /** 被改的東西的識別（遊戲 id、玩家 id、交易 id） */
    target: string;
    /** 被改的東西的顯示名。同樣是存下來，不是顯示時再查 */
    targetLabel: string;
    changes: AuditChange[];
    /** 補充說明。像「清空全部資料」這種沒有欄位變更的動作靠它表達 */
    note: string;
}

const STORAGE_KEY = 'arcade:audit';
/**
 * 保留上限。
 *
 * 真實系統的稽核紀錄是**不刪的**（法遵通常要求保留數年，搬去冷儲存但不刪除）。
 * 這裡有上限純粹是因為 demo 把資料庫放在 localStorage 裡。
 */
const MAX_ROWS = 2000;

let cache: AuditEntry[] | null = null;
let seq = 0;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

/** 目前的操作者。權限系統接上來之後由登入狀態決定 */
let actor = 'admin';

export function setActor(name: string): void {
    actor = name;
}

function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<{ kind?: string }>) => {
            if (ev.data?.kind !== 'audit') return;
            cache = null;
            for (const fn of listeners) fn();
        };
    } catch {
        channel = null;
    }
    return channel;
}

function load(): AuditEntry[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as AuditEntry[]) : [];
    } catch {
        cache = [];
    }
    // 序號接續既有紀錄，不是從 0 重來——重新整理之後寫的紀錄，
    // 序號不能比重整前的還小
    for (const r of cache) {
        if (r.seq >= seq) seq = r.seq + 1;
    }
    return cache;
}

function persist(rows: AuditEntry[]): void {
    cache = rows;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
        /* 寫不進去也不能影響操作本身——稽核失敗不該讓營運動作跟著失敗。
           真實系統這裡要往監控送一個警報，因為「稽核寫不進去」本身是重大事件 */
    }
}

/**
 * 記一筆。
 *
 * **沒有變更就不記。** 打開表單、什麼都沒改就按儲存，
 * 在稽核表裡留下一筆空紀錄，只會讓真正的變更被稀釋掉。
 */
export function record(entry: Omit<AuditEntry, 'id' | 'at' | 'seq' | 'actor'> & { at?: number }): AuditEntry | null {
    if (!entry.changes.length && !entry.note) return null;

    const at = entry.at ?? Date.now();
    const mySeq = seq++;
    const row: AuditEntry = {
        id: `a${at.toString(36)}-${mySeq.toString(36).padStart(4, '0')}`,
        at,
        seq: mySeq,
        actor,
        action: entry.action,
        target: entry.target,
        targetLabel: entry.targetLabel,
        changes: entry.changes,
        note: entry.note,
    };

    const all = load().concat(row);
    persist(all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all);

    getChannel()?.postMessage({ kind: 'audit' });
    for (const fn of listeners) fn();
    return row;
}

export interface AuditQuery {
    action?: AuditEntry['action'] | 'all';
    target?: string;
    from?: number;
    to?: number;
    page?: number;
    pageSize?: number;
}

export interface AuditPage {
    rows: AuditEntry[];
    total: number;
}

/** 查詢。**只有時間排序**——稽核紀錄按別的欄位排沒有意義，它是一條時間線 */
export function query(q: AuditQuery = {}): AuditPage {
    const { action = 'all', target, from, to, page = 0, pageSize = 50 } = q;

    let rows = load();
    if (action !== 'all') rows = rows.filter((r) => r.action === action);
    if (target) rows = rows.filter((r) => r.target === target);
    if (from != null) rows = rows.filter((r) => r.at >= from);
    if (to != null) rows = rows.filter((r) => r.at <= to);

    // 時間相同就用序號決勝。少了第二個鍵，同一毫秒內的紀錄順序是不確定的
    const sorted = rows.slice().sort((a, b) => b.at - a.at || b.seq - a.seq);
    return { rows: sorted.slice(page * pageSize, page * pageSize + pageSize), total: sorted.length };
}

export function subscribe(fn: () => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function count(): number {
    return load().length;
}

/**
 * 清空。
 *
 * ⚠️ **這支函式不接到任何按鈕上**，只給驗證腳本用。
 * 後台的「清空全部資料」清的是注單、玩家與金流，**不清稽核**——
 * 稽核紀錄比它記錄的資料活得久，這正是它的用途：
 * 資料被清掉之後，「是誰清的」還在。
 */
export function clear(): void {
    cache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 同上 */
    }
    cache = [];
}

/**
 * 比較兩個物件，產生變更清單。
 *
 * `labels` 決定**哪些欄位要記**以及它們的顯示名——
 * 沒列在裡面的欄位不記，因為稽核表不該被內部欄位塞滿
 * （例如 `updatedAt` 這種每次都變的東西）。
 *
 * `format` 讓呼叫端把值轉成人看得懂的字串：布林要變成「是／否」，
 * 等級要帶上返水率。**稽核紀錄的讀者是人，不是程式。**
 */
export function diff<T extends object>(
    before: T,
    after: T,
    labels: Partial<Record<keyof T, string>>,
    format: Partial<Record<keyof T, (v: unknown) => string>> = {},
): AuditChange[] {
    const out: AuditChange[] = [];
    for (const key of Object.keys(labels) as (keyof T)[]) {
        const b = before[key];
        const a = after[key];
        // 陣列（例如標記）用 JSON 比較，避免參考不同就判定有變更
        const same = Array.isArray(b) || Array.isArray(a)
            ? JSON.stringify(b) === JSON.stringify(a)
            : b === a;
        if (same) continue;

        const fmt = format[key] ?? ((v: unknown) => (Array.isArray(v) ? (v.length ? v.join('、') : '（無）') : String(v)));
        out.push({
            field: String(key),
            label: labels[key] as string,
            before: fmt(b),
            after: fmt(a),
        });
    }
    return out;
}
