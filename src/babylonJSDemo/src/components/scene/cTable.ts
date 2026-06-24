import { MeshBuilder, Mesh, Scene, Vector3, Color3, PBRMaterial } from '@babylonjs/core';

const SCALE_Z = 0.75; // 縮放 Z 軸，形成橢圓

/**
 * 賭桌物件
 * 桌面為橢圓柱體，底下有三個桌腳
 */
export class CylinderTable {
    private mesh: Mesh; // 桌面主體
    private legs: Mesh[] = []; // 桌腳陣列
    private legHeight: number;
    private thickness: number;
    private radius: number;
    private tableTopPlane: Mesh; // 桌面上的四邊形平面

    /**
     * 建立賭桌
     * @param scene Babylon.js 場景
     * @param radius 半圓桌面半徑（預設 6）
     * @param thickness 桌面厚度（預設 0.5）
     * @param legHeight 桌腳高度（預設 3.5）
     * @param legRadius 桌腳半徑（預設 0.3）
     */
    constructor(
        scene: Scene,
        radius: number = 4,
        thickness: number = 0.5,
        legHeight: number = 3.5,
        legRadius: number = 0.3
    ) {
        // 桌面：橢圓柱（通過縮放實現）
        this.mesh = MeshBuilder.CreateCylinder(
            'tableTop_C',
            {
                diameter: radius * 2, // 基本圓形直徑
                height: thickness,
                tessellation: 64,
            },
            scene
        );
        this.mesh.scaling = new Vector3(1, 1, SCALE_Z); // 縮放 Z 軸，形成橢圓
        this.legHeight = legHeight;
        this.thickness = thickness;
        this.radius = radius;
        this.mesh.position.y = this.legHeight + thickness / 2;
        this.mesh.position.z = 0;
        const topMat = new PBRMaterial('tableTopMat_C', scene);
        topMat.albedoColor = new Color3(0.6, 0.4, 0.2); // 木頭色
        topMat.metallic = 0; // 非金屬
        topMat.roughness = 0.6; // 全霧面，不反射
        topMat.backFaceCulling = false; // 雙面渲染，避免看透
        this.mesh.material = topMat;

        // 調整桌腳位置（根據橢圓比例，分佈在四個象限）
        const legPosRadiusX = radius * 0.7; // 長軸方向的桌腳位置
        const legPosRadiusZ = radius * 0.7 * 0.7; // 短軸方向的桌腳位置
        const legPositions = [
            new Vector3(-legPosRadiusX, -this.legHeight / 2, -legPosRadiusZ), // 左前
            new Vector3(legPosRadiusX, -this.legHeight / 2, -legPosRadiusZ), // 右前
            new Vector3(-legPosRadiusX, -this.legHeight / 2, legPosRadiusZ), // 左後
            new Vector3(legPosRadiusX, -this.legHeight / 2, legPosRadiusZ), // 右後
        ];
        for (let i = 0; i < 4; i++) {
            const leg = MeshBuilder.CreateCylinder(
                `tableLeg${i + 1}_C`,
                {
                    diameter: legRadius * 2,
                    height: this.legHeight,
                },
                scene
            );
            leg.position = legPositions[i];
            const legMat = new PBRMaterial(`tableLegMat${i + 1}_C`, scene);
            legMat.albedoColor = new Color3(0.3, 0.2, 0.1); // 深木色
            legMat.metallic = 0; // 非金屬
            legMat.roughness = 0.6; // 全霧面，不反射
            leg.material = legMat;
            this.legs.push(leg);
        }
        // 將桌腳設為桌面的子物件
        this.legs.forEach((leg) => (leg.parent = this.mesh));

        // 創建桌面上的橢圓形平面
        this.tableTopPlane = MeshBuilder.CreateDisc('tableTopPlane', { radius: radius, tessellation: 64 }, scene);
        this.tableTopPlane.scaling = new Vector3(1, 1, SCALE_Z); // 調整為橢圓形
        this.tableTopPlane.position = new Vector3(0, this.thickness / 2 - 0.01, 0); // 放置於桌面上方
        this.tableTopPlane.rotation.x = -Math.PI / 2; // 調整平面方向
        this.tableTopPlane.material = topMat;
        this.tableTopPlane.material.zOffset = 1;
        this.tableTopPlane.parent = this.mesh;
    }

    public setEnabled(enabled: boolean) {
        this.mesh.setEnabled(enabled);
        this.legs.forEach((leg) => leg.setEnabled(enabled));
        this.tableTopPlane.setEnabled(enabled);
    }

    public get Mesh() {
        return this.mesh;
    }

    public get TopPlane() {
        return this.tableTopPlane;
    }

    public get LegHeight() {
        return this.legHeight;
    }

    public get TableTopPos() {
        return new Vector3(0, this.legHeight + this.thickness, 0);
    }
}
