import { create } from 'zustand';
import { EFFECTS, defaultValues, type ParamValue, type ParamValues } from './effects';

export type SourceTab = 'glsl' | 'wgsl';
export type Backend = 'webgl' | 'webgpu';

interface LabState {
    /** 目前選中的效果 */
    effectId: string;
    /** 每個效果各自的參數值（切換效果不會弄丟先前調好的值） */
    values: Record<string, ParamValues>;
    /** 自動播放：由舞台驅動效果宣告的 animate 參數 */
    animating: boolean;
    sourceTab: SourceTab;
    /** 實際跑起來的 backend——由舞台在 init 後回填（preference 只是偏好，不支援會退回） */
    backend: Backend | null;
    fps: number;

    selectEffect: (id: string) => void;
    setParam: (key: string, value: ParamValue) => void;
    setAnimating: (on: boolean) => void;
    setSourceTab: (tab: SourceTab) => void;
    setBackend: (b: Backend) => void;
    setFps: (fps: number) => void;
    resetParams: () => void;
}

const initialValues = (): Record<string, ParamValues> =>
    Object.fromEntries(EFFECTS.map((e) => [e.id, defaultValues(e)]));

export const useLabStore = create<LabState>((set) => ({
    effectId: EFFECTS[0].id,
    values: initialValues(),
    animating: true,
    sourceTab: 'glsl',
    backend: null,
    fps: 0,

    selectEffect: (id) => set({ effectId: id }),
    setParam: (key, value) =>
        set((s) => ({
            values: { ...s.values, [s.effectId]: { ...s.values[s.effectId], [key]: value } },
        })),
    setAnimating: (animating) => set({ animating }),
    setSourceTab: (sourceTab) => set({ sourceTab }),
    setBackend: (backend) => set({ backend }),
    setFps: (fps) => set({ fps }),
    resetParams: () =>
        set((s) => {
            const def = EFFECTS.find((e) => e.id === s.effectId)!;
            return { values: { ...s.values, [s.effectId]: defaultValues(def) } };
        }),
}));

/** 給 Pixi 側用：canvas 內不跑 React，直接讀 store 快照。 */
export const labState = () => useLabStore.getState();
