import type { EffectDef } from './types';
import { dissolveEffect } from './dissolve';
import { displacementEffect } from './displacement';

/**
 * Lab 的效果清單。加一個新 shader = 寫一個 EffectDef 檔案，然後在這裡多推一筆——
 * 頁面、面板、參數控制項、原始碼檢視都會自動長出來。
 */
export const EFFECTS: EffectDef[] = [dissolveEffect, displacementEffect];

export function getEffect(id: string): EffectDef {
    return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}

export * from './types';
