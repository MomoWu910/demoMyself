import { Scene, AssetsManager, AbstractMesh, Skeleton, AnimationGroup, Mesh, Tags } from '@babylonjs/core';
import { waitUntil } from '../constants/utils';

// 使用者可傳入：
// 1. key: '...path.xxx'
// 2. key: { url: '...path.xxx', config?: ModelPreloadConfig, type?: 'model' | 'image' }
export interface AssetObjectDescriptor {
    url: string;
    config?: ModelPreloadConfig; // 僅模型需要
    type?: 'model' | 'image'; // 可選，若未指定依副檔名判斷
}

type AssetMapValue = string | AssetObjectDescriptor;

interface AssetItem {
    [key: string]: AssetMapValue;
}

// 單一模型資源（glb/gltf）
export interface LoadedModelAsset {
    meshes: AbstractMesh[];
    skeletons: Skeleton[];
    animationGroups: AnimationGroup[];
}

// 可載入的資源（圖片/貼圖/模型 ...）
interface LoadedAssets {
    [key: string]: any | LoadedModelAsset;
}

/**
 * 模型載入附加處理設定，對應原 ModelsManager 的選項
 *  @param isMultiMesh: 是否多網格模型（glb 內有多個 mesh）
 *  @param isNeedRename: 是否需要重新命名 mesh 為 {modelName}_rootMesh_{index}，通常在模型內部沒有有效命名時使用
 *  @param isAllInOne: 此模型是否為一個多部件(比如人體)組合成一個整體的模型，載入後會建立一個父物件包覆所有 mesh
 */
export interface ModelPreloadConfig {
    isMultiMesh?: boolean;
    isNeedRename?: boolean;
    isAllInOne?: boolean;
}

class AssetManager {
    public static instance: AssetManager | null = null;
    public static getInstance() {
        if (this.instance === null) {
            this.instance = new AssetManager();
        }
        return this.instance;
    }

    private resources: LoadedAssets = {};
    private preloadPromise: Promise<LoadedAssets> | null = null;

    /**
     * @param {Scene} scene - 當前場景
     * @param {LoadedAssets} res - 你的資源清單
     */
    public async preloadAssets(
        scene: Scene,
        res: AssetItem,
        modelConfigs?: Record<string, ModelPreloadConfig> // 保留舊參數做回溯相容
    ): Promise<LoadedAssets> {
        if (this.preloadPromise) return this.preloadPromise; // 避免重複觸發

        this.preloadPromise = new Promise<LoadedAssets>((resolve) => {
            const assetsManager = new AssetsManager(scene);
            const loaded: LoadedAssets = {};

            for (const [key, value] of Object.entries(res)) {
                let path: string;
                let inlineConfig: ModelPreloadConfig | undefined;
                let explicitType: 'model' | 'image' | undefined;

                if (typeof value === 'string') {
                    path = value;
                } else if (value && typeof value === 'object' && 'url' in value) {
                    path = value.url;
                    inlineConfig = value.config;
                    explicitType = value.type;
                } else {
                    console.warn(`⚠️ 無效資源格式: ${key}`, value);
                    continue;
                }

                const lower = path.toLowerCase();
                const isModel = explicitType === 'model' || (/\.(glb|gltf)$/i.test(lower) && explicitType !== 'image');
                const isImage =
                    explicitType === 'image' || (/\.(png|jpg|jpeg|webp)$/i.test(lower) && explicitType !== 'model');

                if (isImage) {
                    const texTask = assetsManager.addTextureTask(key, path);
                    texTask.onSuccess = (t) => (loaded[key] = t.texture);
                    texTask.onError = (_, msg, ex) => console.error(`❌ Texture load failed: ${key}`, msg, ex);
                } else if (isModel) {
                    const meshTask = assetsManager.addMeshTask(key, '', '', path);
                    meshTask.onSuccess = (t) => {
                        const asset: LoadedModelAsset = {
                            meshes: t.loadedMeshes,
                            skeletons: t.loadedSkeletons,
                            animationGroups: t.loadedAnimationGroups,
                        };
                        const cfg = inlineConfig || modelConfigs?.[key];
                        this.finalizeModel(key, asset, cfg, scene);
                        loaded[key] = asset;
                    };
                    meshTask.onError = (_, msg, ex) => console.error(`❌ Model load failed: ${key}`, msg, ex);
                } else {
                    console.warn(`⚠️ 未識別資源類型: ${key} (${path})`);
                }
            }

            assetsManager.onProgress = (remaining, total) => {
                const progress = ((total - remaining) / total) * 100;
                // console.log(`Loading... ${progress.toFixed(1)}%`);
            };

            assetsManager.onFinish = () => {
                console.log('✅ 所有資源載入完成');
                this.resources = loaded; // 實際儲存
                resolve(this.resources);
                this.preloadPromise = null; // 清除鎖
            };

            assetsManager.onTaskErrorObservable.add((task) => {
                console.error('❌ 載入任務失敗:', task.name);
            });

            assetsManager.load();
        });

        return this.preloadPromise;
    }

