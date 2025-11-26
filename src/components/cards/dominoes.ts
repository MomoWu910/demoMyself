import { Scene, Mesh, Vector3, AnimationGroup } from '@babylonjs/core';
import ModelManager from '../../managers/modelsManager';
import { ModelPack } from '../../constants/assets';

/**
 * 多米諾骨牌物件
 * @param scene Babylon.js 場景
 * @param position 多米諾骨牌初始位置
 */
export class Dominoes {
    private scene: Scene;
    private uid: number;

    private modelManager: ModelManager;
    private modelName: string = 'dominoes';

    private meshes: { [key: string]: Mesh | null } = {};

    constructor(scene: Scene, uid: number, callback: Function) {
        this.scene = scene;
        this.uid = uid;
        this.modelManager = ModelManager.getInstance(scene);
        this.loadModel(callback);
    }

    //#region load model
    private async loadModel(callback: Function) {
        const cloneModel = await this.modelManager.prepareMultiModels(this.scene, this.modelName, 'dominoes');

        if (cloneModel && cloneModel.cloneMeshes && cloneModel.cloneMeshes.length > 0) {
            this.afterLoaded(cloneModel);

            const rows = 4;
            const cols = 7;
            const gapX = 0.5;
            const gapZ = 0.5;
            const startX = -1.5;
            const startZ = 1.5;
            Object.keys(this.meshes).forEach((key, i) => {
                const mesh = this.meshes[key];
                if (mesh) {
                    const row = Math.floor(i / cols);
                    const col = i % cols;
                    mesh.position = new Vector3(startX + col * gapX, 4, startZ + row * gapZ);
                }
            });
        }
        callback(this);
    }

    private afterLoaded(cloneModel: any) {
        let tmpArr: { [key: string]: Mesh[] } = {};
        // 將相同上下點的 Mesh 分組
        for (let i = 0; i < cloneModel.cloneMeshes.length; i++) {
            const mesh = cloneModel.cloneMeshes[i];
            const name: string = mesh.name; // ex. zzz_root_domino_root_4_5_primitive0
            const upPoints = name.split('_')[4];
            const downPoints = name.split('_')[5];

            if (tmpArr[upPoints + '_' + downPoints] === undefined) tmpArr[upPoints + '_' + downPoints] = [];
            tmpArr[upPoints + '_' + downPoints].push(mesh);

            const scale = 0.1;
            mesh.scaling = new Vector3(scale, scale, scale);
        }

        // 合併 Mesh
        Object.keys(tmpArr).forEach((key) => {
            const bindMesh = Mesh.MergeMeshes(tmpArr[key], true, true, undefined, true, true);
            bindMesh && (bindMesh.name = 'domino_' + key);
            bindMesh && (bindMesh.id = 'domino_' + key);
            bindMesh && bindMesh.setEnabled(false);
            this.meshes[key] = bindMesh;
        });
    }
    //#endregion

    //#region animation
    public playFlip(): void {}

    //#endregion

    //#region getter
    /**
     * 取得多米諾骨牌 Meshes
     */
    public get Meshes() {
        return this.meshes;
    }

    /**
     * 取得指定點數的多米諾骨牌 Mesh
     */
    public getMeshByPoints(upPoints: number, downPoints: number): Mesh | null {
        const key = `${upPoints}_${downPoints}`;
        if (!this.meshes[key]) {
            console.warn('Dominoes getMeshByPoints not exist:', key);
            return null;
        } else return this.meshes[key];
    }

    /**
     * 取得一個牌的 Mesh 厚度
     */
    public getMeshThickness(): number {
        const mesh = this.getMeshByPoints(0, 0);
        return mesh ? mesh.getBoundingInfo().boundingBox.extendSize.y : 0;
    }

    //#endregion
}
