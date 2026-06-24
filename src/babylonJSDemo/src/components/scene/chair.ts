import { MeshBuilder, Mesh, Scene, Vector3, Color3, PBRMaterial } from '@babylonjs/core';

/**
 * 椅子物件
 * 坐墊為寬扁圓柱，底下有一個窄細圓柱支架
 */
export class Chair {
    public seat: Mesh; // 坐墊
    public leg: Mesh; // 支架
    private legHeight: number;

    /**
     * 建立椅子
     * @param scene Babylon.js 場景
     * @param seatRadius 坐墊半徑（預設 1）
     * @param seatThickness 坐墊厚度（預設 0.3）
     * @param legHeight 支架高度（預設 1.2）
     * @param legRadius 支架半徑（預設 0.15）
     */
    constructor(scene: Scene, seatRadius: number = 1, seatThickness: number = 0.3, legHeight: number = 2, legRadius: number = 0.15) {
        // 坐墊：寬扁圓柱
        this.seat = MeshBuilder.CreateCylinder(
            'chairSeat',
            {
                diameter: seatRadius * 2,
                height: seatThickness,
                tessellation: 32,
            },
            scene
        );
        this.legHeight = legHeight;
        this.seat.position.y = legHeight + seatThickness / 2;
        const seatMat = new PBRMaterial('chairSeatMat', scene);
        seatMat.albedoColor = new Color3(0.8, 0.7, 0.5); // 淺色坐墊
        seatMat.metallic = 0; // 非金屬
        seatMat.roughness = 0.6; // 全霧面，不反射
        seatMat.backFaceCulling = false;
        this.seat.material = seatMat;

        // 支架：窄細圓柱
        this.leg = MeshBuilder.CreateCylinder(
            'chairLeg',
            {
                diameter: legRadius * 2,
                height: this.legHeight,
                tessellation: 16,
            },
            scene
        );
        this.leg.position = new Vector3(0, -this.legHeight / 2, 0);
        const legMat = new PBRMaterial('chairLegMat', scene);
        legMat.albedoColor = new Color3(0.5, 0.4, 0.3); // 深色支架
        legMat.metallic = 0; // 非金屬
        legMat.roughness = 0.6; // 全霧面，不反射
        legMat.backFaceCulling = false;
        this.leg.material = legMat;

        // 支架設為坐墊的子物件
        this.leg.parent = this.seat;
    }

    public get Mesh() {
        return this.seat;
    }

    public get LegHeight() {
        return this.legHeight;
    }
}
