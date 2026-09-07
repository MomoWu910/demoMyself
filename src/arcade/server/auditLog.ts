import { actorName } from './auth';
import { OPS_CHANNEL } from './opsChannel';
import { drop, hydrate, persist } from './storage';

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
     * 而 `sort` 雖然是穩定的（ES2019 起），穩定的意思是
     * 「相等的鍵維持輸入順序」——**降序排出來就成了「最舊的在最上面」**，
     * 於是「最新的那一筆」拿到的是先寫的那筆。
     *
     * 稽核紀錄尤其不能這樣：「他先關掉遊戲才改限紅，還是先改限紅才關掉」
     * 正是調查事故時要問的，而這一頁預設就是按時間倒序在讀。
     *
     * 真實系統靠資料庫的自增主鍵解決，這裡自己維護一個。
     */
    seq: number;
    /**
     * 操作者。取自目前的角色（見 auth.ts）。
     *
     * **沒有操作者的稽核紀錄只能證明「有人改過」**，而稽核要回答的第一個問題就是誰。
     * 這個 demo 沒有登入，所以填的是角色而不是帳號——
     * 真實系統換成登入者的識別即可，表的形狀不用動。
     */
    actor: string;
    /** 動作類型。用點分命名空間，方便之後按類別篩選 */
    action: 'ops.update' | 'ops.reset' | 'player.update' | 'tx.review' | 'bet.void' | 'data.seed' | 'data.clear';
    /** 被改的東西的識別（遊戲 id、玩家 id、交易 id） */
    target: string;
    /** 被改的東西的顯示名。同樣是存下來，不是顯示時再查 */
    targetLabel: string;
    changes: AuditChange[];
    /** 補充說明。像「清空全部資料」這種沒有欄位變更的動作靠它表達 */
    note: string;
}

// 儲存位置在 storage.ts
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

/**
 * 操作者由 `auth` 決定，這裡不自己維護一份。
 *
 * 原本這裡有一個模組層級的 `actor` 變數加一支 `setActor()`，
 * 那是在權限系統還不存在時的暫時做法——**而暫時做法的問題是它會被忘記呼叫**：
 * 切換角色之後如果沒有人記得同步這個變數，稽核紀錄就會記到上一個人頭上，
 * 而那種錯誤沒有任何辦法在事後分辨。
 *
 * 改成每次寫入時去問 auth，就沒有「兩份狀態要保持一致」這回事。
 */

function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<{ kind?: string }>) => {
            if (ev.data?.kind !== 'audit') return;
            // **重讀，不是設成 null。** 讀取是同步的（見 storage.ts），
            // 把快取設成 null 之後 `load()` 只會回空陣列，
            // 於是別的分頁一改動，這一頁的資料就整個不見了
            void init().then(() => {
                for (const fn of listeners) fn();
            });
        };
    } catch {
        channel = null;
    }
    return channel;
}

/** 從持久層灌進記憶體。啟動時 await 一次 */
export async function init(): Promise<void> {
    cache = await hydrate<AuditEntry>('audit');
    // 序號接續既有紀錄，不是從 0 重來——重新整理之後寫的紀錄，
    // 序號不能比重整前的還小
    for (const r of cache) {
        if (r.seq >= seq) seq = r.seq + 1;
    }
}

function load(): AuditEntry[] {
    // 讀取要先確保廣播頻道已建立，理由同 opsConfig.get()
    getChannel();
    return (cache ??= []);
}

function save(rows: AuditEntry[]): void {
    cache = rows;
    // 寫不進去也不能影響操作本身——稽核失敗不該讓營運動作跟著失敗。
    // 真實系統這裡要往監控送一個警報，因為「稽核寫不進去」本身是重大事件
    persist('audit', rows);
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
        actor: actorName(),
        action: entry.action,
        target: entry.target,
        targetLabel: entry.targetLabel,
        changes: entry.changes,
        note: entry.note,
    };

    const all = load().concat(row);
    save(all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all);

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
    cache = [];
    drop('audit');
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
