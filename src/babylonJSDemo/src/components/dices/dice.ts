import {
    MeshBuilder,
    Mesh,
    StandardMaterial,
    Color3,
    Scene,
    Vector3,
    MultiMaterial,
    SubMesh,
    Texture,
} from '@babylonjs/core';
import ModelManager from '../../managers/modelsManager';
import { ModelPack } from '../../constants/assets';

/**
 * 六面骰子物件
 * @description 建立一個典型的六面骰子，每面有對應點數，並可計算目前朝上的點數
 */
export class Dice {
    private scene: Scene;
    private uid: number;

    private modelManager: ModelManager;
    private modelName: string = 'dice';

    private mesh: Mesh;
    private scaleSize: number;
    private faceMaterials: StandardMaterial[] = []; // 六面材質
    private multiMaterial: MultiMaterial; // MultiMaterial 物件
    private faceValues: number[] = [1, 2, 3, 4, 5, 6]; // 六面點數

    /**
     * 建構子：建立骰子物件
     * @param scene Babylon.js 場景
     * @param size 骰子邊長，預設 1
     */
    constructor(scene: Scene, uid: number, size: number = 1, callback: Function) {
        this.scene = scene;
        this.uid = uid;
        this.scaleSize = size;
        this.modelManager = ModelManager.getInstance(scene);
        this.loadModel(callback);
    }

    //#region load model
    private async loadModel(callback: Function) {
        const cloneModel = await this.modelManager.prepareModel(this.scene, this.modelName, 'dice', {
            uid: this.uid.toString(),
        });
        if (cloneModel && cloneModel.cloneMesh0) {
            this.afterLoaded(cloneModel);
            this.mesh.parent = null;
            this.mesh.rotation = new Vector3(0, 0, 0);
            this.mesh.scaling = new Vector3(this.scaleSize, this.scaleSize, this.scaleSize);
            this.mesh.computeWorldMatrix(true);
        }
        callback(this);
    }

    private afterLoaded(cloneModel: any) {
        cloneModel.cloneMesh0 && this.setMesh(cloneModel.cloneMesh0);
    }

    private setMesh(cloneMesh0: Mesh) {
        this.mesh = cloneMesh0;
    }
    //#endregion

    /**
     * 建立六面材質，並用顏色與點數區分
     */
    private _createFaceMaterials(scene: Scene) {
        const colors = [
            Color3.White(), // 1
            Color3.Red(), // 2
            Color3.Green(), // 3
            Color3.Blue(), // 4
            Color3.Yellow(), // 5
            Color3.Purple(), // 6
        ];
        for (let i = 0; i < 6; i++) {
            const mat = new StandardMaterial(`diceMat${i + 1}`, scene);
            mat.diffuseColor = colors[i];
            mat.emissiveColor = colors[i];
            this.faceMaterials.push(mat);
        }
    }

    /**
     * 將六面材質套用到骰子
     */
    /**
     * 套用 MultiMaterial 讓骰子六面顏色分別顯示
     */
    private _applyMultiMaterial(scene: Scene) {
        // Babylon.js MultiMaterial
        this.multiMaterial = new MultiMaterial('diceMultiMat', scene);
        for (let i = 0; i < 6; i++) {
            this.multiMaterial.subMaterials.push(this.faceMaterials[i]);
        }
        this.mesh.material = this.multiMaterial;
        // 建立六個 subMesh 對應六面
        this.mesh.subMeshes = [];
        const verticesCount = this.mesh.getTotalVertices();
        const indices = this.mesh.getIndices();
        // 每面 2 triangles, 6 faces
        for (let i = 0; i < 6; i++) {
            this.mesh.subMeshes.push(
                new SubMesh(
                    i, // materialIndex
                    0,
                    verticesCount,
                    i * 6,
                    6,
                    this.mesh
                )
            );
        }
    }

    /**
     * 計算目前朝上的面點數
     * @returns number - 1~6
     */
    public getTopFaceValue(): number {
        // 取得骰子世界座標的 up vector
        const up = Vector3.Up();
        const worldMatrix = this.mesh.getWorldMatrix();
        const upWorld = Vector3.TransformNormal(up, worldMatrix);
        // Babylon.js Box 六面法線: +Y (上), -Y (下), +Z, -Z, +X, -X
        // 判斷哪個面最接近世界 up
        const faceNormals = [
            new Vector3(0, 1, 0), // +Y
            new Vector3(1, 0, 0), // +X
            new Vector3(0, 0, -1), // -Z
            new Vector3(0, 0, 1), // +Z
            new Vector3(-1, 0, 0), // -X
            new Vector3(0, -1, 0), // -Y
        ];
        let maxDot = -Infinity;
        let topFace = 0;
        for (let i = 0; i < 6; i++) {
            const normalWorld = Vector3.TransformNormal(faceNormals[i], worldMatrix);
            const dot = Vector3.Dot(normalWorld, up);
            if (dot > maxDot) {
                maxDot = dot;
                topFace = i;
            }
        }
        return this.faceValues[topFace];
    }

    //#region getter
    /**
     * 取得骰子 Mesh
     */
    public get Mesh() {
        return this.mesh;
    }

    /**
     * 取得骰子uid
     */
    public get Uid() {
        return this.uid;
    }
    //#endregion
}
