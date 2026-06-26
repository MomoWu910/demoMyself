import { ImageProcessingConfiguration } from '@babylonjs/core';

/**
 * 渲染質感集中設定
 * @description IBL 環境光、陰影、後製管線的可調參數統一放這裡，
 * 方便調校與閱讀（風格：高級寫實感 — 中性 studio HDR、柔和陰影、克制 bloom、ACES tone mapping）。
 */
export const RenderConfig = {
    // 環境光照（IBL）與背景
    environment: {
        // 環境貼圖對 PBR 材質反射 / 環境光的整體強度
        intensity: 1.1,
        // 是否建立模糊的 studio 背景天空盒（取代純黑虛空）
        createSkybox: true,
        // 天空盒模糊程度（0~1，越大越柔和、越不搶戲）
        skyboxBlur: 0.25,
    },

    // 影像後處理（tone mapping / 曝光 / 對比）
    imageProcessing: {
        // ACES Filmic tone mapping，最接近專業 render 的色彩響應
        toneMappingType: ImageProcessingConfiguration.TONEMAPPING_ACES,
        exposure: 1.1,
        contrast: 1.15,
    },

    // 陰影
    shadow: {
        // shadow map 解析度（2048 兼顧品質與效能）
        mapSize: 2048,
        // 柔和陰影模糊核心大小
        blurKernel: 32,
        darkness: 0.35,
        // 陰影偏移，避免自陰影產生的 acne / peter-panning
        bias: 0.0015,
        normalBias: 0.012,
    },

    // 後製管線
    postProcess: {
        // MSAA 取樣數（抗鋸齒）
        msaaSamples: 4,
        fxaa: true,
        bloom: {
            enabled: true,
            // 克制的 bloom：只讓高光微微溢出，不過曝
            threshold: 0.85,
            weight: 0.18,
            kernel: 64,
            scale: 0.5,
        },
        vignette: {
            enabled: true,
            weight: 1.6,
        },
        grain: {
            enabled: true,
            intensity: 6,
        },
        // 環境光遮蔽（接觸陰影）— 提升真實感但較吃效能，可關閉
        ssao: {
            enabled: true,
            ratio: 0.75,
            radius: 1.2,
            totalStrength: 1.1,
        },
    },
} as const;
