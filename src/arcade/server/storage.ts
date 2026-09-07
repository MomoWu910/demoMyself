/**
 * 持久層：**記憶體是快取，IndexedDB 是儲存。**
 *
 * ---
 *
 * **為什麼要換掉 localStorage。**
 *
 * 展示資料長到 40 個帳號 × 30 天之後，三張表加起來約 3MB，
 * 而 localStorage 的上限通常是 5MB——**已經沒有多少餘裕，而資料只會再長**。
 *
 * 但容量還不是最要緊的。localStorage 是**同步 API**：
 * 每寫一次注單，`JSON.stringify` 一萬多筆再寫進磁碟這件事會卡住主執行緒。
 * 在遊樂場那一端，那個卡頓正好落在「按下下注」與「畫面開始動」之間。
 *
 * ---
 *
 * **為什麼不把整個資料層改成 async。**
 *
 * 那是第一個想到的做法，而它會撞到一堵牆：**遊戲的 `handle()` 必須同步回傳封包**。
 * 玩家按下下注，封包層當場算完賠付、回一個 S2C 訊息——
 * 這中間不能有 `await`，否則整個 fakeSocket 的協定都要改成非同步，
 * 而那跟真實系統的方向剛好相反（真實系統的伺服器也不會等資料庫寫完才回應玩家）。
 *
 * 所以分工是這樣：
 * - **讀取同步**：從記憶體快取讀，永遠是即時的
 * - **寫入同步更新快取、非同步落地**：呼叫端拿到的立刻是新狀態，
 *   磁碟寫入在背景排隊
 * - **啟動時 await 一次**：把 IndexedDB 的內容灌進快取（見 `hydrateAll`）
 *
 * 代價是：瀏覽器在寫入落地前被關掉，最後幾筆會掉。
 * 對注單來說那是不能接受的——**但真實系統的注單本來就不在瀏覽器裡**，
 * 這個 demo 的整個持久層都是替身。
 */

/** 資料庫與版本。改結構時才動版本號 */
const DB_NAME = 'arcade';
const DB_VERSION = 1;
const STORE = 'tables';

/** 一張表在這裡就是一個 key。值是整包陣列——**不是一列一筆** */
export type TableName = 'ledger' | 'transactions' | 'players' | 'audit';

/**
 * 為什麼整張表存成一筆，而不是每列一筆？
 *
 * 因為這一層要替換的是 localStorage，而上面三張表的存取模式是
 * 「整包讀進來、在記憶體裡查詢」。改成一列一筆的話，
 * 查詢就得改寫成 IndexedDB 的 cursor 與索引——那是另一個量級的工程，
 * 而且**它要解的問題（不把全表載入記憶體）在幾萬筆的規模下還不存在**。
 *
 * 這個決定的界線很清楚：資料長到記憶體裝不下的那天，這裡要整個重寫。
 * 在那之前，多寫的索引只是猜測。
 */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        // Node 底下（驗證腳本）沒有 indexedDB，直接拒絕讓呼叫端走記憶體路線
        if (typeof indexedDB === 'undefined') {
            reject(new Error('no indexedDB'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('open failed'));
        // 另一個分頁擋著升級時會卡住。**不要無限等**——
        // 後台開兩個分頁是常態，而使用者不會知道要去關掉另一個
        req.onblocked = () => reject(new Error('blocked by another tab'));
    });
    return dbPromise;
}

/** localStorage 時代的 key，遷移用 */
const LEGACY_KEY: Record<TableName, string> = {
    ledger: 'arcade:ledger',
    transactions: 'arcade:transactions',
    players: 'arcade:players',
    audit: 'arcade:audit',
};

/**
 * 讀一張表。
 *
 * **順序是 IndexedDB → localStorage → 空的。**
 * 中間那一段是遷移：舊版本把資料寫在 localStorage，
 * 直接忽略的話使用者打開後台會看到一個空的系統，
 * 而他昨天才標記過的帳號不見了。
 *
 * 遷移只做一次——讀到舊資料就順手寫進 IndexedDB 並清掉舊的。
 */
export async function hydrate<T>(name: TableName): Promise<T[]> {
    try {
        const db = await openDb();
        const rows = await new Promise<T[] | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(name);
            req.onsuccess = () => resolve(req.result as T[] | undefined);
            req.onerror = () => reject(req.error);
        });
        if (rows) return rows;
    } catch {
        // IndexedDB 不可用（無痕的某些設定、Node、被另一個分頁擋住）——
        // 退回 localStorage，功能照常，只是容量回到 5MB
    }

    // 舊資料遷移
    try {
        const raw = localStorage.getItem(LEGACY_KEY[name]);
        if (raw) {
            const rows = JSON.parse(raw) as T[];
            persist(name, rows);
            try {
                localStorage.removeItem(LEGACY_KEY[name]);
            } catch {
                /* 清不掉也沒關係，下次 IndexedDB 會先命中 */
            }
            return rows;
        }
    } catch {
        /* 讀不到就是沒有 */
    }
    return [];
}

/**
 * 寫一張表。**呼叫端不必等。**
 *
 * 回傳 void 而不是 Promise 是刻意的：這支函式的呼叫點是
 * 「注單寫入」「設定變更」這些同步流程，給它們一個可以 await 的東西，
 * 只會誘使某個呼叫點真的去 await，然後那條路徑就變成非同步的了。
 *
 * 寫入失敗只寫進 console：**持久化失敗不該讓這次操作跟著失敗**，
 * 記憶體裡的資料仍然是完整的（跟 localStorage 時代同一條原則）。
 */
export function persist(name: TableName, rows: unknown[]): void {
    void (async () => {
        try {
            const db = await openDb();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(rows, name);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch {
            // IndexedDB 不可用就退回 localStorage。
            // 這一段會在容量爆掉時失敗，而那正是當初要換掉它的理由之一
            try {
                localStorage.setItem(LEGACY_KEY[name], JSON.stringify(rows));
            } catch {
                /* 兩邊都寫不進去就只留記憶體 */
            }
        }
    })();
}

/** 清掉一張表 */
export function drop(name: TableName): void {
    void (async () => {
        try {
            const db = await openDb();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(name);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch {
            /* 沒有 IndexedDB 就只清 localStorage */
        }
        try {
            localStorage.removeItem(LEGACY_KEY[name]);
        } catch {
            /* 同上 */
        }
    })();
}

/** 目前用的是哪一種儲存。顯示在設定頁，讓人知道資料放在哪裡 */
export async function backendName(): Promise<'IndexedDB' | 'localStorage' | '僅記憶體'> {
    try {
        await openDb();
        return 'IndexedDB';
    } catch {
        try {
            localStorage.setItem('arcade:probe', '1');
            localStorage.removeItem('arcade:probe');
            return 'localStorage';
        } catch {
            return '僅記憶體';
        }
    }
}
