import {
    Engine,
    Scene,
    ArcRotateCamera,
    Vector3,
    Color3,
    DirectionalLight,
    HemisphericLight,
    MeshBuilder,
    PBRMaterial,
    Mesh,
    AbstractMesh,
    SceneLoader,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF'; // 註冊 glTF 載入器與 KHR 擴充
import { KHR_materials_variants } from '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_variants';

import { EnvironmentManager, BackgroundMode } from '../managers/environmentManager';
import { PostProcessManager } from '../managers/postProcessManager';
import { ShadowManager } from '../managers/shadowManager';
import { MaterialConfigurator, PartInfo, FinishInfo, TintInfo } from './materialConfigurator';

const SHOE_URL: string = require('../../res/models/shoe.glb');

export interface ConfiguratorReadyInfo {
    variants: string[];
    activeVariant: string;
    parts: PartInfo[];
    finishes: FinishInfo[];
    tints: TintInfo[];
}

/** 打光預設：主光 / 環境光 / 補光強度的組合 */
interface LightingPreset {
    keyIntensity: number;
    envIntensity: number;
    fillIntensity: number;
    keyDirection: Vector3;
}

const LIGHTING_PRESETS: Record<string, LightingPreset> = {
    soft: { keyIntensity: 2.2, envIntensity: 1.1, fillIntensity: 0.15, keyDirection: new Vector3(-0.5, -1, -0.6) },
    dramatic: { keyIntensity: 3.6, envIntensity: 0.45, fillIntensity: 0.05, keyDirection: new Vector3(-0.9, -0.6, -0.3) },
    ecom: { keyIntensity: 2.0, envIntensity: 1.7, fillIntensity: 0.4, keyDirection: new Vector3(-0.3, -1, -0.4) },
};

/**
 * 產品配置器場景
 * @description 以 Babylon.js 打造的 3D 產品 viewer / 材質配置器：
 * 載入 glTF 產品模型（內建 KHR_materials_variants 材質變體），
 * 置於開放式 studio 環境（IBL 環境光 + 柔和陰影 + 後製管線），
 * ArcRotateCamera 提供轉盤自動旋轉與滑鼠軌道操作。
 */
export class ConfiguratorView {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private camera!: ArcRotateCamera;

    private environmentManager!: EnvironmentManager;
    private shadowManager!: ShadowManager;
    private postProcessManager!: PostProcessManager;
    private _keyLight!: DirectionalLight; // 主光（陰影來源）
    private _fillLight!: HemisphericLight; // 半球補光

    private productRoot?: AbstractMesh; // 載入模型的根節點（變體切換的對象）
    private materialConfigurator!: MaterialConfigurator;
    private variants: string[] = [];
    private activeVariant = '';

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        this.scene = new Scene(this.engine);
        this.scene.useRightHandedSystem = true;

        window.addEventListener('resize', () => this.engine.resize());
    }

    /**
     * 初始化場景並載入產品模型
     * @returns 可用的材質變體資訊，供 UI 建立切換按鈕
     */
    public async init(): Promise<ConfiguratorReadyInfo> {
        this._initCamera();
        this._initLights();

        // 沿用通用的環境光照 / 陰影 / 後製管線（與主場景共用同一套渲染質感）
        this.environmentManager = new EnvironmentManager(this.scene);
        this.environmentManager.apply();

        this._initGround();

        this.shadowManager = new ShadowManager(this.scene, this._keyLight);
        this.shadowManager.init();

        await this._loadProduct();
        this._frameCameraToProduct();

        this.postProcessManager = new PostProcessManager(this.scene, [this.camera]);
        this.postProcessManager.apply();

        return {
            variants: this.variants,
            activeVariant: this.activeVariant,
            parts: this.materialConfigurator.getParts(),
            finishes: this.materialConfigurator.getFinishes(),
            tints: this.materialConfigurator.getTints(),
        };
    }

    /**
     * 轉盤相機：ArcRotateCamera + 自動旋轉行為（互動時暫停）
     */
    private _initCamera() {
        this.camera = new ArcRotateCamera('productCamera', -Math.PI / 2.5, Math.PI / 2.4, 5, Vector3.Zero(), this.scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.wheelPrecision = 40;
        this.camera.lowerRadiusLimit = 1.5;
        this.camera.upperRadiusLimit = 12;
        this.camera.lowerBetaLimit = 0.1;
        this.camera.upperBetaLimit = Math.PI / 1.9; // 避免轉到地板下方
        this.camera.minZ = 0.05;
        this.camera.panningSensibility = 0; // 鎖定平移，聚焦在產品上
        // 轉盤自動旋轉，使用者操作後會自動暫停再恢復
        this.camera.useAutoRotationBehavior = true;
        if (this.camera.autoRotationBehavior) {
            this.camera.autoRotationBehavior.idleRotationSpeed = 0.25;
            this.camera.autoRotationBehavior.idleRotationWaitTime = 2500;
            this.camera.autoRotationBehavior.zoomStopsAnimation = false;
        }
    }

    /**
     * 主光（方向光，陰影來源）+ 微弱半球補光（IBL 為主要照明）
     */
    private _initLights() {
        this._keyLight = new DirectionalLight('keyLight', new Vector3(-0.5, -1, -0.6), this.scene);
        this._keyLight.intensity = 2.2;
        this._keyLight.position = new Vector3(4, 8, 5);

        this._fillLight = new HemisphericLight('fillLight', new Vector3(0, 1, 0), this.scene);
        this._fillLight.intensity = 0.15;
        this._fillLight.diffuse = new Color3(1, 1, 1);
        this._fillLight.groundColor = new Color3(0.2, 0.2, 0.25);
    }

    /**
     * 展示台地板：平滑 PBR 地面，透過 IBL 反射 studio 環境，並接收陰影
     */
    private _initGround() {
        const ground = MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, this.scene);
        const mat = new PBRMaterial('groundMat', this.scene);
        mat.albedoColor = new Color3(0.06, 0.06, 0.07);
        mat.metallic = 0.3;
        mat.roughness = 0.35; // 略帶反射，呈現產品攝影棚地板質感
        mat.environmentIntensity = 0.6;
        ground.material = mat;
        ground.receiveShadows = true;
        ground.position.y = 0;
    }

    /**
     * 載入產品模型並讀取其材質變體
     */
    private async _loadProduct() {
        const result = await SceneLoader.ImportMeshAsync(null, '', SHOE_URL, this.scene);
        this.productRoot = result.meshes[0];

        // 讓模型站在地板上：以階層包圍盒底部對齊 y=0
        const { min } = this.productRoot.getHierarchyBoundingVectors(true);
        this.productRoot.position.y -= min.y;

        // 讀取 KHR_materials_variants 材質變體
        try {
            this.variants = KHR_materials_variants.GetAvailableVariants(this.productRoot as Mesh) ?? [];
        } catch {
            this.variants = [];
        }
        if (this.variants.length > 0) {
            this.activeVariant = this.variants[0];
            KHR_materials_variants.SelectVariant(this.productRoot as Mesh, this.activeVariant);
        }

        // 掃描部件並建立材質配置器（自動判斷單一 mesh 或多部件模型）
        this.materialConfigurator = new MaterialConfigurator(this.productRoot);
    }

    /**
     * 將相機框景到產品中心
     */
    private _frameCameraToProduct() {
        if (!this.productRoot) return;
        const { min, max } = this.productRoot.getHierarchyBoundingVectors(true);
        const center = min.add(max).scale(0.5);
        const size = max.subtract(min);
        const radius = Math.max(size.x, size.y, size.z);

        this.camera.setTarget(center);
        this.camera.radius = radius * 2.2;
        this.camera.lowerRadiusLimit = radius * 1.2;
        this.camera.upperRadiusLimit = radius * 4;
    }

    /**
     * 切換 colorway 材質變體（midnight / beach / street …）
     * @description 變體會整套抽換材質，因此切換後重新疊回使用者的 finish / tint 選擇。
     */
    public selectVariant(variantName: string) {
        if (!this.productRoot || !this.variants.includes(variantName)) return;
        KHR_materials_variants.SelectVariant(this.productRoot as Mesh, variantName);
        this.activeVariant = variantName;
        this.materialConfigurator.reapplyAll();
    }

    /** 套用 finish 質感到指定部件 */
    public applyFinish(partId: string, finishId: string) {
        this.materialConfigurator.applyFinish(partId, finishId);
    }

    /** 套用顏色 tint 到指定部件 */
    public applyTint(partId: string, tintId: string) {
        this.materialConfigurator.applyTint(partId, tintId);
    }

    /** 套用打光預設（柔光棚 / 戲劇側光 / 電商白） */
    public applyLightingPreset(name: string) {
        const preset = LIGHTING_PRESETS[name];
        if (!preset) return;
        this._keyLight.intensity = preset.keyIntensity;
        this._keyLight.direction = preset.keyDirection.clone();
        this._fillLight.intensity = preset.fillIntensity;
        this.environmentManager.setIntensity(preset.envIntensity);
    }

    /** 主光強度 */
    public setKeyLightIntensity(value: number) {
        this._keyLight.intensity = value;
    }

    /** 主光色溫（Kelvin，約 2700~9000） */
    public setKeyLightTemperature(kelvin: number) {
        this._keyLight.diffuse = kelvinToColor3(kelvin);
    }

    /** 環境光（IBL）強度 */
    public setEnvIntensity(value: number) {
        this.environmentManager.setIntensity(value);
    }

    /** 環境貼圖旋轉（弧度） */
    public setEnvRotation(radians: number) {
        this.environmentManager.setRotationY(radians);
    }

    /** 背景模式 */
    public setBackgroundMode(mode: BackgroundMode) {
        this.environmentManager.setBackgroundMode(mode);
    }

    /**
     * 開關自動旋轉
     */
    public setAutoRotate(enabled: boolean) {
        this.camera.useAutoRotationBehavior = enabled;
        if (enabled && this.camera.autoRotationBehavior) {
            this.camera.autoRotationBehavior.idleRotationSpeed = 0.25;
        }
    }

    /**
     * 重置相機視角
     */
    public resetView() {
        this.camera.alpha = -Math.PI / 2.5;
        this.camera.beta = Math.PI / 2.4;
        this._frameCameraToProduct();
    }

    public run() {
        this.engine.runRenderLoop(() => this.scene.render());
    }
}

/**
 * 色溫（Kelvin）轉 RGB（Tanner Helland 近似），供主光暖/冷色調調整
 */
function kelvinToColor3(kelvin: number): Color3 {
    const t = Math.min(Math.max(kelvin, 1000), 12000) / 100;
    let r: number;
    let g: number;
    let b: number;

    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }

    if (t >= 66) {
        b = 255;
    } else if (t <= 19) {
        b = 0;
    } else {
        b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    }

    const clamp = (v: number) => Math.min(Math.max(v, 0), 255) / 255;
    return new Color3(clamp(r), clamp(g), clamp(b));
}
