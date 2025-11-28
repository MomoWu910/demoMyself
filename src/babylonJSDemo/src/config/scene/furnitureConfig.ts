import { PhysicsMotionType } from '@babylonjs/core/Physics/v2';

// 支援的賭桌類型
export type TableKind = 'halfCylinder' | 'cylinder';

// 物理設定描述表，供桌椅共用
export interface PhysicsConfig {
    motionType: PhysicsMotionType;
    startsAsleep: boolean;
    mass?: number;
    useBoundingBox?: boolean;
}

// 單張賭桌的配置
export interface TableConfig {
    id: string;
    kind: TableKind;
    position: [number, number, number];
    rotation?: [number, number, number];
    enabled: boolean;
    physics: PhysicsConfig;
    parameters?: {
        radius?: number;
        thickness?: number;
        legHeight?: number;
        legRadius?: number;
    };
}

// 單張椅子的配置
export interface ChairConfig {
    id: string;
    position: [number, number, number];
    rotation?: [number, number, number];
    physics: PhysicsConfig;
    parameters?: {
        seatRadius?: number;
        seatThickness?: number;
        legHeight?: number;
        legRadius?: number;
    };
}

// 家具（桌椅）整體配置
export interface FurnitureConfig {
    tables: TableConfig[];
    chairs: ChairConfig[];
}

export const DefaultFurnitureConfig: FurnitureConfig = {
    tables: [
        {
            id: 'table-half',
            kind: 'halfCylinder',
            position: [0, 3.5 + 0.5 / 2, 0],
            enabled: false,
            physics: {
                motionType: PhysicsMotionType.STATIC,
                startsAsleep: true,
            },
            parameters: {
                radius: 6,
                thickness: 0.5,
                legHeight: 3.5,
                legRadius: 0.3,
            },
        },
        {
            id: 'table-main',
            kind: 'cylinder',
            position: [0, 3.5 + 0.5 / 2, 0],
            enabled: true,
            physics: {
                motionType: PhysicsMotionType.STATIC,
                startsAsleep: true,
            },
            parameters: {
                radius: 4,
                thickness: 0.5,
                legHeight: 3.5,
                legRadius: 0.3,
            },
        },
    ],
    chairs: [
        {
            id: 'chair-main',
            position: [0, 2.15, 5],
            physics: {
                motionType: PhysicsMotionType.STATIC,
                startsAsleep: true,
            },
            parameters: {
                seatRadius: 1,
                seatThickness: 0.3,
                legHeight: 2,
                legRadius: 0.15,
            },
        },
    ],
};
