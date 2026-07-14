import type { Filter } from 'pixi.js';

/** 面板上的一個可調參數。kind 決定 React 面板長出 slider 還是 color picker。 */
export type ParamDef =
    | {
          kind: 'range';
          key: string;
          /** i18n key，面板顯示用 */
          labelKey: string;
          min: number;
          max: number;
          step: number;
          default: number;
      }
    | {
          kind: 'color';
          key: string;
          labelKey: string;
          /** #rrggbb */
          default: string;
      };

export type ParamValue = number | string;

export type ParamValues = Record<string, ParamValue>;

/**
 * 一個效果的定義。
 *
 * shader 本體、兩份原始碼、可調參數、以及「這個效果貴在哪裡」的說明綁在一起——
 * 因為這個 Lab 的重點不只是「做得出效果」，而是「知道它的代價」。
 */
export interface EffectDef {
    id: string;
    /** i18n key 前綴：{i18nKey}.title / .desc / .cost */
    i18nKey: string;
    params: ParamDef[];
    /** 面板要原封不動展示這兩份原始碼——雙寫本身就是這個 Lab 的主張 */
    sources: { glsl: string; wgsl: string };
    /** 建立 filter 實例 */
    create: () => Filter;
    /** 把面板上的參數值寫進 filter 的 uniform */
    apply: (filter: Filter, values: ParamValues) => void;
    /**
     * 宣告哪個參數可以被「自動播放」開關驅動（例如 dissolve 的 uProgress 來回擺盪）。
     * 舞台會在 [min, max] 之間來回產生值並寫回 store，面板的 slider 也會跟著動。
     * 範圍要收斂：跑滿 0→1 的話，兩個端點都是「什麼都看不到」的畫面。
     */
    animate?: { key: string; cycleSeconds: number; min: number; max: number };
    /** 每幀更新（例如把時間餵進 uTime）；不需要就省略 */
    tick?: (filter: Filter, elapsedSeconds: number) => void;
}

/** #rrggbb → 給 vec3 uniform 用的 0..1 三元組 */
export function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 取得預設值集合 */
export function defaultValues(def: EffectDef): ParamValues {
    const out: ParamValues = {};
    for (const p of def.params) out[p.key] = p.default;
    return out;
}
