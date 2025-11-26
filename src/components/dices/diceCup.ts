import { MeshBuilder, StandardMaterial, Color3, Scene, Vector3, Mesh } from '@babylonjs/core';

export class DiceCup {
    private scene: Scene;
    private cup: Mesh;

    constructor(scene: Scene, callback: Function) {
        this.scene = scene;
        this.cup = new Mesh('diceCup', this.scene);
        this.createDiceCup();
        callback && callback(this);
    }

    private createDiceCup() {
        // 創建四個平面作為骰盅的四個側面
        const height = 10;
        const width = 1;
        const material = new StandardMaterial('diceCupMaterial', this.scene);
        material.diffuseColor = new Color3(0.5, 0.5, 0.5); // 灰色
        material.alpha = 0;
        material.backFaceCulling = false; // 雙面可見

        // 前面
        const front: Mesh = MeshBuilder.CreatePlane('diceCup_frontPlane', { width, height,  }, this.scene);
        front.position = new Vector3(0, height / 2, -width / 2);
        front.isPickable = false;
        front.material = material;
        front.parent = this.cup;

        // 後面
        const back: Mesh = MeshBuilder.CreatePlane('diceCup_backPlane', { width, height }, this.scene);
        back.position = new Vector3(0, height / 2, width / 2);
        back.rotation = new Vector3(0, Math.PI, 0);
        back.isPickable = false;
        back.material = material;
        back.parent = this.cup;

        // 左側
        const left: Mesh = MeshBuilder.CreatePlane('diceCup_leftPlane', { width, height }, this.scene);
        left.position = new Vector3(-width / 2, height / 2, 0);
        left.rotation = new Vector3(0, -Math.PI / 2, 0);
        left.isPickable = false;
        left.material = material;
        left.parent = this.cup;

        // 右側
        const right: Mesh = MeshBuilder.CreatePlane('diceCup_rightPlane', { width, height }, this.scene);
        right.position = new Vector3(width / 2, height / 2, 0);
        right.rotation = new Vector3(0, Math.PI / 2, 0);
        right.isPickable = false;
        right.material = material;
        right.parent = this.cup;

    }

    public get Mesh() {
        return this.cup;
    }

    public get Meshes(): Mesh[] {
        return this.cup.getChildMeshes();
    }
}
