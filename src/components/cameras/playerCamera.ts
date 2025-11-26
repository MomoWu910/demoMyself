import { UniversalCamera, Scene, Vector3, Observer, Nullable } from '@babylonjs/core';
import type { ActionMap } from '../../managers/inputManager';
import { IControllable } from '../../constants/interfaces';

const CAMERA_SPEED = 0.2; // 相機移動速度
const CAMERA_ROTATION_SPEED = 0.1; // 相機旋轉速度
// 跳躍相關常數（可依實際手感微調）
// Up / Down 採用不同重力，模擬平台遊戲常見「上升慢、下降快」的手感
const GRAVITY_UP = -12; // 上升期重力 (單位/秒^2)
const GRAVITY_DOWN = -24; // 下降期重力 (單位/秒^2)
const MAX_FALL_SPEED = -32; // 最大下落速度 clamp
const JUMP_INITIAL_VELOCITY = 9; // 初速度，理論最大高度 ≈ v^2 / (2 * |GRAVITY_UP|) ≈ 2.0
const APEX_SLOW_THRESHOLD = 1.2; // 低於此向上速度時進入頂點緩衝
const APEX_DAMP = 0.4; // 頂點緩衝系數（0~1，越小頂點越平緩）
const MAX_JUMPS = 2; // 總跳躍次數（地面起跳+空中再跳一次）
// 二段跳：不再使用縮放，第二段直接重設為初速度

/**
 * 玩家第一人稱相機元件
 * @description 建立並管理 UniversalCamera，支援視角控制與目標切換
 */
export class PlayerCamera implements IControllable {
    public name: string = 'playerCamera'; // 相機名稱
    public camera: UniversalCamera; // Babylon.js UniversalCamera 實例
    // 跳躍狀態欄位
    private isJumping: boolean = false;
    private verticalVelocity: number = 0; // 當前垂直速度 (單位/秒)
    private jumpObserver?: Nullable<Observer<Scene>>; // 用於取消註冊更新
    private jumpCount: number = 0; // 已使用跳躍次數
    private lastGroundY: number = 0; // 最近一次判定為地面的 y

    /**
     * 建構子：初始化玩家相機
     * @param scene Babylon.js 場景
     * @param canvas HTMLCanvasElement - 用於控制相機的畫布
     * @param startPosition Vector3 - 相機初始位置，預設 (0, 2, -10)
     */
    constructor(scene: Scene, canvas: HTMLCanvasElement, startPosition: Vector3 = new Vector3(0, 2, -20)) {
        this.camera = new UniversalCamera(this.name, startPosition, scene); // 建立 UniversalCamera

        // 啟用鍵鼠控制
        this.camera.attachControl(canvas, true);
        // 可根據需求擴充 WASD 控制、碰撞、限制範圍等
    }

    /**
     * 切換相機目標
     * @param target Vector3 - 新的目標位置
     */
    public setTarget(target: Vector3) {
        this.camera.setTarget(target);
    }

    /**
     * 啟用或停用相機控制
     * @param enable boolean - 是否啟用控制
     * @param canvas HTMLCanvasElement - 控制用畫布
     */
    public enableControl(enable: boolean, canvas: HTMLCanvasElement) {
        this.camera.attachControl(canvas, enable);
    }

    /**
     * 取得供 InputManager 使用的按鍵對應表
     */
    public getActionMap(): ActionMap {
        return {
            w: { onHold: this.moveForward.bind(this) },
            s: { onHold: this.moveBackward.bind(this) },
            a: { onHold: this.moveLeft.bind(this) },
            d: { onHold: this.moveRight.bind(this) },
            q: { onHold: this.rotateLeft.bind(this) },
            e: { onHold: this.rotateRight.bind(this) },
            ' ': { onPressed: this.playJump.bind(this) },
        };
    }

