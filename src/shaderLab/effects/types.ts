import type { Filter } from 'pixi.js';

/** 一個可調參數：驅動 React 面板長出對應的 slider / color picker。 */
export interface EffectParam {
    key: string;
    /** i18n key，面板顯示用 */
    labelKey: string;
    min: number;
    max: number;
    step: number;
    default: number;
}

/**
 * 一個效果的定義。
 *
 * shader 本體、可調參數、以及「這個效果貴在哪裡」的說明綁在一起——
 * 因為這個 Lab 的重點不只是「做得出效果」，而是「知道它的代價」。
 */
export interface EffectDef {
    id: string;
    /** i18n key 前綴：{i18nKey}.title / .desc / .cost */
    i18nKey: string;
    params: EffectParam[];
    /** 建立 filter 實例 */
    create: () => Filter;
    /** 把面板上的參數值寫進 filter 的 uniform */
    apply: (filter: Filter, values: Record<string, number>) => void;
    /** 每幀更新（例如把時間餵進 uTime）；不需要就省略 */
    tick?: (filter: Filter, elapsedSeconds: number) => void;
}
