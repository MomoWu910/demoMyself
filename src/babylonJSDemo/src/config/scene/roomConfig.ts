import { ImagePack } from '../../constants/assets';

// 支援四個方向的牆面朝向描述
export type WallFacing = 'north' | 'south' | 'east' | 'west';

// 牆面配置：位置、尺寸、材質資訊
export interface WallConfig {
    id: string;
    position: [number, number, number];
    length: number;
    height: number;
    facing: WallFacing;
    material: {
        albedoColor: [number, number, number];
        albedoTexture: string;
        textureScale: { u: number; v: number };
        bumpTexture: {
            key: string;
            level: number;
            scale: { u: number; v: number };
        };
        metallicTexture: {
            key: string;
            scale: { u: number; v: number };
        };
        metallic: number;
        roughness: number;
    };
}

// 地板配置：尺寸與材質設定
export interface FloorConfig {
    id: string;
    size: { width: number; depth: number };
    material: {
        albedoColor: [number, number, number];
        albedoTexture: string;
        textureScale: { u: number; v: number };
        bumpTexture: {
            key: string;
            level: number;
            scale: { u: number; v: number };
        };
        metallic: number;
        roughness: number;
    };
}

// 天花板配置：尺寸、高度與顏色
export interface CeilingConfig {
    id: string;
    size: { width: number; depth: number };
    materialColor: [number, number, number];
    height: number;
}

// 房間總配置：地板、牆、天花板
export interface RoomConfig {
    bounds: { width: number; depth: number; height: number };
    floor: FloorConfig;
    walls: WallConfig[];
    ceiling: CeilingConfig;
}

const ROOM_WIDTH = 100;
const ROOM_DEPTH = 100;
const ROOM_HEIGHT = 50;

export const DefaultRoomConfig: RoomConfig = {
    bounds: {
        width: ROOM_WIDTH,
        depth: ROOM_DEPTH,
        height: ROOM_HEIGHT,
    },
    floor: {
        id: 'floor',
        size: {
            width: ROOM_WIDTH,
            depth: ROOM_DEPTH,
        },
        material: {
            albedoColor: [0.8, 0.0015, 0.0015],
            albedoTexture: ImagePack.carpet_fleurdelis,
            textureScale: { u: 4, v: 4 },
            bumpTexture: {
                key: ImagePack.carpet_normal_height,
                level: 1.5,
                scale: { u: 8, v: 8 },
            },
            metallic: 0,
            roughness: 1,
        },
    },
    walls: [
        {
            id: 'wall_north',
            position: [0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2],
            length: ROOM_WIDTH,
            height: ROOM_HEIGHT,
            facing: 'north',
            material: {
                albedoColor: [0.9, 0.9, 0.9],
                albedoTexture: ImagePack.embossed_basecolor,
                textureScale: { u: 20, v: 20 },
                bumpTexture: {
                    key: ImagePack.embossed_normal,
                    level: 1.5,
                    scale: { u: 20, v: 20 },
                },
                metallicTexture: {
                    key: ImagePack.embossed_metallic,
                    scale: { u: 20, v: 20 },
                },
                metallic: 1,
                roughness: 0.7,
            },
        },
        {
            id: 'wall_south',
            position: [0, ROOM_HEIGHT / 2, ROOM_DEPTH / 2],
            length: ROOM_WIDTH,
            height: ROOM_HEIGHT,
            facing: 'south',
            material: {
                albedoColor: [0.9, 0.9, 0.9],
                albedoTexture: ImagePack.embossed_basecolor,
                textureScale: { u: 20, v: 20 },
                bumpTexture: {
                    key: ImagePack.embossed_normal,
                    level: 1.5,
                    scale: { u: 20, v: 20 },
                },
                metallicTexture: {
                    key: ImagePack.embossed_metallic,
                    scale: { u: 20, v: 20 },
                },
                metallic: 1,
                roughness: 0.7,
            },
        },
        {
            id: 'wall_west',
            position: [-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0],
            length: ROOM_DEPTH,
            height: ROOM_HEIGHT,
            facing: 'west',
            material: {
                albedoColor: [0.9, 0.9, 0.9],
                albedoTexture: ImagePack.embossed_basecolor,
                textureScale: { u: 20, v: 20 },
                bumpTexture: {
                    key: ImagePack.embossed_normal,
                    level: 1.5,
                    scale: { u: 20, v: 20 },
                },
                metallicTexture: {
                    key: ImagePack.embossed_metallic,
                    scale: { u: 20, v: 20 },
                },
                metallic: 1,
                roughness: 0.7,
            },
        },
        {
            id: 'wall_east',
            position: [ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0],
            length: ROOM_DEPTH,
            height: ROOM_HEIGHT,
            facing: 'east',
            material: {
                albedoColor: [0.9, 0.9, 0.9],
                albedoTexture: ImagePack.embossed_basecolor,
                textureScale: { u: 20, v: 20 },
                bumpTexture: {
                    key: ImagePack.embossed_normal,
                    level: 1.5,
                    scale: { u: 20, v: 20 },
                },
                metallicTexture: {
                    key: ImagePack.embossed_metallic,
                    scale: { u: 20, v: 20 },
                },
                metallic: 1,
                roughness: 0.7,
            },
        },
    ],
    ceiling: {
        id: 'ceiling',
        size: {
            width: ROOM_WIDTH,
            depth: ROOM_DEPTH,
        },
        materialColor: [0.36, 0.18, 0.07],
        height: ROOM_HEIGHT,
    },
};
