import * as React from 'react';
import type { Density, Mode } from './theme';

/**
 * 外觀偏好（亮暗、密度），存在 localStorage。
 *
 * **這是使用者偏好，不是應用程式狀態**——所以它跟著瀏覽器走，
 * 不跟著網址走，也不需要跨分頁同步（同一個人在兩個分頁用不同密度是合理的）。
 *
 * 讀取包在 try/catch 裡：無痕視窗與停用網站資料的環境會讓 localStorage 直接丟例外，
 * 而**一個讀不到偏好設定就整頁白掉的後台**，比沒有偏好設定糟得多。
 */

const KEY_MODE = 'arcade:admin:mode';
const KEY_DENSITY = 'arcade:admin:density';

function read<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
    try {
        const v = localStorage.getItem(key) as T | null;
        return v && valid.includes(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

function write(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* 存不進去就只有這次工作階段有效 */
    }
}

export function useAppearance(): {
    mode: Mode;
    density: Density;
    setMode: (m: Mode) => void;
    setDensity: (d: Density) => void;
} {
    const [mode, setModeState] = React.useState<Mode>(() => read(KEY_MODE, 'dark', ['dark', 'light'] as const));
    const [density, setDensityState] = React.useState<Density>(
        () => read(KEY_DENSITY, 'compact', ['compact', 'comfortable'] as const),
    );

    const setMode = React.useCallback((m: Mode) => {
        setModeState(m);
        write(KEY_MODE, m);
        // 根元素的 color-scheme 要跟著換，否則捲軸與原生控制項會停在舊的配色
        // （index.html 那個 meta 只是初始值）
        document.documentElement.style.colorScheme = m;
    }, []);

    const setDensity = React.useCallback((d: Density) => {
        setDensityState(d);
        write(KEY_DENSITY, d);
    }, []);

    // 初次掛載時把 color-scheme 對齊到讀出來的偏好
    React.useEffect(() => {
        document.documentElement.style.colorScheme = mode;
    }, [mode]);

    return { mode, density, setMode, setDensity };
}

/**
 * 讓深層的元件也讀得到密度。
 *
 * DataGrid 有自己的 `density` prop，而它**不會**從 MUI 主題讀——
 * 主題管的是 `MuiTableCell` 那些覆寫，DataGrid 是另一套元件。
 * 所以密度要自己傳下去。
 *
 * 用 Context 而不是一路 prop drilling：中間隔著五個頁面元件，
 * 而它們沒有一個真的關心密度是什麼，只是把它往下傳——
 * **那種「只為了傳遞而存在的 prop」是 Context 最正當的用途。**
 */
export const DensityContext = React.createContext<Density>('compact');

export function useDensity(): Density {
    return React.useContext(DensityContext);
}
