import { create } from 'zustand';
import type { ConfiguratorView } from './configuratorView';
import type { BackgroundMode } from '../managers/environmentManager';
import type { FinishInfo, PartInfo, TintInfo } from './materialConfigurator';

/**
 * 配置器的單一狀態來源。
 *
 * 面板 React 化的重點不在「換一套寫法」，而在**把散落的狀態收成一份**：
 * 舊版每個控制項各自持有自己的狀態（closure 裡的 `currentPart`、`partState`、
 * `autoOn`，還有寫在 DOM 上的 `.active` class 與 input.value），任何一次
 * 「A 變了 B 也要跟著變」都得手寫一個 `_syncXxx()` 去改 DOM。
 *
 * 收成一份之後：① 面板純粹是這份狀態的投影 ② 整份狀態可以序列化成一個
 * 可分享的連結（Phase 2）③ 之後從連結還原，只要對這裡的 action 重放一次。
 *
 * **每個 action 同時做兩件事：更新狀態、把它套進 Babylon 場景**。
 * 這是刻意的——引擎不是另一份狀態，是這份狀態的輸出裝置。分成兩邊寫，
 * 就會回到「UI 顯示 A、場景其實是 B」的老問題。
 */

/** 每個部件各自的選擇（切換部件時 UI 要還原成該部件的選擇） */
export interface PartUiState {
    finishId: string;
    tintId: string;
}

/**
 * 打光 preset 對應的滑桿值。
 *
 * 這份表跟 configuratorView 的 preset 定義是同一組數字的兩份複本——按下 preset 後
 * 滑桿要跳到對應位置，否則滑桿顯示的還是上一組值，一動就把 preset 的效果推翻。
 * （env 旋轉與色溫不在 preset 管轄內，維持現值。）
 */
export const PRESET_SLIDERS: Record<string, { env: number; key: number }> = {
    soft: { env: 1.1, key: 2.2 },
    dramatic: { env: 0.45, key: 3.6 },
    ecom: { env: 1.7, key: 2.0 },
};

/** 可序列化的那一半（Phase 2 的分享連結只需要這些） */
export interface CfgSelection {
    currentPart: string;
    partState: Record<string, PartUiState>;
    variant: string;
    lightingPreset: string;
    envIntensity: number;
    envRotationDeg: number;
    keyIntensity: number;
    keyTempK: number;
    background: BackgroundMode;
    autoRotate: boolean;
}

interface CfgState extends CfgSelection {
    /** Babylon 那一側。放在 store 裡是為了讓每個 action 都能拿到它，元件不會訂閱它。 */
    view: ConfiguratorView | null;
    ready: boolean;
    /** 模型載入後才知道的選項清單 */
    parts: PartInfo[];
    finishes: FinishInfo[];
    tints: TintInfo[];
    variants: string[];

    init: (payload: {
        view: ConfiguratorView;
        parts: PartInfo[];
        finishes: FinishInfo[];
        tints: TintInfo[];
        variants: string[];
        activeVariant: string;
    }) => void;

    setPart: (id: string) => void;
    setFinish: (finishId: string) => void;
    setTint: (tintId: string) => void;
    setVariant: (name: string) => void;
    setLightingPreset: (id: string) => void;
    setEnvIntensity: (v: number) => void;
    setEnvRotationDeg: (deg: number) => void;
    setKeyIntensity: (v: number) => void;
    setKeyTempK: (k: number) => void;
    setBackground: (mode: BackgroundMode) => void;
    toggleAutoRotate: () => void;
    resetView: () => void;
}

export const useCfgStore = create<CfgState>((set, get) => ({
    view: null,
    ready: false,
    parts: [],
    finishes: [],
    tints: [],
    variants: [],

    currentPart: 'whole',
    partState: {},
    variant: '',
    lightingPreset: 'soft',
    envIntensity: 1.1,
    envRotationDeg: 0,
    keyIntensity: 2.2,
    keyTempK: 6500,
    background: 'studio',
    autoRotate: true,

    init: ({ view, parts, finishes, tints, variants, activeVariant }) => {
        const partState: Record<string, PartUiState> = {};
        for (const p of parts) partState[p.id] = { finishId: 'original', tintId: 'none' };
        set({
            view,
            parts,
            finishes,
            tints,
            variants,
            partState,
            currentPart: parts[0]?.id ?? 'whole',
            variant: activeVariant,
            ready: true,
        });
    },

    // 純 UI 切換：換的是「接下來要調哪個部件」，場景不動
    setPart: (currentPart) => set({ currentPart }),

    setFinish: (finishId) => {
        const { view, currentPart, partState } = get();
        view?.applyFinish(currentPart, finishId);
        set({ partState: { ...partState, [currentPart]: { ...partState[currentPart], finishId } } });
    },

    setTint: (tintId) => {
        const { view, currentPart, partState } = get();
        view?.applyTint(currentPart, tintId);
        set({ partState: { ...partState, [currentPart]: { ...partState[currentPart], tintId } } });
    },

    // 變體會整個換掉材質，view 內部會把使用者選的 finish / tint 重套一次；
    // UI 這邊不必動 partState——那份選擇本來就沒變，變的只是它疊在哪組材質上。
    setVariant: (variant) => {
        get().view?.selectVariant(variant);
        set({ variant });
    },

    setLightingPreset: (lightingPreset) => {
        const { view } = get();
        view?.applyLightingPreset(lightingPreset);
        const s = PRESET_SLIDERS[lightingPreset];
        set(s ? { lightingPreset, envIntensity: s.env, keyIntensity: s.key } : { lightingPreset });
    },

    setEnvIntensity: (envIntensity) => {
        get().view?.setEnvIntensity(envIntensity);
        set({ envIntensity });
    },

    setEnvRotationDeg: (envRotationDeg) => {
        get().view?.setEnvRotation((envRotationDeg * Math.PI) / 180);
        set({ envRotationDeg });
    },

    setKeyIntensity: (keyIntensity) => {
        get().view?.setKeyLightIntensity(keyIntensity);
        set({ keyIntensity });
    },

    setKeyTempK: (keyTempK) => {
        get().view?.setKeyLightTemperature(keyTempK);
        set({ keyTempK });
    },

    setBackground: (background) => {
        get().view?.setBackgroundMode(background);
        set({ background });
    },

    toggleAutoRotate: () => {
        const autoRotate = !get().autoRotate;
        get().view?.setAutoRotate(autoRotate);
        set({ autoRotate });
    },

    // 只動相機，不屬於「這雙鞋長什麼樣」，所以不進 selection
    resetView: () => get().view?.resetView(),
}));

/** 給非 React 的那一側用（sheet 量測、之後的截圖/分享）。 */
export const cfgState = () => useCfgStore.getState();
