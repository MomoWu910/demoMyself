import { Scene } from '@babylonjs/core';

import { DefaultFurnitureConfig, FurnitureConfig } from '../config/scene/furnitureConfig';
import { DefaultRoomConfig, RoomConfig } from '../config/scene/roomConfig';
import { PhysicsManager } from '../managers/physicsManager';
import { FurnitureModule } from './modules/furnitureModule';
import { RoomModule } from './modules/roomModule';
import { SceneConfiguration } from './types';

// SceneBuilder 初始化所需服務
interface SceneBuilderDependencies {
    scene: Scene;
    physics: PhysicsManager;
}

export class SceneBuilder {
    private readonly scene: Scene;
    private readonly physics: PhysicsManager;
    private roomModule?: RoomModule;
    private furnitureModule?: FurnitureModule;

    // 建構子：注入共用場景與物理服務
    constructor(deps: SceneBuilderDependencies) {
        this.scene = deps.scene;
        this.physics = deps.physics;
    }

    // 初始化所有靜態模組
    public init(config: SceneConfiguration = {}) {
        const roomConfig: RoomConfig = config.room ?? DefaultRoomConfig;
        const furnitureConfig: FurnitureConfig = config.furniture ?? DefaultFurnitureConfig;

        this.roomModule = new RoomModule({ scene: this.scene, physics: this.physics }, roomConfig);
        this.roomModule.init();

        this.furnitureModule = new FurnitureModule({ scene: this.scene, physics: this.physics }, furnitureConfig);
        this.furnitureModule.init();
    }

    // 釋放模組資源
    public destroy() {
        this.furnitureModule?.destroy();
        this.roomModule?.destroy();
        this.furnitureModule = undefined;
        this.roomModule = undefined;
    }

    // 取得家具模組（讓外部存取桌椅資訊）
    public getFurnitureModule() {
        return this.furnitureModule;
    }

    // 取得房間模組（讓外部存取房間實例）
    public getRoomModule() {
        return this.roomModule;
    }
}
