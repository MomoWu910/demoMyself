import { Scene, Mesh, Vector3, AnimationGroup, Texture, PBRMaterial, Engine, Constants } from '@babylonjs/core';
import ModelManager from '../../managers/modelsManager';
import { ModelPack, ResourcesKey } from '../../constants/assets';
import { getUniqueAnimationGroupName } from '../../constants/utils';

// 每個模型都不一樣的動畫群組名稱
const TRANSFORM_AG_NAME = {
    basic: 'basic',
    idle: 'idle',
    damage: 'damage',
    guard: 'guard',
    glad: 'glad',
    win: 'win',
    eat: 'eat',
    move: 'move',
    down: 'down',
    getup: 'getup',
    attack01: 'attack01',
    attack02: 'attack02',
    special01: 'special01',
};

interface AnimationConfig {
    isLoop?: boolean;
    speedRatio?: number;
    isAdditive?: boolean;
}

/**
 * 荷官物件
 * @param scene Babylon.js 場景
 * @param position 荷官初始位置
 */
export class Dealer_MultiMeshes {
    private scene: Scene;
    private uid: number;

    private modelManager: ModelManager;
    private modelName: string;

    private mesh: Mesh;
    private animationGroups: { [key: string]: AnimationGroup } = {};

    constructor(scene: Scene, uid: number, useModelName: string = ResourcesKey.iuno, callback: Function) {
        console.log('Dealer_MultiMeshes useModelName:', useModelName, uid);
        this.scene = scene;
        this.uid = uid;
        this.modelName = useModelName; //'dealer_multiMeshes_' + this.uid;
        this.modelManager = ModelManager.getInstance(scene);
        this.loadModel(callback);
    }

    //#region load model
    private async loadModel(callback: Function) {
        const cloneModel = await this.modelManager.prepareMultiModels(this.scene, this.modelName, 'dealer', {
            uid: this.uid.toString(),
            isAllInOne: true,
        });
        if (cloneModel && cloneModel.cloneMeshes && cloneModel.cloneMeshes.length > 0) {
            this.afterLoaded(cloneModel);
        }
        callback(this);
    }

    private afterLoaded(cloneModel: any) {
        console.log('afterLoaded cloneModel: ', this.modelName, this.uid, cloneModel);
        cloneModel.cloneMeshes && this.setMesh(cloneModel.cloneMeshes[0]);
        this.mesh.getChildMeshes().forEach((m) => {
            m.setEnabled(true);
            m.material && (m.material.backFaceCulling = false);

            // 這兩行先讓模型表演動畫時不會因爲鏡頭視錐而消失，注意效能
            m.alwaysSelectAsActiveMesh = true;
            m.isInFrustum = () => true;
        });
        cloneModel.cloneAnimationGroups && this.setAnimationGroups(cloneModel.cloneAnimationGroups);
    }

    private setMesh(cloneMesh0: Mesh) {
        this.mesh = cloneMesh0;
    }

    private setAnimationGroups(animationGroups: AnimationGroup[]) {
        if (!animationGroups) return;
        animationGroups.forEach((ag: AnimationGroup) => {
            Object.keys(TRANSFORM_AG_NAME).forEach((key) => {
                if (ag.name.includes(key))
                    this.animationGroups[TRANSFORM_AG_NAME[key as keyof typeof TRANSFORM_AG_NAME]] = ag;
            });
        });

        // 如果沒有登錄的動畫群組，代表動畫名稱不符合預期，就先登錄首個動畫檔的動畫
        if (Object.keys(this.animationGroups).length === 0) {
            this.animationGroups['basic'] = animationGroups[0];
        }

        console.log('setAnimationGroups: ', this.modelName, this.uid, this.animationGroups);
    }
    //#endregion

    //#region animation
    public playAnimation(animationName: string, config?: AnimationConfig): void {
        const { isLoop = false, speedRatio = 1.0, isAdditive = false } = config || {};
        if (this.animationGroups[animationName])
            this.animationGroups[animationName].start(
                isLoop,
                speedRatio,
                this.animationGroups[animationName].from,
                this.animationGroups[animationName].to,
                isAdditive
            );
        else {
            console.warn(this.modelName, 'playAnimation', animationName, '不存在. ');
            console.warn(this.modelName, '自動轉換為 basic 動畫. 建議確認模型檔動畫名稱 ');
            this.playAnimation('basic', { isLoop: isLoop, speedRatio: speedRatio, isAdditive: isAdditive });
        }
    }

    public playIdle(config?: AnimationConfig) {
        this.playAnimation('idle', config);
    }

    public playGlad(config?: AnimationConfig) {
        this.playAnimation('glad', config);
    }

    public playGuard(config?: AnimationConfig) {
        this.playAnimation('guard', config);
    }

    public playWin(config?: AnimationConfig) {
        this.playAnimation('win', config);
    }

    public playEat(config?: AnimationConfig) {
        this.playAnimation('eat', config);
    }

    public playMove(config?: AnimationConfig) {
        this.playAnimation('move', config);
    }

    public playAttack01(config?: AnimationConfig) {
        this.playAnimation('attack01', config);
    }

    //#endregion

    //#region getter
    /**
     * 取得荷官 Mesh
     */
    public get Mesh() {
        return this.mesh;
    }

    /**
     * 取得荷官動畫群組
     */
    public get AnimationGroups() {
        return this.animationGroups;
    }
    //#endregion
}
