import { Color3, Mesh, PBRMaterial, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2';

import { Ceiling } from '../../components/scene/ceiling';
import { Floor } from '../../components/scene/floor';
import { Wall } from '../../components/scene/wall';
import { DefaultRoomConfig, RoomConfig, WallFacing } from '../../config/scene/roomConfig';
import { PhysicsManager } from '../../managers/physicsManager';

// RoomModule 所需依賴
interface RoomModuleDependencies {
    scene: Scene;
    physics: PhysicsManager;
}

// 專責建立/銷毀房間靜態物件的模組
export class RoomModule {
    private readonly scene: Scene;
    private readonly physics: PhysicsManager;
    private readonly config: RoomConfig;

    private floor?: Floor;
    private ceiling?: Ceiling;
    private walls: Wall[] = [];

    // 建構子：注入依賴與配置
    constructor(deps: RoomModuleDependencies, config: RoomConfig = DefaultRoomConfig) {
        this.scene = deps.scene;
        this.physics = deps.physics;
        this.config = config;
    }

    // 初始化：建立地板、牆壁及天花板
    public init() {
        this.buildFloor();
        this.buildWalls();
        this.buildCeiling();
    }

    // 銷毀：移除物理並釋放 mesh
    public destroy() {
        if (this.floor) {
            this.physics.removePhysics(this.floor.Mesh);
            this.floor.Mesh.dispose();
            this.floor = undefined;
        }

        this.walls.forEach((wall) => {
            this.physics.removePhysics(wall.mesh);
            wall.mesh.dispose();
        });
        this.walls = [];

        if (this.ceiling) {
            this.physics.removePhysics(this.ceiling.Mesh);
            this.ceiling.Mesh.dispose();
            this.ceiling = undefined;
        }
    }

    // 取得地板實例
    public getFloor(): Floor | undefined {
        return this.floor;
    }

    // 取得牆壁實例列表
    public getWalls(): Wall[] {
        return this.walls;
    }

    // 取得天花板實例
    public getCeiling(): Ceiling | undefined {
        return this.ceiling;
    }

    // 建立地板並套用材質/物理
    private buildFloor() {
        const { width, depth } = this.config.floor.size;
        this.floor = new Floor(this.scene, width, depth);
        this.physics.addPhysics(this.floor.Mesh, PhysicsMotionType.STATIC, true);
        this.applyFloorMaterial(this.floor.Mesh);
    }

    // 建立牆壁並套用材質/物理
    private buildWalls() {
        this.walls = this.config.walls.map((wallConfig) => {
            const position = toVector3(wallConfig.position);
            const wall = new Wall(this.scene, position, wallConfig.length, wallConfig.height, wallConfig.facing);
            this.physics.addPhysics(wall.mesh, PhysicsMotionType.STATIC, true);
            this.applyWallMaterial(wall.mesh, wallConfig.material);
            return wall;
        });
    }

    // 建立天花板並套用材質/物理
    private buildCeiling() {
        const { width, depth } = this.config.ceiling.size;
        this.ceiling = new Ceiling(this.scene, width, depth);
        this.ceiling.Mesh.position.y = this.config.ceiling.height;
        this.physics.addPhysics(this.ceiling.Mesh, PhysicsMotionType.STATIC, true);
        this.applyCeilingMaterial(this.ceiling.Mesh);
    }

    // 套用地板材質設定
    private applyFloorMaterial(mesh: Mesh) {
        const mat = ensurePbrMaterial(mesh, `${this.config.floor.id}-mat`, this.scene);
        const { material } = this.config.floor;
        mat.albedoColor = Color3.FromArray(material.albedoColor);

        const albedoTexture = new Texture(material.albedoTexture, this.scene);
        albedoTexture.uScale = material.textureScale.u;
        albedoTexture.vScale = material.textureScale.v;
        mat.albedoTexture = albedoTexture;

        const bump = new Texture(material.bumpTexture.key, this.scene);
        bump.level = material.bumpTexture.level;
        bump.uScale = material.bumpTexture.scale.u;
        bump.vScale = material.bumpTexture.scale.v;
        mat.bumpTexture = bump;

        mat.metallic = material.metallic;
        mat.roughness = material.roughness;
        mesh.material = mat;
    }

    // 套用牆面材質設定
    private applyWallMaterial(mesh: Mesh, materialConfig: RoomConfig['walls'][number]['material']) {
        const mat = ensurePbrMaterial(mesh, `${mesh.name}-mat`, this.scene);
        mat.albedoColor = Color3.FromArray(materialConfig.albedoColor);

        const albedoTexture = new Texture(materialConfig.albedoTexture, this.scene);
        albedoTexture.uScale = materialConfig.textureScale.u;
        albedoTexture.vScale = materialConfig.textureScale.v;
        mat.albedoTexture = albedoTexture;

        const bump = new Texture(materialConfig.bumpTexture.key, this.scene);
        bump.level = materialConfig.bumpTexture.level;
        bump.uScale = materialConfig.bumpTexture.scale.u;
        bump.vScale = materialConfig.bumpTexture.scale.v;
        mat.bumpTexture = bump;
        mat.microSurfaceTexture = bump;

        const metallic = new Texture(materialConfig.metallicTexture.key, this.scene);
        metallic.uScale = materialConfig.metallicTexture.scale.u;
        metallic.vScale = materialConfig.metallicTexture.scale.v;
        mat.metallicTexture = metallic;

        mat.metallic = materialConfig.metallic;
        mat.roughness = materialConfig.roughness;
        mat.backFaceCulling = true;
        mesh.material = mat;
    }

    // 套用天花板材質設定
    private applyCeilingMaterial(mesh: Mesh) {
        const previous = mesh.material;
        if (previous && previous instanceof PBRMaterial) {
            previous.dispose();
        }
        const mat = new StandardMaterial(`${this.config.ceiling.id}-mat`, this.scene);
        mat.diffuseColor = Color3.FromArray(this.config.ceiling.materialColor);
        mat.backFaceCulling = true;
        mesh.material = mat;
    }
}

function toVector3(tuple: [number, number, number]): Vector3 {
    return new Vector3(tuple[0], tuple[1], tuple[2]);
}

function ensurePbrMaterial(mesh: Mesh, name: string, scene: Scene): PBRMaterial {
    const existing = mesh.material;
    if (existing instanceof PBRMaterial) {
        return existing;
    }
    const mat = new PBRMaterial(name, scene);
    mesh.material = mat;
    return mat;
}
