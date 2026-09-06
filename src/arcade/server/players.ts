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

import * as audit from './auditLog';
import { OPS_CHANNEL } from './ledger';

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
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

/**
 * 跨分頁廣播。
 *
 * **這一層是停用帳號能不能真的生效的關鍵。**
 *
 * 名冊讀進記憶體之後就一直是那一份，而遊戲跑在另一個分頁——
 * 後台按下停用、寫進 localStorage，遊戲那邊的 `checkPlayer()` 讀的仍是舊快取，
 * 於是被停用的帳號照樣下得了注。**症狀是「功能沒反應」，
 * 但真因是兩個分頁各自持有同一份資料的副本。**
 *
 * 走的是跟 opsConfig 同一條頻道，訊息用 kind 區分。
 */
function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<{ kind?: string }>) => {
            if (ev.data?.kind !== 'players') return;
            // 作廢快取而不是把新資料併進來：localStorage 才是真相來源，
            // 記憶體只是它的快取（同 ledger 的處理）
            cache = null;
            for (const fn of listeners) fn();
        };
    } catch {
        channel = null;
    }
    return channel;
}

/** 訂閱名冊變更。後台頁面用它重繪，遊戲端不需要——它每次下注都會重新讀 */
export function subscribe(fn: () => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

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

    // 留痕。停用一個帳號跟改一個備註在畫面上只差一個開關的距離，
    // 但在稽核紀錄裡它們是完全不同份量的兩件事——所以連備註都要記
    audit.record({
        action: 'player.update',
        target: id,
        targetLabel: rows[idx].nickname,
        changes: audit.diff(rows[idx], next, {
            nickname: '暱稱',
            vipLevel: 'VIP 等級',
            status: '帳號狀態',
            tags: '風控標記',
            note: '營運備註',
        }, {
            status: (v) => (v === 'frozen' ? '停用' : '正常'),
            note: (v) => (v ? String(v) : '（空）'),
        }),
        note: '',
    });

    getChannel()?.postMessage({ kind: 'players' });
    for (const fn of listeners) fn();
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

/**
 * 這個帳號現在能不能玩。
 *
 * ---
 *
 * **為什麼不併進 `opsConfig.checkBet()`？**
 *
 * 因為那兩個函式回答的是不同的問題。`checkBet` 問的是
 * 「**這款遊戲**現在收不收這筆注」——下架了、維護中、超過限紅。
 * 這裡問的是「**這個人**現在能不能玩」。
 *
 * 兩個問題的答案來自不同的表，也在不同的時候改變：營運調限紅是一次設定變更，
 * 停用帳號是一次風控決定。混成一支函式的話，
 * 「調限紅」跟「停權」會共用同一條稽核紀錄，而那正是之後要分開查的兩件事。
 *
 * 呼叫點跟 `checkBet` 一樣在**封包層**（各 server 的 `handle()`），
 * 不在遊戲的數學模型裡——理由見 slotServer 的 `spin()`：
 * 那支函式要被驗證腳本拿去跑十萬把算期望值，不能被營運狀態牽動。
 */
export function checkPlayer(id: string): string | null {
    const p = get(id);
    // 查無此人不擋。**這是刻意的**：名冊還沒建立（例如清空過資料）時，
    // 擋下來會讓整個遊樂場變成不能玩，而那是比「有個帳號沒登記」嚴重得多的故障
    if (!p) return null;
    return p.status === 'frozen' ? 'account_frozen' : null;
}

/** 顯示用：分型的中文名。後台看的是人的行為，不是 enum 值 */
export const PROFILE_LABEL: Record<PlayerProfile, string> = {
    whale: '大戶',
    regular: '一般',
    casual: '休閒',
    hedger: '對沖',
    grinder: '苦工',
};