    /**
     * 依照鏡頭朝向前進
     */
    public moveForward(): void {
        const forward = new Vector3(Math.sin(this.camera.rotation.y), 0, Math.cos(this.camera.rotation.y));
        forward.normalize();
        this.camera.position.addInPlace(forward.scale(CAMERA_SPEED));
    }

    /**
     * 依照鏡頭朝向後退
     */
    public moveBackward(): void {
        const backward = new Vector3(-Math.sin(this.camera.rotation.y), 0, -Math.cos(this.camera.rotation.y));
        backward.normalize();
        this.camera.position.addInPlace(backward.scale(CAMERA_SPEED));
    }

    /**
     * 依照鏡頭朝向左移
     */
    public moveLeft(): void {
        const left = new Vector3(
            Math.sin(this.camera.rotation.y + Math.PI / 2),
            0,
            Math.cos(this.camera.rotation.y + Math.PI / 2)
        );
        left.normalize();
        this.camera.position.addInPlace(left.scale(CAMERA_SPEED));
    }

    /**
     * 依照鏡頭朝向右移
     */
    public moveRight(): void {
        const right = new Vector3(
            Math.sin(this.camera.rotation.y - Math.PI / 2),
            0,
            Math.cos(this.camera.rotation.y - Math.PI / 2)
        );
        right.normalize();
        this.camera.position.addInPlace(right.scale(CAMERA_SPEED));
    }

    public rotateBy(dx: number, dy: number): void {
        this.camera.rotation.y += dx * CAMERA_ROTATION_SPEED;
        this.camera.rotation.x += dy * CAMERA_ROTATION_SPEED;
    }

    public rotateRight(): void {
        this.camera.rotation.y += CAMERA_ROTATION_SPEED * 0.25;
    }

    public rotateLeft(): void {
        this.camera.rotation.y -= CAMERA_ROTATION_SPEED * 0.25;
    }

    public playJump(): void {
        // 初始化或執行二段跳：允許在未達到 MAX_JUMPS 前再次觸發
        if (this.jumpCount >= MAX_JUMPS) return; // 超過可用跳躍次數

        // 若第一次跳：記錄地面高度
        if (this.jumpCount === 0) {
            this.lastGroundY = this.camera.position.y;
        }

        this.jumpCount++;

        // 任何一段跳都將垂直速度重設為初速度 (提昇二段跳體感明顯度)
        this.verticalVelocity = JUMP_INITIAL_VELOCITY;
        this.isJumping = true;

        const scene = this.camera.getScene();

        if (!this.jumpObserver) {
            this.jumpObserver = scene.onBeforeRenderObservable.add(() => {
                const dt = scene.getEngine().getDeltaTime() / 1000; // 秒

                // 重力選擇
                let gravity = this.verticalVelocity > 0 ? GRAVITY_UP : GRAVITY_DOWN;

                // 頂點緩衝
                if (this.verticalVelocity > 0 && this.verticalVelocity < APEX_SLOW_THRESHOLD) {
                    this.verticalVelocity *= Math.pow(APEX_DAMP, dt * 60);
                }

                // 整合速度
                this.verticalVelocity += gravity * dt;
                if (this.verticalVelocity < MAX_FALL_SPEED) this.verticalVelocity = MAX_FALL_SPEED;

                // 更新位置
                this.camera.position.y += this.verticalVelocity * dt;

                // 著地判定：回到或低於 lastGroundY 視為落地
                if (this.camera.position.y <= this.lastGroundY) {
                    this.camera.position.y = this.lastGroundY;
                    this.verticalVelocity = 0;
                    this.isJumping = false;
                    this.jumpCount = 0; // 重置跳躍次數
                }

                // 若已經落地且沒有垂直速度，可以移除 observer
                if (!this.isJumping && this.verticalVelocity === 0) {
                    if (this.jumpObserver) {
                        scene.onBeforeRenderObservable.remove(this.jumpObserver);
                        this.jumpObserver = undefined;
                    }
                }
            });
        }
    }

    public get position(): Vector3 {
        return this.camera.position;
    }
}
