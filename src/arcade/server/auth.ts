import { OPS_CHANNEL } from './opsChannel';

/**
 * 後台的角色與權限。
 *
 * ---
 *
 * **這個 demo 不做登入表單，改成明擺著的「切換身分」。**
 *
 * 做一個假的帳號密碼框有兩個問題：它會讓人以為這裡有真的驗證
 * （而驗證必須發生在後端，前端做的任何檢查都只是體驗），
 * 而且**教人把密碼打進一個沒有後端的表單，本身就是壞示範**。
 *
 * 所以這裡展示的是權限系統真正有內容的那一半：**誰能做什麼**。
 * 身分怎麼來的（密碼、SSO、雙因素）是另一個題目，
 * 而那一題的答案不在前端。
 *
 * ---
 *
 * **權限檢查為什麼要寫在資料層，而不是只把按鈕變灰？**
 *
 * 因為把按鈕變灰只是**體驗**，不是權限。
 * 少寫一個 `disabled`、多一個沒防到的入口（鍵盤操作、程式呼叫、
 * 之後新增的批次功能），權限就漏了，而且漏的時候畫面上完全正常。
 *
 * 所以這裡的做法是兩層：
 * - UI 把做不到的動作變灰並說明原因——**讓人知道自己不能做，比按下去才失敗好**
 * - 資料層在寫入前再檢查一次——**那才是真正擋住的地方**
 *
 * ⚠️ 誠實地說：這個 demo 的「資料層」跑在瀏覽器裡，所以它擋得住誤用，
 * 擋不住有心人。真實系統這一層在伺服器上，而前端這兩層原封不動地保留——
 * 分層的形狀是對的，執行的位置不同。
 */

export type Role = 'admin' | 'operator' | 'finance' | 'viewer';

/** 一個可以被授權的動作 */
export type Permission =
    /** 改遊戲設定（上下架、維護、限紅） */
    | 'ops.write'
    /** 改玩家的標記、備註、等級 */
    | 'player.write'
    /** 停用／恢復帳號。**跟 player.write 分開**，因為它會讓玩家玩不了 */
    | 'player.freeze'
    /** 審核提領 */
    | 'tx.review'
    /** 作廢注單 */
    | 'bet.void'
    /** 產生／清空展示資料 */
    | 'data.manage';

export interface RoleDef {
    label: string;
    /** 一句話說明這個角色在真實團隊裡是誰 */
    description: string;
    permissions: readonly Permission[];
}

/**
 * 角色與權限的對照。
 *
 * **分法照的是真實後台的職務分工，不是照功能表分的**：
 *
 * - 客服每天看最多注單，但**一個欄位都不能改**——他要回答玩家的問題，
 *   不是替玩家做決定。這個角色存在的價值就是「看得到全部、改不了任何東西」。
 * - 營運管遊戲與玩家標記，但**碰不到錢，也不能停權**——
 *   停用一個帳號是斷掉某個人的服務，該往上報一層。
 * - 財務審提領，但**不能改限紅**——不然「調高限紅讓人贏更多再放行提領」
 *   會是同一個人就做得完的事。這條線叫職責分離，是內控的基本要求。
 */
export const ROLES: Record<Role, RoleDef> = {
    admin: {
        label: '管理員',
        description: '全部權限。真實系統裡這個角色應該很少人有，而且每次操作都被盯著',
        permissions: ['ops.write', 'player.write', 'player.freeze', 'tx.review', 'bet.void', 'data.manage'],
    },
    operator: {
        label: '營運',
        description: '管遊戲設定與玩家標記，碰不到錢，也不能停權',
        // **沒有 player.freeze 是刻意的。** 標記一個帳號是日常工作，
        // 停用一個帳號是斷掉某個人的服務——後者該往上報一層。
        // 這條線正是 player.write 與 player.freeze 要分開的理由
        permissions: ['ops.write', 'player.write', 'bet.void'],
    },
    finance: {
        label: '財務',
        description: '審提領、處理爭議單。改不了限紅——不然調高限紅再放行提領會是同一個人做得完的事',
        permissions: ['tx.review', 'bet.void'],
    },
    viewer: {
        label: '客服',
        description: '看得到全部，改不了任何東西。他要回答玩家的問題，不是替玩家做決定',
        permissions: [],
    },
};

const STORAGE_KEY = 'arcade:role';

let current: Role | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<{ kind?: string }>) => {
            if (ev.data?.kind !== 'role') return;
            current = null;
            for (const fn of listeners) fn();
        };
    } catch {
        channel = null;
    }
    return channel;
}

/**
 * 目前的角色。
 *
 * 預設 `admin`：**沒有登入機制的系統，預設值只能是最高權限**，
 * 否則第一次打開後台會什麼都做不了。
 * 真實系統反過來——預設是「未登入」，而未登入什麼都不能做。
 */
export function getRole(): Role {
    if (current) return current;
    try {
        const saved = localStorage.getItem(STORAGE_KEY) as Role | null;
        current = saved && saved in ROLES ? saved : 'admin';
    } catch {
        current = 'admin';
    }
    return current;
}

export function setRole(role: Role): void {
    current = role;
    try {
        localStorage.setItem(STORAGE_KEY, role);
    } catch {
        /* 存不進去就只有這一頁生效 */
    }
    getChannel()?.postMessage({ kind: 'role' });
    for (const fn of listeners) fn();
}

/**
 * 目前的角色能不能做這件事。**UI 與資料層問的是同一支函式。**
 *
 * 原本這裡有兩個名字（`can` 給 UI、`allow` 給資料層），實作一模一樣。
 * 那種「同一件事兩個名字」的間接層只會讓下一個人猶豫該用哪一個，
 * 而它想表達的分工其實寫在呼叫點就夠了。
 *
 * 回傳 `false` 而不是丟例外，是因為呼叫端本來就要處理「做不到」的情況——
 * 用例外的話，每個呼叫點都得包 try/catch，而漏掉的那個會讓整頁白掉。
 */
export function can(permission: Permission): boolean {
    return ROLES[getRole()].permissions.includes(permission);
}

/** 稽核紀錄要記下的操作者。角色名 + 識別，真實系統這裡是登入者的帳號 */
export function actorName(): string {
    const role = getRole();
    return `${ROLES[role].label}(${role})`;
}

export function subscribe(fn: () => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 驗證腳本用：把角色重設回預設值 */
export function reset(): void {
    current = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* 同上 */
    }
}
