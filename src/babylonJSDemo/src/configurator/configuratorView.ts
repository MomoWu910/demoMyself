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

/**
 * 鏡頭機位。
 *
 * 只存 alpha / beta / 距離倍率，不存絕對 radius——實際距離是 `_baseRadius`（依模型
 * 尺寸算出來的框景距離）乘上這個倍率，換一顆大小完全不同的模型也不必重調這張表。
 *
 * `free` 是使用者自己拖出來的視角，沒有座標可言，所以它不在這張表裡：拖動相機時
 * store 的 cameraView 會被設成 'free'，代表「現在不對應任何一個機位」。
 */
export type CameraViewId = 'hero' | 'side' | 'front' | 'top' | 'detail';

export const CAMERA_VIEWS: Record<CameraViewId, { alpha: number; beta: number; radiusScale: number }> = {
    hero: { alpha: -Math.PI / 2.5, beta: Math.PI / 2.4, radiusScale: 1 },      // 預設的 3/4 側前
    side: { alpha: -Math.PI / 2, beta: Math.PI / 2.05, radiusScale: 0.92 },    // 正側面，看輪廓線
    front: { alpha: 0, beta: Math.PI / 2.15, radiusScale: 0.95 },              // 正面
    top: { alpha: -Math.PI / 2.5, beta: 0.42, radiusScale: 1.05 },             // 俯視，看鞋面配色分佈
    detail: { alpha: -Math.PI / 3.4, beta: Math.PI / 2.7, radiusScale: 0.66 }, // 近拍材質
};

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
    private _groundMat?: PBRMaterial;
    /** 鏡頭 tween 的目標角度；null = 沒有正在進行的機位切換 */
    private _viewTween: { alpha: number; beta: number } | null = null;
    /** 目前機位的距離倍率，乘在 _baseRadius 上（見 CAMERA_VIEWS） */
    private _viewRadiusScale = 1;
    private postProcessManager!: PostProcessManager;
    private _keyLight!: DirectionalLight; // 主光（陰影來源）
    private _fillLight!: HemisphericLight; // 半球補光

    private productRoot?: AbstractMesh; // 載入模型的根節點（變體切換的對象）
    private materialConfigurator!: MaterialConfigurator;
    private variants: string[] = [];
    private activeVariant = '';
    private _bottomObstruction = 0; // 被底部 UI 蓋住的高度（px，手機 bottom sheet）
    private _baseRadius = 0;        // 全螢幕可視時的框景距離（radius 的基準）
    private _desiredRadius = 0;     // 遮擋變化時要 lerp 到的 radius
    private _radiusLerp = false;    // 只在遮擋改變後短暫接管 radius，不干擾使用者滾輪縮放

    /**
     * 使用者自己動了相機（拖曳軌道或滾輪縮放）時通知一次。
     *
     * UI 靠它把「目前機位」的高亮拿掉：畫面已經不是那個機位了，按鈕卻還亮著的話，
     * 使用者會以為自己按的沒有生效。不從 camera 的矩陣變化去判斷，是因為 tween 與
     * 自動旋轉也會改矩陣，分不出是誰動的。
     */
    public onUserOrbit?: () => void;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        this.scene = new Scene(this.engine);
        this.scene.useRightHandedSystem = true;

        window.addEventListener('resize', () => this.engine.resize());

        canvas.addEventListener('pointermove', (e) => {
            if (e.buttons !== 0) this.onUserOrbit?.(); // 按著拖才算，單純滑過去不算
        });
        canvas.addEventListener('wheel', () => this.onUserOrbit?.(), { passive: true });
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

        // 依底部 UI 遮擋量把框景中心平滑上移，讓產品置中在「沒被蓋住」的可視區；
        // 同時把 radius 拉遠，讓產品「塞得進」變小的可視區
        this.scene.onBeforeRenderObservable.add(() => {
            const renderH = this.engine.getRenderHeight();
            if (renderH <= 0) return;
            const frac = this._bottomObstruction / (2 * renderH);
            const worldH = 2 * this.camera.radius * Math.tan(this.camera.fov / 2);
            const desired = frac * worldH;
            const cur = this.camera.targetScreenOffset.y;
            this.camera.targetScreenOffset.y = cur + (desired - cur) * 0.12;

            if (this._radiusLerp) {
                const d = this._desiredRadius - this.camera.radius;
                if (Math.abs(d) < 0.002) this._radiusLerp = false;
                else this.camera.radius += d * 0.12;
            }

            this._stepViewTween();
        });

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
        mat.metallic = 0.3;
        mat.roughness = 0.35; // 略帶反射，呈現產品攝影棚地板質感
        mat.environmentIntensity = 0.6;
        ground.material = mat;
        ground.receiveShadows = true;
        ground.position.y = 0;
        this._groundMat = mat;
        this._applyGroundTone('studio');
    }

    /**
     * 地板色跟著背景模式走。
     *
     * 分開一個 method 是因為背景與地板本來就是「同一件事的兩半」：切成 White 卻只換
     * scene.clearColor 的話，畫面會上半純白、下半深灰，接縫就在地平線上——看起來
     * 不像去背，像背景破圖。電商白要的是無縫白，所以地板要一起變亮。
     */
    private _applyGroundTone(mode: BackgroundMode) {
        if (!this._groundMat) return;
        if (mode === 'white') {
            // albedo 上限是 1，而場景走 ACES tone mapping 會把它壓成灰；
            // 補在 environmentIntensity 上（IBL 是這面地板的主要照明來源）才推得到接近白。
            this._groundMat.albedoColor = new Color3(1, 1, 1);
            this._groundMat.environmentIntensity = 2.6;
            this._groundMat.roughness = 0.85; // 白底不要鏡面反射，否則會照出天空盒的深色
        } else {
            this._groundMat.albedoColor = new Color3(0.06, 0.06, 0.07);
            this._groundMat.environmentIntensity = 0.6;
            this._groundMat.roughness = 0.35;
        }
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
        this._baseRadius = radius * 2.2;
        this.camera.radius = this._baseRadius;
        this.camera.lowerRadiusLimit = radius * 1.2;
        this.camera.upperRadiusLimit = radius * 6;
        this._updateRadiusForObstruction();
    }

    /** 依可視高度比例決定框景距離：可視區越小、radius 越遠，產品維持相同相對大小 */
    private _updateRadiusForObstruction() {
        if (this._baseRadius <= 0) return;
        const H = this.engine.getRenderHeight();
        const visible = Math.max(0.4, 1 - this._bottomObstruction / Math.max(1, H));
        this._desiredRadius = (this._baseRadius * this._viewRadiusScale) / visible;
        this._radiusLerp = true;
    }

    /**
     * 切到某個機位。
     *
     * 兩件事值得說明：
     * ① **自動旋轉會被關掉**——它每一幀都在推 alpha，跟 tween 同時跑的話會邊轉邊被拉回，
     *    看起來像卡住。選機位本來就是「我要這個構圖」，跟自動展示是互斥的意圖。
     * ② **alpha 走最短路徑**：目前 -2.5 要轉到 0，直接 lerp 會繞遠路（甚至反方向轉快一整圈），
     *    先把角度差折進 ±π 再補回去。
     */
    public setCameraView(id: CameraViewId) {
        const v = CAMERA_VIEWS[id];
        if (!v) return;

        this.setAutoRotate(false);

        const twoPi = Math.PI * 2;
        let d = (v.alpha - this.camera.alpha) % twoPi;
        if (d > Math.PI) d -= twoPi;
        if (d < -Math.PI) d += twoPi;

        this._viewTween = { alpha: this.camera.alpha + d, beta: v.beta };
        this._viewRadiusScale = v.radiusScale;
        this._updateRadiusForObstruction();
    }

    /** 機位切換的每幀推進。與 radius 的 lerp 同樣的收斂寫法，速度也刻意一致。 */
    private _stepViewTween() {
        const t = this._viewTween;
        if (!t) return;
        const da = t.alpha - this.camera.alpha;
        const db = t.beta - this.camera.beta;
        if (Math.abs(da) < 0.001 && Math.abs(db) < 0.001) {
            this.camera.alpha = t.alpha;
            this.camera.beta = t.beta;
            this._viewTween = null;
            return;
        }
        this.camera.alpha += da * 0.12;
        this.camera.beta += db * 0.12;
    }

    /**
     * 匯出目前畫面的 PNG（回傳 data URL）。
     *
     * **刻意讀 canvas 而不是另開 RenderTarget 重畫**：這顆場景的 bloom / vignette / grain /
     * SSAO 都掛在 camera 的 post-process 管線上，RTT 那條路徑不會套用它們，匯出的圖會跟
     * 使用者眼前調了半天的畫面長得不一樣——「所見即所得」在配置器裡是重點，不是小事。
     * engine 建構時已開 preserveDrawingBuffer，canvas 讀得到內容。
     *
     * 解析度靠 hardwareScalingLevel 暫時調高（scale=2 → 內部 buffer 兩倍寬高，真的用更多
     * 像素重畫一次），不是把小圖放大。截完必須還原，否則使用者會留在 2 倍負載的畫面上。
     */
    public async captureScreenshot(scale = 2): Promise<string> {
        const prevScaling = this.engine.getHardwareScalingLevel();
        // 手機把面板頂上來時相機是偏移的；那是為了避開 UI，不該烙進成品圖
        const prevOffsetY = this.camera.targetScreenOffset.y;
        const prevObstruction = this._bottomObstruction;

        try {
            this._bottomObstruction = 0;
            this.camera.targetScreenOffset.y = 0;
            this.engine.setHardwareScalingLevel(prevScaling / scale);
            this.engine.resize();
            this.scene.render();
            return this.canvas.toDataURL('image/png');
        } finally {
            this.engine.setHardwareScalingLevel(prevScaling);
            this.engine.resize();
            this._bottomObstruction = prevObstruction;
            this.camera.targetScreenOffset.y = prevOffsetY;
        }
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

    /** 背景模式（含地板色——見 _applyGroundTone） */
    public setBackgroundMode(mode: BackgroundMode) {
        this.environmentManager.setBackgroundMode(mode);
        this._applyGroundTone(mode);
    }

    /** 底部 UI（bottom sheet / 工具列）目前蓋住的畫面高度，供相機框景避開 */
    public setBottomObstruction(px: number) {
        this._bottomObstruction = Math.max(0, px);
        this._updateRadiusForObstruction();
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
        const hero = CAMERA_VIEWS.hero;
        this._viewTween = null; // 重置是「立刻回到原位」，不跟正在進行的機位 tween 搶
        this._viewRadiusScale = hero.radiusScale;
        this.camera.alpha = hero.alpha;
        this.camera.beta = hero.beta;
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
