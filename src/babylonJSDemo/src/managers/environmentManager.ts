import { Scene, CubeTexture, Color3, Mesh, ImageProcessingConfiguration } from '@babylonjs/core';
import { EnvPack } from '../constants/assets';
import { RenderConfig } from '../config/scene/renderConfig';

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
     * 釋放資源
     */
    public destroy() {
        this.skybox?.dispose();
        this.envTexture?.dispose();
        this.skybox = undefined;
        this.envTexture = undefined;
    }
}
