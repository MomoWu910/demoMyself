import { MeshBuilder, Mesh, Scene, Vector3, Color3, StandardMaterial } from '@babylonjs/core';
import { IControllable } from '../../constants/interfaces';

const MOVE_SPEED = 0.2; // 移動速度

/**
 * 玩家物件（簡單直立橢圓形表示）
 */
export class SelfPlayer implements IControllable {
    public name: string = 'selfPlayer';
    private mesh: Mesh;
    private height: number;

    /**
     * 建立玩家物件
     * @param scene Babylon.js 場景
     * @param height 橢圓高度
     * @param radius 橢圓寬度
     */
    constructor(scene: Scene, height: number = 5, radius: number = 0.5) {
        this.height = height;
        // 直立橢圓形（橢圓柱）
        this.mesh = MeshBuilder.CreateSphere(
            this.name,
            {
                diameterX: radius * 2,
                diameterY: height,
                diameterZ: radius * 2,
                segments: 32,
            },
            scene
        );
        this.mesh.position.y = height / 2;
        const mat = new StandardMaterial('selfPlayerMat', scene);
        mat.diffuseColor = new Color3(0.2, 0.6, 0.9); // 藍色
        mat.backFaceCulling = true;
        this.mesh.material = mat;
        this.mesh.visibility = 0;
    }

    //#region getter
    /**
     * 取得 Mesh
     */
    public get Mesh() {
        return this.mesh;
    }

    /**
     * 取得高度
     */
    public get Height() {
        return this.height;
    }

    //#endregion

}
