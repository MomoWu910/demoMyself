import { MeshBuilder, Scene, StandardMaterial, Color3 } from '@babylonjs/core';

export class Ceiling {
    private mesh;

    /**
     * 建立天花板，預設寬度與高度 100（單位：公尺）
     */
    constructor(scene: Scene, lengthW: number, lengthH: number) {
        this.mesh = MeshBuilder.CreateGround('ceiling', { width: lengthW, height: lengthH }, scene);
        this.mesh.rotation.x = Math.PI; // 旋轉 180 度，讓面朝下
        const mat = new StandardMaterial('ceilingMat', scene);
        mat.diffuseColor = new Color3(0.36, 0.18, 0.07); // 深棕色
        mat.backFaceCulling = true; // 雙面渲染，避免看透
        this.mesh.material = mat;
    }

    /**
     * 獲取天花板 Mesh
     */
    public get Mesh() {
        return this.mesh;
    }
}
