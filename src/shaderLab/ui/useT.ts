import { useSyncExternalStore } from 'react';
import { getLang, onLangChange, t } from '../../i18n';

// i18n 模組只提供訂閱、沒有取消訂閱，所以在這裡包一層：只向它註冊一次，
// React 元件掛載／卸載都走本地這組 listener。
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

/** 語言切換時讓元件重繪，並回傳當下的 t()。 */
export function useT(): typeof t {
    useSyncExternalStore(subscribe, getLang);
    return t;
}
