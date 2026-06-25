import { Scene, DirectionalLight, ShadowGenerator, AbstractMesh, Mesh, Observer } from '@babylonjs/core';
import { RenderConfig } from '../config/scene/renderConfig';

// 不投射陰影的結構/輔助物件（依名稱關鍵字判斷）
const CASTER_EXCLUDE = ['skybox', 'floor', 'wall', 'ceiling', 'ground', 'gui', 'plane'];
// 接收陰影的結構表面
const RECEIVER_INCLUDE = ['floor', 'table', 'wall', 'ceiling', 'ground'];

/**
 * 陰影管理器
 * @description 在主要方向光上建立柔和陰影（blur exponential shadow map），
 * 並透過 onNewMeshAdded 自動將後續非同步載入的模型（荷官、骰子、麻將、玩家）
 * 註冊為投影者；結構表面（地板、賭桌、牆）設為陰影接收者。
 */
export class ShadowManager {
    private scene: Scene;
    private light: DirectionalLight;
    private generator?: ShadowGenerator;
    private meshAddedObserver?: Observer<AbstractMesh> | null;

    constructor(scene: Scene, light: DirectionalLight) {
        this.scene = scene;
        this.light = light;
    }

    /**
     * 建立陰影產生器並掛載自動註冊邏輯
     */
    public init() {
        const cfg = RenderConfig.shadow;

        this.generator = new ShadowGenerator(cfg.mapSize, this.light);
        // 柔和陰影：blur exponential 兼顧品質與效能，邊緣不死硬
        this.generator.useBlurExponentialShadowMap = true;
        this.generator.useKernelBlur = true;
        this.generator.blurKernel = cfg.blurKernel;
        this.generator.setDarkness(cfg.darkness);
        this.generator.bias = cfg.bias;
        this.generator.normalBias = cfg.normalBias;
        // 讓方向光的陰影視錐自動貼合場景，避免手動調 frustum
        this.light.autoCalcShadowZBounds = true;

        // 先處理當下已存在的 mesh
        this.scene.meshes.forEach((mesh) => this._processMesh(mesh));

        // 後續非同步載入的 mesh 自動納入
        this.meshAddedObserver = this.scene.onNewMeshAddedObservable.add((mesh) => this._processMesh(mesh));
    }

    /**
     * 依名稱決定 mesh 是投影者或陰影接收者
     */
    private _processMesh(mesh: AbstractMesh) {
        const name = mesh.name.toLowerCase();
        const hasGeometry = mesh.getTotalVertices() > 0;

        if (RECEIVER_INCLUDE.some((key) => name.includes(key))) {
            mesh.receiveShadows = true;
        }

        if (!hasGeometry) return;
        if (CASTER_EXCLUDE.some((key) => name.includes(key))) return;

        this.generator?.addShadowCaster(mesh as Mesh, true);
    }

    public get Generator(): ShadowGenerator | undefined {
        return this.generator;
    }

    /**
     * 釋放資源
     */
    public destroy() {
        if (this.meshAddedObserver) {
            this.scene.onNewMeshAddedObservable.remove(this.meshAddedObserver);
            this.meshAddedObserver = null;
        }
        this.generator?.dispose();
        this.generator = undefined;
    }
}
