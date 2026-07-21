import { useSyncExternalStore } from 'react';
import { getLang, onLangChange, t } from './index';

// i18n 只提供訂閱、沒有取消訂閱，這裡包一層：只向它註冊一次，React 元件各自進出走本地 listener。
const listeners = new Set<() => void>();
let registered = false;

function subscribe(cb: () => void): () => void {
    if (!registered) {
        registered = true;
        onLangChange(() => listeners.forEach((l) => l()));
    }
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/**
 * 語言切換時讓元件重繪，並回傳當下的 t()。
 *
 * 放在 i18n 底下而不是各頁自己一份：首頁與 Shader Lab 原本各有一份同樣的實作，
 * 配置器 React 化時就會變第三份。i18n 是全站共用模組，這個 hook 屬於它。
 */
export function useT(): typeof t {
    useSyncExternalStore(subscribe, getLang);
    return t;
}
