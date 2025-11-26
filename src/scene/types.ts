import { Scene } from '@babylonjs/core';

import { FurnitureConfig } from '../config/scene/furnitureConfig';
import { RoomConfig } from '../config/scene/roomConfig';
import { PhysicsManager } from '../managers/physicsManager';

// 模組執行所需的共同依賴
export interface ModuleContext {
    scene: Scene;
    physics: PhysicsManager;
}

// 每個場景模組需實作的基本介面
export interface SceneModule<TConfig> {
    init(config: TConfig): void | Promise<void>;
    destroy(): void | Promise<void>;
}

// SceneBuilder 可接受的配置集合
export interface SceneConfiguration {
    room?: RoomConfig;
    furniture?: FurnitureConfig;
}
