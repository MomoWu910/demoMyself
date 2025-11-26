import { Scene, Mesh, AnimationGroup, Skeleton, Tags, TransformNode, AbstractMesh } from '@babylonjs/core';
import { AssetManager, LoadedModelAsset } from './assetManager';
import { getUniqueAnimationGroupName } from '../constants/utils';

// 舊的 preload 選項已移到 AssetManager，這裡僅保留介面以避免其他模組引用錯誤
interface PreloadOptions {
    isMultiMesh?: boolean; // 已無作用（由 AssetManager 處理）
    isNeedRename?: boolean; // 已無作用
    isAllInOne?: boolean; // 已無作用
}

interface PrepareOptions {
    isNeedRename?: boolean;
    isAllInOne?: boolean;
    uid?: number | string;
    isNeedCloneAnimation?: boolean;
}

/**
 * 模型管理類別
 * @description 只使用預先由 AssetManager 載入的 glb 模型，並可深拷貝模型避免動畫共用問題
 */
class ModelsManager {
    private static instance: ModelsManager;
    private scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * 深拷貝模型，避免動畫共用問題
     * @param scene 場景
     * @param modelName 模型名稱
     * @param type 類型
     * @param uid 唯一識別
     */
    public async prepareModel(scene: Scene, modelName: string, type: string, config?: PrepareOptions) {
        await AssetManager.hasResourceAsync(modelName);
        const root = scene.getMeshById('zzz_root_' + modelName);
        const uid = config?.uid || '0';

        if (!root) {
            console.error(`Mesh ${modelName}_rootMesh not found in scene.`);
            return null;
        }
        const cloneRoot = root.instantiateHierarchy(null, { doNotInstantiate: true }, (source, clone) => {
            clone.name = source.name;
        });

        if (!cloneRoot) {
            console.error('Failed to clone mesh hierarchy.');
            return null;
        }
        cloneRoot.name = modelName + '_cloneMesh_uid' + uid;
        cloneRoot.setEnabled(true);

        const model = AssetManager.getResource(modelName) as LoadedModelAsset;
        if (!model || !model.skeletons || model.skeletons.length === 0) {
            return { cloneMesh0: cloneRoot };
        }

        // 深拷貝骨架
        const masterSkel = model.skeletons[0] as Skeleton;
        const cloneSkeleton = masterSkel.clone(type + '_' + modelName + '_skeleton_uid' + uid);
        (cloneRoot as Mesh).skeleton = cloneSkeleton;
        (cloneRoot as Mesh).computeBonesUsingShaders = true; // 確保使用骨骼著色器
        (cloneRoot as Mesh).numBoneInfluencers = (cloneRoot as Mesh).numBoneInfluencers || 4; // 保險
        (cloneRoot as Mesh).getChildMeshes(false).forEach((m) => {
            const mesh = m as Mesh;
            mesh.skeleton = cloneSkeleton; // 關鍵：真正把皮膚綁到骨架
            mesh.computeBonesUsingShaders = true;
            mesh.numBoneInfluencers = mesh.numBoneInfluencers || 4; // 保險
        });
        cloneSkeleton.needInitialSkinMatrix = true;
        cloneSkeleton.prepare(); // 確保骨架的初始矩陣已準備好
        (cloneSkeleton as any).overrideMesh = cloneRoot as AbstractMesh;

        // map 所有後代並指定 skeleton
        const map: Record<string, any> = {};

        for (const bone of cloneSkeleton.bones) {
            const tf = bone.getTransformNode();
            if (tf) {
                // 重新命名骨架與 TransformNode，避免重複
                const oldBoneName = bone.name;
                bone.name = type + '_' + modelName + '_bone_uid' + uid + '_' + oldBoneName;
                const oldTfName = tf.name;
                const newTfName = type + '_' + modelName + '_boneTf_uid' + uid + '_' + oldTfName;

                const parentBone = bone.getParent();
                const newTf = tf.clone(newTfName, parentBone ? parentBone.getTransformNode() : null);

                map[oldBoneName] = newTf;
                bone.linkTransformNode(map[oldBoneName]);
            }
        }

        // 深拷貝動畫
        const cloneAnimationGroups: AnimationGroup[] = [];
        if (model.animationGroups) {
            const masterAnimations = [...model.animationGroups];
            masterAnimations.forEach((ag: AnimationGroup) => {
                const clone = ag.clone(ag.name, (oldTarget) => {
                    const newTarget = map[oldTarget.name];
                    if (newTarget) {
                        return newTarget;
                    }
                    if (oldTarget instanceof TransformNode && oldTarget.parent) {
                        const parentName = oldTarget.parent.name;
                        return map[parentName] || oldTarget;
                    }
                    return oldTarget;
                });

                clone.name = getUniqueAnimationGroupName(type, uid, modelName, clone.metadata.originName);
                cloneAnimationGroups.push(clone);
            }, true);
        }

        return { cloneMesh0: cloneRoot, cloneSkeleton, cloneAnimationGroups };
    }

