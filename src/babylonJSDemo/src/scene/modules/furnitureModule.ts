import { Mesh, Scene, Vector3 } from '@babylonjs/core';

import { Chair } from '../../components/scene/chair';
import { CylinderTable } from '../../components/scene/cTable';
import { HalfCylinderTable } from '../../components/scene/halfCTable';
import { DefaultFurnitureConfig, FurnitureConfig, TableKind } from '../../config/scene/furnitureConfig';
import { PhysicsManager } from '../../managers/physicsManager';

// FurnitureModule 所需依賴
interface FurnitureModuleDependencies {
    scene: Scene;
    physics: PhysicsManager;
}

// 追蹤賭桌實例資訊
interface TableRecord {
    id: string;
    kind: TableKind;
    mesh: Mesh;
    instance: HalfCylinderTable | CylinderTable;
    setEnabled: (enabled: boolean) => void;
    tableTopPos: Vector3;
    config: FurnitureConfig['tables'][number];
}

// 追蹤椅子實例資訊
interface ChairRecord {
    id: string;
    chair: Chair;
    config: FurnitureConfig['chairs'][number];
}

// 負責建立桌椅並管理切換/銷毀的模組
export class FurnitureModule {
    private readonly scene: Scene;
    private readonly physics: PhysicsManager;
    private readonly config: FurnitureConfig;

    private tables: TableRecord[] = [];
    private chairs: ChairRecord[] = [];

    // 建構子：注入依賴與預設配置
    constructor(deps: FurnitureModuleDependencies, config: FurnitureConfig = DefaultFurnitureConfig) {
        this.scene = deps.scene;
        this.physics = deps.physics;
        this.config = config;
    }

    // 初始化：建立所有賭桌與椅子
    public init() {
        this.buildTables();
        this.buildChairs();
    }

    // 銷毀：解除物理並釋放資源
    public destroy() {
        this.tables.forEach((table) => {
            this.physics.removePhysics(table.mesh);
            table.mesh.dispose();
        });
        this.tables = [];

        this.chairs.forEach(({ chair }) => {
            this.physics.removePhysics(chair.Mesh);
            chair.Mesh.dispose();
        });
        this.chairs = [];
    }

    // 擷取目前啟用中的賭桌
    public getActiveTable(): TableRecord | undefined {
        return this.tables.find((table) => table.mesh.isEnabled());
    }

    // 切換指定賭桌為啟用狀態
    public enableTable(id: string) {
        this.tables.forEach((table) => {
            const shouldEnable = table.id === id;
            table.setEnabled(shouldEnable);
            if (shouldEnable) {
                const physics = table.config.physics;
                this.physics.addPhysics(
                    table.mesh,
                    physics.motionType,
                    physics.startsAsleep,
                    physics.mass,
                    physics.useBoundingBox
                );
            } else {
                this.physics.removePhysics(table.mesh);
            }
        });
    }

    // 取得全部賭桌紀錄
    public getTables(): TableRecord[] {
        return this.tables;
    }

    // 依 id 取得賭桌
    public getTableById(id: string): TableRecord | undefined {
        return this.tables.find((table) => table.id === id);
    }

    // 取得全部椅子紀錄
    public getChairs(): ChairRecord[] {
        return this.chairs;
    }

    // 依 id 取得椅子
    public getChairById(id: string): ChairRecord | undefined {
        return this.chairs.find((chair) => chair.id === id);
    }

    // 建立所有賭桌並套用配置
    private buildTables() {
        this.tables = this.config.tables.map((tableConfig) => {
            const table = this.createTable(tableConfig);
            table.mesh.position = toVector3(tableConfig.position);
            if (tableConfig.rotation) {
                const [rx, ry, rz] = tableConfig.rotation;
                table.mesh.rotation.x = rx;
                table.mesh.rotation.y = ry;
                table.mesh.rotation.z = rz;
            }

            if (tableConfig.enabled) {
                this.physics.addPhysics(
                    table.mesh,
                    tableConfig.physics.motionType,
                    tableConfig.physics.startsAsleep,
                    tableConfig.physics.mass,
                    tableConfig.physics.useBoundingBox
                );
                table.setEnabled(true);
            } else {
                table.setEnabled(false);
                this.physics.removePhysics(table.mesh);
            }

            return table;
        });
    }

    // 建立所有椅子並套用配置
    private buildChairs() {
        this.chairs = this.config.chairs.map((chairConfig) => {
            const chair = new Chair(
                this.scene,
                chairConfig.parameters?.seatRadius,
                chairConfig.parameters?.seatThickness,
                chairConfig.parameters?.legHeight,
                chairConfig.parameters?.legRadius
            );
            chair.Mesh.position = toVector3(chairConfig.position);
            if (chairConfig.rotation) {
                const [rx, ry, rz] = chairConfig.rotation;
                chair.Mesh.rotation.x = rx;
                chair.Mesh.rotation.y = ry;
                chair.Mesh.rotation.z = rz;
            }

            this.physics.addPhysics(
                chair.Mesh,
                chairConfig.physics.motionType,
                chairConfig.physics.startsAsleep,
                chairConfig.physics.mass,
                chairConfig.physics.useBoundingBox
            );

            return { id: chairConfig.id, chair, config: chairConfig };
        });
    }

    // 依桌子類型建立對應實體
    private createTable(tableConfig: FurnitureConfig['tables'][number]): TableRecord {
        switch (tableConfig.kind) {
            case 'halfCylinder': {
                const table = new HalfCylinderTable(
                    this.scene,
                    tableConfig.parameters?.radius,
                    tableConfig.parameters?.thickness,
                    tableConfig.parameters?.legHeight,
                    tableConfig.parameters?.legRadius
                );
                return {
                    id: tableConfig.id,
                    kind: tableConfig.kind,
                    mesh: table.Mesh,
                    instance: table,
                    setEnabled: table.setEnabled.bind(table),
                    tableTopPos: table.TableTopPos,
                    config: tableConfig,
                };
            }
            case 'cylinder':
            default: {
                const table = new CylinderTable(
                    this.scene,
                    tableConfig.parameters?.radius,
                    tableConfig.parameters?.thickness,
                    tableConfig.parameters?.legHeight,
                    tableConfig.parameters?.legRadius
                );
                return {
                    id: tableConfig.id,
                    kind: tableConfig.kind,
                    mesh: table.Mesh,
                    instance: table,
                    setEnabled: table.setEnabled.bind(table),
                    tableTopPos: table.TableTopPos,
                    config: tableConfig,
                };
            }
        }
    }
}

function toVector3(tuple: [number, number, number]): Vector3 {
    return new Vector3(tuple[0], tuple[1], tuple[2]);
}
