import {
    Scene,
    Camera,
    DefaultRenderingPipeline,
    SSAO2RenderingPipeline,
    Color4,
} from '@babylonjs/core';
import { RenderConfig } from '../config/scene/renderConfig';

/**
 * 後製管線管理器
 * @description 套用 DefaultRenderingPipeline（MSAA、FXAA、克制的 bloom、film grain）與
 * image processing 的 vignette，選配 SSAO2 環境光遮蔽（接觸陰影）。
 *
 * tone mapping / 曝光 / 對比沿用 scene.imageProcessingConfiguration（由 EnvironmentManager 設定）；
 * DefaultRenderingPipeline 的 imageProcessing 與場景共用同一份設定，並改為 applyByPostProcess，
 * 因此 tone mapping 只會在後製階段套用一次，不會與 PBR 材質重複疊加。
 */
export class PostProcessManager {
    private scene: Scene;
    private cameras: Camera[];
    private pipeline?: DefaultRenderingPipeline;
    private ssao?: SSAO2RenderingPipeline;

    constructor(scene: Scene, cameras: Camera[]) {
        this.scene = scene;
        this.cameras = cameras.filter(Boolean);
    }

    /**
     * 建立並套用後製管線
     */
    public apply() {
        this._applyMainPipeline();
        if (RenderConfig.postProcess.ssao.enabled) {
            this._applySSAO();
        }
    }

    private _applyMainPipeline() {
        const cfg = RenderConfig.postProcess;

        this.pipeline = new DefaultRenderingPipeline('defaultPipeline', true, this.scene, this.cameras);
        this.pipeline.samples = cfg.msaaSamples; // MSAA
        this.pipeline.fxaaEnabled = cfg.fxaa;

        // 克制的 bloom：高光微微溢出，營造專業 render 光澤而不過曝
        this.pipeline.bloomEnabled = cfg.bloom.enabled;
        if (cfg.bloom.enabled) {
            this.pipeline.bloomThreshold = cfg.bloom.threshold;
            this.pipeline.bloomWeight = cfg.bloom.weight;
            this.pipeline.bloomKernel = cfg.bloom.kernel;
            this.pipeline.bloomScale = cfg.bloom.scale;
        }

        // film grain，避免暗部色帶（banding）並增加電影感
        this.pipeline.grainEnabled = cfg.grain.enabled;
        if (cfg.grain.enabled) {
            this.pipeline.grain.intensity = cfg.grain.intensity;
            this.pipeline.grain.animated = true;
        }

        // vignette 走共用的 image processing 設定（由後製階段一次套用）
        if (cfg.vignette.enabled) {
            const ip = this.pipeline.imageProcessing;
            ip.vignetteEnabled = true;
            ip.vignetteWeight = cfg.vignette.weight;
            ip.vignetteColor = new Color4(0, 0, 0, 0);
        }
    }

    /**
     * SSAO2 環境光遮蔽：在物件接縫/接觸處加上柔和陰影，大幅提升立體與真實感
     */
    private _applySSAO() {
        const cfg = RenderConfig.postProcess.ssao;
        this.ssao = new SSAO2RenderingPipeline('ssao', this.scene, cfg.ratio, this.cameras);
        this.ssao.radius = cfg.radius;
        this.ssao.totalStrength = cfg.totalStrength;
        this.ssao.expensiveBlur = true;
        this.ssao.samples = 16;
    }

    /**
     * 釋放資源
     */
    public destroy() {
        this.pipeline?.dispose();
        this.ssao?.dispose();
        this.pipeline = undefined;
        this.ssao = undefined;
    }
}
