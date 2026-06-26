import {
    Scene,
    CubeTexture,
    Color3,
    Color4,
    Mesh,
    ImageProcessingConfiguration,
    Layer,
    DynamicTexture,
} from '@babylonjs/core';
import { EnvPack } from '../constants/assets';
import { RenderConfig } from '../config/scene/renderConfig';

/** 背景呈現模式 */
export type BackgroundMode = 'studio' | 'dark' | 'white' | 'gradient';

/**
 * 環境光照（IBL）管理器
 * @description 以 prefiltered .env 環境貼圖作為 image-based lighting 來源，
 * 讓場景中大量 PBR 材質取得正確的環境反射與環境光（否則 PBR 會呈現死板的塑膠感）。
 * 同時建立模糊的 studio 背景天空盒，並設定 ACES tone mapping 以貼近專業 render 的色彩響應。
 */
export class EnvironmentManager {
    private scene: Scene;
    private envTexture?: CubeTexture;
    private skybox?: Mesh;
    private gradientLayer?: Layer;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * 套用環境光照、天空盒與影像後處理設定
     */
    public apply() {
        this._applyImageProcessing();
        this._applyEnvironmentTexture();
    }

    /**
     * 載入 IBL 環境貼圖並（選擇性）建立模糊背景天空盒
     */
    private _applyEnvironmentTexture() {
        const { intensity, createSkybox, skyboxBlur } = RenderConfig.environment;

        this.envTexture = CubeTexture.CreateFromPrefilteredData(EnvPack.studio, this.scene);
        this.scene.environmentTexture = this.envTexture;
        this.scene.environmentIntensity = intensity;

        if (createSkybox) {
            // pbr=true 讓背景使用環境貼圖；blur 讓背景柔和不搶戲
            this.skybox = this.scene.createDefaultSkybox(this.envTexture, true, 1000, skyboxBlur) ?? undefined;
            if (this.skybox) {
                this.skybox.name = 'environmentSkybox';
                this.skybox.infiniteDistance = true;
            }
        } else {
            // 沒有天空盒時給一個中性深色清除色，避免純黑
            this.scene.clearColor = new Color3(0.04, 0.045, 0.06).toColor4(1);
        }
    }

    /**
     * 設定 tone mapping / 曝光 / 對比（全域 image processing）
     */
    private _applyImageProcessing() {
        const ip = this.scene.imageProcessingConfiguration;
        ip.toneMappingEnabled = true;
        ip.toneMappingType = RenderConfig.imageProcessing.toneMappingType as ImageProcessingConfiguration['toneMappingType'];
        ip.exposure = RenderConfig.imageProcessing.exposure;
        ip.contrast = RenderConfig.imageProcessing.contrast;
    }

    /**
     * 調整 IBL 環境光整體強度（影響所有 PBR 材質的環境光與反射亮度）
     */
    public setIntensity(value: number) {
        this.scene.environmentIntensity = value;
    }

    /**
     * 旋轉環境貼圖（弧度）— 等於轉動攝影棚，改變反射與受光方向
     */
    public setRotationY(radians: number) {
        if (this.envTexture) {
            this.envTexture.rotationY = radians;
        }
    }

    /**
     * 切換背景呈現：studio 天空盒 / 純深色 / 純白電商 / 漸層
     * @description IBL 環境光與反射一律保留，只改變「可見背景」。
     */
    public setBackgroundMode(mode: BackgroundMode) {
        const showSkybox = mode === 'studio';
        this.skybox?.setEnabled(showSkybox);

        if (mode === 'gradient') {
            this._ensureGradientLayer();
            if (this.gradientLayer) this.gradientLayer.isEnabled = true;
        } else if (this.gradientLayer) {
            this.gradientLayer.isEnabled = false;
        }

        switch (mode) {
            case 'dark':
                this.scene.clearColor = new Color4(0.04, 0.045, 0.06, 1);
                break;
            case 'white':
                // 場景採 ACES tone mapping，clearColor 需給 >1 的 HDR 值，後製後才接近純白
                this.scene.clearColor = new Color4(4, 4, 4.1, 1);
                break;
            default:
                // studio / gradient：清除色被天空盒或漸層覆蓋，給中性底色即可
                this.scene.clearColor = new Color4(0.04, 0.045, 0.06, 1);
        }
    }

    /**
     * 建立一張垂直漸層背景（以 DynamicTexture 畫在背景 Layer 上，全程在引擎內，無需透明畫布）
     */
    private _ensureGradientLayer() {
        if (this.gradientLayer) return;

        const size = 512;
        const tex = new DynamicTexture('bgGradient', { width: 2, height: size }, this.scene, false);
        const ctx = tex.getContext() as CanvasRenderingContext2D;
        const grad = ctx.createLinearGradient(0, 0, 0, size);
        grad.addColorStop(0, '#2a2d3a'); // 上方偏冷
        grad.addColorStop(1, '#0d0e12'); // 下方深色
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, size);
        tex.update(false);

        this.gradientLayer = new Layer('bgGradientLayer', null, this.scene, true);
        this.gradientLayer.texture = tex;
    }

    /**
     * 釋放資源
     */
    public destroy() {
        this.gradientLayer?.dispose();
        this.skybox?.dispose();
        this.envTexture?.dispose();
        this.gradientLayer = undefined;
        this.skybox = undefined;
        this.envTexture = undefined;
    }
}
