import { ArcRotateCamera, Scene, Vector3 } from '@babylonjs/core';

/**
 * 開發用上帝視角相機元件
 * @description 建立 ArcRotateCamera，可自由旋轉、縮放、俯瞰場景
 */
export class Game28gAngelCamera {
    public camera: ArcRotateCamera; // Babylon.js ArcRotateCamera 實例

    /**
     * 建構子：初始化上帝視角相機
     * @param scene Babylon.js 場景
     * @param canvas HTMLCanvasElement - 用於控制相機的畫布
     * @param alpha number - 水平旋轉角度（預設 -Math.PI/2）
     * @param beta number - 垂直旋轉角度（預設 Math.PI/3）
     * @param radius number - 與目標距離（預設 120）
     * @param target Vector3 - 目標位置（預設場景原點）
     */
    constructor(
        scene: Scene,
        canvas: HTMLCanvasElement,
        alpha: number = -Math.PI / 2,
        beta: number = Math.PI / 3,
        radius: number = 120,
        target: Vector3 = Vector3.Zero()
    ) {
        this.camera = new ArcRotateCamera('game_28g_Angle_Camera', alpha, beta, radius, target, scene);
        this.camera.lowerRadiusLimit = 10;
        this.camera.upperRadiusLimit = 500;
        this.camera.lowerAlphaLimit = -10;
        this.camera.wheelPrecision = 2;

        // 鏡頭拍攝寬度
        this.camera.fov = 0.45;
    }
}
