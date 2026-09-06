/**
 * 玩家名冊。
 *
 * 這張表原本不存在——注單的 `player` 欄位一直是一個寫死的字串 `'demo-player'`。
 * 欄位在、值只有一個，結果是**營運後台所有跟人有關的問題都問不出來**：
 * 誰輸最多、誰的有效投注比低得不正常、哪個帳號註冊三天就提領五次。
 * 這些不是「還沒做的功能」，是資料結構上不可能算出來的東西。
 *
 * ---
 *
 * **為什麼玩家表要能被後台寫，注單表不行？**
 *
 * 注單是**發生過的事實**，所以 append-only：結算錯了開沖正單，不回頭改。
 * 玩家是**現在的狀態**：等級會升、帳號會凍結、風控標記會加會拿掉。
 * 兩張表的可變性不同，混在一起會讓「注單不可改」這條規則失去意義。
 *
 * 所以這裡有 `update()`，而 ledger 沒有。
 */

/** 玩家分型。決定下注行為，也決定後台在報表上該怎麼看他 */
export type PlayerProfile =
    /** 大戶：注額大、局數少。單一玩家就能把當日派彩率拉歪，營運要盯的就是這種 */
    | 'whale'
    /** 一般玩家 */
    | 'regular'
    /** 休閒：小注、偶爾玩 */
    | 'casual'
    /**
     * 對沖客：同時押莊閒、押紅黑，下注額很大但實際承擔的風險趨近於零。
     * **他不是來賭的，是來刷返水的**——這正是 `validStake` 這個欄位存在的理由
     */
    | 'hedger'
    /** 苦工：只玩老虎機、注額小、局數極多。靠量累積返水 */
    | 'grinder';

export interface Player {
    /** 玩家識別。真實系統是發號器產生，這裡用 `p-0001` 這種可讀的形式方便對照 */
    id: string;
    nickname: string;
    /**
     * VIP 等級 0～5。**它不只是個標籤，返水率是照它算的**
     * （見 txLedger 的 REBATE_RATE），所以調等級是有金錢後果的操作
     */
    vipLevel: number;
    /**
     * 帳號狀態。凍結的帳號進不了遊戲也提不了款。
     * 這是後台唯一會改玩家的欄位之一，第二個是 tags
     */
    status: 'active' | 'frozen';
    /**
     * 風控標記。後台人工掛上去的，例如 `對沖`、`高流水`、`待查`。
     * 用陣列而不是單一欄位，是因為同一個帳號可以同時符合多個條件
     */
    tags: string[];
    /** 營運備註。誰為什麼標記了他，這一格答得出來才叫留痕 */
    note: string;
    registeredAt: number;
    /** 分型。demo 的種子用它決定下注行為；真實系統裡這欄會是模型算出來的分群 */
    profile: PlayerProfile;
}

const STORAGE_KEY = 'arcade:players';

/**
 * 遊戲那一端正在玩的那個帳號。
 *
 * 它跟種子產生的四十個歷史玩家**放在同一張表裡**，不是特例。
 * 這樣後台的玩家頁點得進去，而你在遊樂場那一頁下的注會即時累加到他的統計上——
 * 這是「後台管的是真的遊戲」最直接的證據。
 */
export const SELF_ID = 'demo-player';

let cache: Player[] | null = null;

function load(): Player[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as Player[]) : [];
    } catch {
        cache = [];
    }
    return cache;
}

function save(rows: Player[]): void {
    // 記憶體先更新、持久化失敗也不回頭改它——理由同 ledger.save()：
    // localStorage 不可用（Node 驗證腳本、無痕視窗）不該讓這次工作階段的資料消失
    cache = rows;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
        /* 玩家名冊比注單小得多，寫不進去通常代表整個 storage 都不能用 */
    }
}

/** 全部玩家。名冊只有幾十列，不需要分頁——真實系統上百萬列時這支要換成分頁查詢 */
export function list(): Player[] {
    return load().slice();
}

export function get(id: string): Player | undefined {
    return load().find((p) => p.id === id);
}

export function count(): number {
    return load().length;
}

/** 灌入名冊。種子專用，已經有資料就不動 */
export function seedPlayers(rows: Player[]): void {
    save(rows);
}

/**
 * 更新玩家。**只允許改後台該改的欄位**——
 * 傳進來的物件即使帶了 `id` 或 `registeredAt` 也會被忽略。
 *
 * 這種白名單寫法在只有自己呼叫的 demo 裡看似多餘，但它擋掉的是
 * 「表單多送了一個欄位就把註冊時間洗掉」這類事故，而那種事故在對帳時最難查。
 */
export function update(id: string, patch: Partial<Pick<Player, 'vipLevel' | 'status' | 'tags' | 'note' | 'nickname'>>): Player | undefined {
    const rows = load();
    const idx = rows.findIndex((p) => p.id === id);
    if (idx < 0) return undefined;

    const next: Player = {
        ...rows[idx],
        ...(patch.nickname != null ? { nickname: patch.nickname } : {}),
        ...(patch.vipLevel != null ? { vipLevel: patch.vipLevel } : {}),
        ...(patch.status != null ? { status: patch.status } : {}),
        ...(patch.tags != null ? { tags: patch.tags.slice() } : {}),
        ...(patch.note != null ? { note: patch.note } : {}),
    };
    const copy = rows.slice();
    copy[idx] = next;
    save(copy);
    return next;
}

export function clear(): void {
    cache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 同上 */
    }
    cache = [];
}

/** 顯示用：分型的中文名。後台看的是人的行為，不是 enum 值 */
export const PROFILE_LABEL: Record<PlayerProfile, string> = {
    whale: '大戶',
    regular: '一般',
    casual: '休閒',
    hedger: '對沖',
    grinder: '苦工',
};
