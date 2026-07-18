import { create } from 'zustand';

export type Backend = 'webgl' | 'webgpu';

interface HomeState {
    /** 目前 hover / 鍵盤聚焦的節點 id（null = 沒有） */
    activeId: string | null;
    /** 正在進入哪個節點（點擊轉場中）——非 null 時舞台播放 zoom、overlay 淡出 */
    enteringId: string | null;
    /** 實際跑起來的 backend，由舞台 init 後回填 */
    backend: Backend | null;

    setActive: (id: string | null) => void;
    setEntering: (id: string | null) => void;
    setBackend: (b: Backend) => void;
}

export const useHomeStore = create<HomeState>((set) => ({
    activeId: null,
    enteringId: null,
    backend: null,
    setActive: (activeId) => set({ activeId }),
    setEntering: (enteringId) => set({ enteringId }),
    setBackend: (backend) => set({ backend }),
}));

/** 給 Pixi 側用：canvas 內不跑 React，直接讀快照。 */
export const homeState = () => useHomeStore.getState();
