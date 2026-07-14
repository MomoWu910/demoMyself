import type { BenchReport } from '../bench';
import webgl from './results/webgl.json';
import webgpu from './results/webgpu.json';

/**
 * 真機實測結果。
 *
 * 這兩個 JSON 是 Optimization Lab 的 Run Benchmark 直接產生、原樣存檔的——
 * 沒有手動修飾過任何一個數字。要重現，就自己去 Lab 按一次 Run Benchmark。
 *
 * WebGL 的 drawCalls 是攔截 GL 繪製指令數出來的；WebGPU 那欄是 null，
 * 因為指令錄在 GPURenderPassEncoder 上、沒有等價的攔截點——寧可標 n/a 也不填 0。
 */
export const REPORTS: BenchReport[] = [webgl as BenchReport, webgpu as BenchReport];

/**
 * 結論。
 *
 * 規則：每一條都必須能被上面的數據直接支撐。寫得出漂亮的話但數據撐不住，就不要寫。
 * 文案在 i18n 字典裡，key 為 `${key}.title` / `.body` / `.takeaway`。
 */
export interface Finding {
    key: string;
}

export const FINDINGS: Finding[] = [
    { key: 'findings.f1' },
    { key: 'findings.f2' },
    { key: 'findings.f3' },
    { key: 'findings.f4' },
];
