import { MeshBuilder, Scene, PBRMaterial, Texture, Color3, Mesh, Vector2 } from '@babylonjs/core';
import { ImagePack } from '../../constants/assets';

export class Floor {
    private mesh: Mesh;

    /**
     * 建立地板，預設寬度與高度 100（單位：公尺）
     */
    constructor(scene: Scene, lengthW: number, lengthH: number) {
        this.mesh = MeshBuilder.CreateGround('floor', { width: lengthW, height: lengthH }, scene);
        const mat = new PBRMaterial('floorMat', scene);
        this.mesh.material = mat;

        mat.albedoColor = new Color3(0.8, 0.0015, 0.0015); // 深紅色
        mat.albedoTexture = new Texture(ImagePack.carpet_fleurdelis, scene);

        if (mat.albedoTexture instanceof Texture) {
            mat.albedoTexture.uScale = 4;
            mat.albedoTexture.vScale = 4;
        }

        const bump = new Texture(ImagePack.carpet_normal_height, scene);

        bump.uScale = 8;
        bump.vScale = 8;
        bump.level = 1.5;
        mat.bumpTexture = bump;

        mat.metallic = 0; // set to 1 to only use it from the metallicTexture
        mat.roughness = 1; // set to 1 to only use it from the metallicTexture
    }

    /**
     * 獲取地板 Mesh
     */
    public get Mesh() {
        return this.mesh;
    }
}
