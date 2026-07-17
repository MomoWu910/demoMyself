/**
 * Shader Lab 成本卡的「實測數字」。
 *
 * 這裡的數字不是手寫的——是 Eric 在自己機器上按面板的「量測成本」跑出來、
 * 從匯出的 JSON 抄進來的（跟 findings 頁同一套流程）。跑法見 ./runShaderBench.ts。
 *
 * 面板讀不到某個效果的數字時，成本卡會退回 i18n 的手寫敘述 `{i18nKey}.cost`，
 * 所以在填數字之前頁面照常運作、不會壞。
 *
 * ⚠️ 為什麼只留「draw call」這一欄（誠實地標出來，跟 bench 一路的原則一致）：
 * - **draw call** 是 WebGL 精確攔截得到的結構成本——filter 會把物件踢出合批、
 *   獨立成一個 render pass；mesh 材質不會。這是這些效果真正的成本分水嶺。
 * - 原本想量的「GPU fragment 相對成本」放棄了：把同一效果疊 48 層灌 fill rate，
 *   M2 Pro 連 frame time 都不掉（fps 穩在 120），四個效果的 cpuMs 全卡在 ~0.6ms 地板。
 *   瀏覽器又量不到 per-fragment 的 GPU 時間（需 EXT_disjoint_timer_query，已停用）。
 *   → 結論是：**這類 shader 貴在結構、不在數學**，所以成本卡只誠實講結構，不假裝有 GPU 數字。
 * - draw call 只有 WebGL 抓得到（WebGPU 的繪製指令錄在 GPURenderPassEncoder 上、攔不到），
 *   所以下面的數字統一取自一份 **WebGL** 報表，provenance 也標 WebGL。
 */

export interface ShaderCost {
    technique: 'filter' | 'mesh';
    /** 單一 sprite、無效果時的 draw call（WebGL） */
    drawBase: number | null;
    /** 單一 sprite、掛上效果後的 draw call（WebGL） */
    drawFx: number | null;
}

/** 「N 個各掛 filter vs 父容器單一 filter」的架構 finding 實測。 */
export interface LayeringFinding {
    /** 疊了幾個物件 */
    n: number;
    /** 每物件各掛一個 filter：draw call / CPU frame time（ms） */
    perObjectDraw: number | null;
    perObjectMs: number;
    /** 父容器單一 filter：draw call / CPU frame time（ms） */
    containerDraw: number | null;
    containerMs: number;
}

/** 這份數字是在什麼環境跑出來的——沒有環境敘述的效能數字沒有意義。 */
export interface CostProvenance {
    renderer: string;
    gpu: string;
    viewport: string;
    refreshHz: number;
    date: string;
}

/**
 * effectId → 實測成本。跑完 bench、拿到 JSON 後把數字填進來。
 * 留空的效果，成本卡會退回手寫敘述。
 */
export const SHADER_COSTS: Record<string, ShaderCost | undefined> = {
    // 2026-07-17 實測（WebGL，M2 Pro）：三個 filter 都是 1→2（各多一道 render pass），
    // 只有旗幟 1→1——mesh 材質跟著物件一起畫，不另開 pass。這一欄就是 filter vs mesh 的分水嶺。
    dissolve: { technique: 'filter', drawBase: 1, drawFx: 2 },
    displacement: { technique: 'filter', drawBase: 1, drawFx: 2 },
    chromatic: { technique: 'filter', drawBase: 1, drawFx: 2 },
    flag: { technique: 'mesh', drawBase: 1, drawFx: 1 },
};

/**
 * 架構 finding（2026-07-17 實測，WebGL，M2 Pro，N=200）：
 * 200 個各掛一個 filter → 400 draw call、11.7ms CPU、fps 掉到 84.7；
 * 全部塞進一個容器、只掛一個 filter → 2 draw call、0.2ms、穩在 120fps。
 * 同樣的畫面、同樣的物件數，差了 ~58× 的 CPU 成本，而且前者真的掉幀了。
 */
export const LAYERING_FINDING: LayeringFinding | null = {
    n: 200,
    perObjectDraw: 400,
    perObjectMs: 11.7,
    containerDraw: 2,
    containerMs: 0.2,
};

/**
 * 數字的出處環境。viewport 寫的是 bench app 實際固定的渲染尺寸（1280×720 @1x），
 * 不是瀏覽器視窗——量測就在這個尺寸下跑的。
 */
export const COST_PROVENANCE: CostProvenance | null = {
    renderer: 'webgl',
    gpu: 'Apple M2 Pro (ANGLE Metal)',
    viewport: '1280×720 @1x',
    refreshHz: 120,
    date: '2026-07-17',
};