    public backgroundPreloadAssets(scene: Scene, res: AssetItem, modelConfigs?: Record<string, ModelPreloadConfig>) {
        this.preloadAssets(scene, res, modelConfigs).then(() => {
            console.log('Background assets preloading completed.');
        });
    }

    public getResource<T = any>(key: string): T | undefined {
        return this.resources[key] as T | undefined;
    }

    public getResourceAsync<T = any>(key: string): Promise<T | undefined> {
        return new Promise((resolve) => {
            if (this.resources[key]) {
                resolve(this.resources[key] as T);
            } else {
                waitUntil(() => this.resources[key] !== undefined).then(() => {
                    resolve(this.resources[key] as T);
                });
            }
        });
    }

    public getResources(): LoadedAssets {
        return this.resources;
    }

    public hasResource(key: string): boolean {
        return typeof this.resources[key] !== 'undefined';
    }

    public hasResourceAsync(key: string): Promise<boolean> {
        return new Promise((resolve) => {
            if (this.resources[key]) {
                resolve(true);
            } else {
                waitUntil(() => this.resources[key] !== undefined).then(() => {
                    resolve(true);
                });
            }
        });
    }

    /**
     * 對模型資源進行與舊 ModelsManager.preloadModel 類似的標記 / 命名 / 關閉處理
     */
    // 將模型 mesh / skeleton / animationGroups 做命名與隱藏等後處理
    public finalizeModel(key: string, asset: LoadedModelAsset, cfg: ModelPreloadConfig | undefined, scene: Scene) {
        if (!asset.meshes || asset.meshes.length === 0) return;
        const isMultiMesh = cfg?.isMultiMesh ?? false;
        const isNeedRename = cfg?.isNeedRename ?? false;
        const isAllInOne = cfg?.isAllInOne ?? false;

        // 若已處理過（檢查第一個 mesh 名稱前綴）則略過
        if (asset.meshes.some((m) => m.name.startsWith('zzz_root_'))) return;

        const parentMesh = isAllInOne ? new Mesh('zzz_root_' + key, scene) : null;
        isAllInOne && parentMesh && Tags.AddTagsTo(parentMesh, key + '_parentMesh');

        asset.meshes.forEach((mesh: AbstractMesh, i: number) => {
            if (mesh.subMeshes && mesh.subMeshes.length > 0 && (mesh as Mesh).material) {
                mesh.parent = null;
                mesh.metadata = mesh.metadata || {};
                mesh.metadata.subName = mesh.id; // 保留模型區塊原始 id，比如說頭髮、手、衣服等
                // zzz_root_ 讓這類root mesh 在 Inspector 中靠後排序
                mesh.id = 'zzz_root_' + (isNeedRename ? (isMultiMesh ? key + '_' + i : key) : mesh.id);
                mesh.name = 'zzz_root_' + (isNeedRename ? (isMultiMesh ? key + '_' + i : key) : mesh.name);
                isMultiMesh && Tags.AddTagsTo(mesh, key + '_rootMesh');
                if (isAllInOne && parentMesh) {
                    mesh.parent = parentMesh;
                    parentMesh.isEnabled(false);
                }
                mesh.setEnabled(false);
            } else {
                // 沒有 subMeshes 或 material 的 mesh 通常是輔助用的空物件，通常id為 __root__ ，標記為 dispose 後續刪除
                Tags.AddTagsTo(mesh, 'dispose');
                mesh.name = key + '_dispose';
            }
        });

        const disposeMeshes = scene.getMeshesByTags('dispose');
        for (const dm of disposeMeshes) dm.dispose();

        const skeletons = asset.skeletons[0];
        skeletons && (skeletons.name = 'zzz_root_skeletons_' + key);

        asset.animationGroups?.forEach((ag) => {
            ag.metadata = ag.metadata || {};
            ag.metadata.originName = ag.name;
            ag.name = 'zzz_root_ag_' + key + '_' + ag.name;
            // 預設關閉動畫，播放時再啟動
            ag.stop();
        });
    }
}

const assetManager = AssetManager.getInstance();
export { assetManager as AssetManager };
