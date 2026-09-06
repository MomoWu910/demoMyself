import { useSyncExternalStore } from 'react';
import {
    can, getRole, ROLES, setRole, subscribe,
    type Permission, type Role,
} from '../arcade/server/auth';

/**
 * 讓元件跟著角色變更重繪。
 *
 * 用 `useSyncExternalStore` 而不是 `useState` + `useEffect`：
 * 角色是**元件外面**的狀態（住在 auth 模組裡，而且會被別的分頁改），
 * 而這個 hook 正是 React 為這種狀態準備的接法——
 * 少了它，切換角色之後畫面上的按鈕會停在舊的權限。
 */
export function useRole(): Role {
    return useSyncExternalStore(subscribe, getRole);
}

/**
 * 回一個 `can()`，並在角色變更時讓元件重繪。
 *
 * 回函式而不是回一個權限清單，是因為呼叫端讀起來就是它想問的問題：
 * `can('tx.review')` 比 `permissions.includes('tx.review')` 更接近人話。
 */
export function useCan(): (p: Permission) => boolean {
    useRole();
    return can;
}

/**
 * 做不到的動作要說得出原因。
 *
 * **這個字串不是裝飾。** 一個變灰的按鈕如果不說為什麼，
 * 使用者只會覺得系統壞了然後跑去問客服——
 * 而正確答案是「你的角色沒有這個權限」，那句話應該讓他自己看得到。
 */
export function denyReason(permission: Permission, role: Role): string {
    const label = ROLES[role].label;
    const who = (Object.keys(ROLES) as Role[])
        .filter((r) => ROLES[r].permissions.includes(permission))
        .map((r) => ROLES[r].label)
        .join('、');
    return `目前身分是「${label}」，沒有這個權限。可以做這件事的是：${who}`;
}

export { ROLES, setRole, type Permission, type Role };
