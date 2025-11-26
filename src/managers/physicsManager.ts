import { Scene, Mesh, Vector3, Quaternion } from '@babylonjs/core';
import { PhysicsShapeBox, PhysicsShapeMesh, PhysicsMotionType, PhysicsBody } from '@babylonjs/core/Physics/v2';
import { HavokPlugin } from '@babylonjs/core/Physics/v2';
import HavokPhysics from '@babylonjs/havok';

/**
 * 物理系統管理器
 * @description 初始化 Babylon.js Havok 物理引擎，並提供物件加入物理的方法
 */
export class PhysicsManager {
    private scene: Scene;
    private havokPlugin: HavokPlugin;

    /**
     * 初始化物理系統
     * @param scene Babylon.js 場景
     */
    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * 啟用物理引擎（Havok）
     */
    public async enablePhysics() {
        const havokInstance = await HavokPhysics();
        this.havokPlugin = new HavokPlugin(true, havokInstance);
        this.scene.enablePhysics(new Vector3(0, -9.81, 0), this.havokPlugin);
        console.log('物理引擎已啟用');
    }

    /**
     * 將 mesh 加入剛體 (v2)
     * @param mesh 目標 Mesh
     * @param motionType 物件動態型態（PhysicsMotionType.DYNAMIC/STATIC/KINEMATIC）
     * @param startsAsleep 物件初始靜止狀態
     * @param mass 物件質量
     */
    public addPhysics(mesh: Mesh, motionType: PhysicsMotionType, startsAsleep: boolean, mass: number = 0, isCountBoundingBox: boolean = false) {
        mesh.parent = null;
        mesh.computeWorldMatrix(true);

        mesh.physicsBody = new PhysicsBody(mesh, motionType, startsAsleep, this.scene);
        if (isCountBoundingBox) {
            // todo: 後續擴充不同形狀的寫法 switch

            // 用世界空間 extents 建立 PhysicsShapeBox
            const bounds = mesh.getBoundingInfo();
            const centerLocal = bounds.boundingBox.center;
            const bbox = bounds.boundingBox;
            const min = Vector3.TransformCoordinates(bbox.minimum, mesh.getWorldMatrix());
            const max = Vector3.TransformCoordinates(bbox.maximum, mesh.getWorldMatrix());
            const extents = max.subtract(min);
            const shape = new PhysicsShapeBox(centerLocal, Quaternion.Identity(), extents, this.scene);
            mesh.physicsBody.shape = shape;
        } else {
            mesh.physicsBody.shape = PhysicsShapeBox.FromMesh(mesh);
        }

        mesh.physicsBody.setMassProperties({
            mass: mass,
        });
        console.log('物件已加入物理系統 (v2)', mesh.name); //, mesh, mesh.physicsBody);
    }

    /**
     * 將 mesh 剛體移除 (v2)
     * @param mesh
     */
    public removePhysics(mesh: Mesh) {
        if (mesh.physicsBody) {
            mesh.physicsBody.dispose();
            mesh.physicsBody = null;
            console.log('物件已從物理系統移除 (v2)', mesh.name, mesh);
        }
    }
}
