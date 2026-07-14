/**
 * 效能量測的資料型別。
 *
 * 主指標刻意選 CPU frame time 而非 FPS：畫面被 vsync 鎖在 60 / 120Hz 時，
 * 輕負載下每個案例都會回報 60fps，看不出誰吃掉了多少幀預算（frame budget）。
 * frame time 的中位數與 p95 才能同時反映「平均成本」與「卡頓」。
 */

/** 一組統計量（單位：毫秒） */
export interface Stat {
    median: number;
    p95: number;
    mean: number;
    min: number;
    max: number;
}

/** 一個待測案例 */
export interface BenchCase {
    id: string;
    label: string;
    /** 建置場景；回傳這個案例實際建立的物件數。 */
    setup: () => number | Promise<number>;
    /** 每幀邏輯。會被計入 CPU frame time。 */
    update?: (elapsedMs: number) => void;
    teardown?: () => void;
    /** 原樣帶進報表的標註，例如 { scenario: 'Tint vs Filter', mode: 'Naive' } */
    meta?: Record<string, string | number>;
}

export interface BenchResult {
    id: string;
    label: string;
    objectCount: number;
    /** CPU frame time：case.update + renderer.render 的同步耗時。 */
    cpuMs: Stat;
    /** 實際畫面幀率，由 rAF 間隔推算（掉幀時才有意義）。 */
    fps: number;
    /** 每幀 draw call 中位數。WebGPU 下無法以 hook GL 的方式攔截，故為 null。 */
    drawCalls: number | null;
    /** 取樣幀數 */
    samples: number;
    meta?: Record<string, string | number>;
}

export interface BenchConfig {
    /** 暖機幀數：等 JIT、texture upload、shader 編譯穩定下來，不計入統計。 */
    warmupFrames: number;
    /** 取樣幀數 */
    sampleFrames: number;
}

/** 測試環境——研究報告沒有環境敘述就沒有意義。 */
export interface BenchEnv {
    renderer: 'webgl' | 'webgpu' | string;
    gpu: string;
    userAgent: string;
    dpr: number;
    viewport: string;
    /** 由 rAF 間隔推算的螢幕更新率 */
    refreshHz: number;
    timestamp: string;
}

export interface BenchReport {
    env: BenchEnv;
    config: BenchConfig;
    results: BenchResult[];
}
