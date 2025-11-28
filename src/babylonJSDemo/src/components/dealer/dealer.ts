import { Scene, Mesh, Vector3, AnimationGroup } from '@babylonjs/core';
import ModelManager from '../../managers/modelsManager';
import { ModelPack } from '../../constants/assets';

// 每個模型都不一樣的動畫群組名稱
const TRANSFORM_AG_NAME = {
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
export class Dealer {
    private scene: Scene;
    private uid: number;

    private modelManager: ModelManager;
    private modelType: string = 'dealer';
    private modelName: string = 'angelwomon';

    private mesh: Mesh;
    private animationGroups: { [key: string]: AnimationGroup } = {};

    constructor(scene: Scene, uid: number, callback: Function) {
        this.scene = scene;
        this.uid = uid;
        this.modelManager = ModelManager.getInstance(scene);
        this.loadModel(callback);
    }

    //#region load model
    private async loadModel(callback: Function) {
        const cloneModel = await this.modelManager.prepareModel(this.scene, this.modelName, this.modelType, {
            uid: this.uid.toString(),
            isNeedCloneAnimation: true,
        });
        if (cloneModel && cloneModel.cloneMesh0) {
            this.afterLoaded(cloneModel);
        }
        callback(this);
    }

    private afterLoaded(cloneModel: any) {
        console.log('afterLoaded cloneModel: ', this.modelName, this.uid, cloneModel);
        cloneModel.cloneMesh0 && this.setMesh(cloneModel.cloneMesh0);
        this.mesh.setEnabled(true);
        cloneModel.cloneAnimationGroups && this.setAnimationGroups(cloneModel.cloneAnimationGroups);
        // this.playIdle({ isLoop: true, isAdditive: true });
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

        console.log('setAnimationGroups: ', this.modelName, this.uid, this.animationGroups);
    }
    //#endregion

    //#region animation
    public playAnimation(animationName: string, config?: AnimationConfig): void {
        const { isLoop = false, speedRatio = 1.0, isAdditive = false } = config || {};
        // const newAnimationName = this.modelType+
        if (this.animationGroups[animationName])
            this.animationGroups[animationName].start(
                isLoop,
                speedRatio,
                this.animationGroups[animationName].from,
                this.animationGroups[animationName].to,
                isAdditive
            );
        else console.error('playAnimation', animationName, 'is not exist', this.animationGroups);
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