    public async prepareMultiModels(scene: Scene, modelName: string, type: string, config?: PrepareOptions) {
        await AssetManager.hasResourceAsync(modelName);
        const isAllInOne = config?.isAllInOne || false;
        const roots = isAllInOne
            ? scene.getMeshesByTags(modelName + '_parentMesh')
            : scene.getMeshesByTags(modelName + '_rootMesh');
        const isNeedRename = config?.isNeedRename || false;
        const uid = config?.uid || '0';

        if (!roots || roots.length === 0) {
            console.error(`Meshes ${modelName}_rootMesh not found in scene.`);
            return null;
        }

        const cloneRoots = roots.map((rootMesh) => {
            return (
                rootMesh.name.includes('zzz_root') &&
                rootMesh.instantiateHierarchy(null, { doNotInstantiate: true }, (source, clone) => {
                    clone.name = isNeedRename
                        ? modelName + '_cloneMesh_uid' + uid
                        : isAllInOne
                        ? clone.metadata && clone.metadata.subName
                            ? modelName + '_' + clone.metadata.subName + '_cloneMesh_uid' + uid
                            : modelName + '_cloneMesh_uid' + uid
                        : clone.name.replace('_rootMesh', '_cloneMesh');
                    clone.setEnabled(false);
                })
            );
        });
        if (!cloneRoots) {
            console.error('Failed to clone mesh hierarchy.');
            return null;
        }

        const model = AssetManager.getResource(modelName) as LoadedModelAsset;

        if (!model || !model.skeletons || model.skeletons.length === 0) {
            return { cloneMeshes: cloneRoots };
        }

        // 深拷貝骨架
        const masterSkel = model.skeletons[0] as Skeleton;
        const cloneSkeleton = masterSkel.clone(type + '_' + modelName + '_skeleton_uid' + uid);

        // 深拷貝動畫
        const cloneAnimationGroups: AnimationGroup[] = [];
        const map: Record<string, any> = {};

        for (const bone of cloneSkeleton.bones) {
            const tf = bone.getTransformNode();
            if (tf) {
                // 重新命名骨架與 TransformNode，避免重複
                const oldBoneName = bone.name;
                bone.name = type + '_' + modelName + '_bone_uid' + uid + '_' + oldBoneName;
                const oldTfName = tf.name;
                const newTfName = type + '_' + modelName + '_boneTf_uid' + uid + '_' + oldTfName;

                const parentBone = bone.getParent();
                const rootTf = (cloneRoots[0] as Mesh) !== null ? (cloneRoots[0] as Mesh).getChildren()[0] : null;
                const newTf = tf.clone(newTfName, parentBone ? parentBone.getTransformNode() : rootTf);

                map[oldBoneName] = newTf;
                bone.linkTransformNode(newTf);
            }
        }

        for (const cloneRoot of cloneRoots) {
            if (!cloneRoot) continue;
            // map 所有後代並指定 skeleton
            const descendants = cloneRoot.getDescendants(false);
            for (let i = 0; i < descendants.length; i++) {
                (descendants[i] as Mesh).skeleton = cloneSkeleton;
            }

            if (model.animationGroups) {
                const masterAnimations = [...model.animationGroups];
                masterAnimations.forEach((ag: AnimationGroup) => {
                    const clone = ag.clone(ag.name, (oldTarget) => {
                        const newTarget = map[oldTarget.name];
                        return newTarget || oldTarget;
                    });
                    clone.name = getUniqueAnimationGroupName(type, uid, modelName, clone.metadata.originName);
                    cloneAnimationGroups.push(clone);
                });
            }
        }

        return { cloneMeshes: cloneRoots, cloneSkeleton, cloneAnimationGroups };
    }

    /**
     * 取得已載入的模型
     * @param modelName 模型名稱
     */
    public getModel(modelName: string) {
        const model = AssetManager.getResource(modelName) as LoadedModelAsset;

        if (!model) {
            console.error(`Model ${modelName} has not been preloaded.`);
            return null;
        }
        return model;
    }

    /**
     * 取得 ModelManager 單例
     * @param scene 場景
     */
    public static getInstance(scene: Scene): ModelsManager {
        if (!ModelsManager.instance) ModelsManager.instance = new ModelsManager(scene);
        return ModelsManager.instance;
    }

    /**
     * 移除指定root mesh
     */
    public removeModelByRootName(rootName: string) {
        const roots = this.scene.getMeshesByTags(rootName + '_rootMesh');
        if (roots && roots.length > 0) {
            roots.forEach((mesh) => {
                mesh.dispose();
            });
            console.log(`Model with root name ${rootName} has been removed from the scene.`);
        } else {
            console.warn(`No meshes found with root name ${rootName}.`);
        }
    }
}

export default ModelsManager;
