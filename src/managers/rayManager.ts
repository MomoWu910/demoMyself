import { Mesh, Scene, Ray, StandardMaterial, Camera, PickingInfo, Matrix, Texture, DynamicTexture } from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';

export class RayManager {
    private ray: Ray;
    private scene: Scene;
    private activeCamera: Camera;
    private registeredPlanes: Map<Mesh, (event: any) => void>;

    constructor(scene: Scene, activeCamera: Camera) {
        this.scene = scene;
        this.activeCamera = activeCamera;
        this.registeredPlanes = new Map();
        this.ray = this.scene.createPickingRayInCameraSpace(this.scene.pointerX, this.scene.pointerY, this.activeCamera);

        // 監聽滑鼠移動事件，使用 Ray 進行檢測
        this.scene.onPointerObservable.add(() => {
            if (this.scene.activeCamera === this.activeCamera)
                // 只在指定相機下觸發
                this.handlePointerMove();
        });
    }

    /**
     * 註冊一個平面到 Ray 系統
     * @param plane 要註冊的平面
     * @param callback 點擊事件的回調函數
     */
    public registerPlanes(plane: Mesh, callback: (event: any) => void): void {
        if (this.registeredPlanes.has(plane)) {
            console.warn('平面已經註冊過:', plane);
            return;
        }

        this.registeredPlanes.set(plane, callback);
        // console.log('已註冊平面:', plane);
    }

    /**
     * 解除註冊一個平面
     * @param plane 要解除註冊的平面
     */
    public unregisterPlane(plane: Mesh): void {
        if (!this.registeredPlanes.has(plane)) {
            console.warn('平面未註冊:', plane);
            return;
        }

        this.registeredPlanes.delete(plane);
        // console.log('已解除註冊平面:', plane);
    }

    /**
     * 處理滑鼠移動事件，使用 Ray 進行檢測
     */
    private handlePointerMove(): void {
        // 更新射線的原點和方向
        this.scene.createPickingRayToRef(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.ray, this.activeCamera);

        // 收集所有命中的平面
        const hitPlanes: { plane: Mesh; pickInfo: PickingInfo }[] = [];

        this.registeredPlanes.forEach((_, plane) => {
            if (!plane.isPickable) {
                return;
            }

            const pickInfo = this.scene.pickWithRay(this.ray, (mesh) => mesh === plane);
            if (pickInfo?.hit && pickInfo.pickedMesh) {
                hitPlanes.push({ plane, pickInfo });
            }
        });

        let isAllNoAlpha = true;

        // 遍歷命中的平面，檢查 alpha 值
        hitPlanes.forEach(({ plane, pickInfo }) => {
            const uv = pickInfo.getTextureCoordinates();
            if (uv) {
                const diffuseTexture = (plane.material as StandardMaterial).diffuseTexture;
                if (diffuseTexture && diffuseTexture instanceof DynamicTexture) {
                    const dynamicTexture = diffuseTexture as DynamicTexture;
                    const textureWidth = dynamicTexture.getSize().width;
                    const textureHeight = dynamicTexture.getSize().height;

                    // 計算像素位置，並檢查邊界
                    const px = Math.min(Math.max(Math.floor(textureWidth * uv.x), 0), textureWidth - 1);
                    const py = Math.min(Math.max(Math.floor(textureHeight * (1 - uv.y)), 0), textureHeight - 1); // 翻轉 Y 坐標

                    const ctx = dynamicTexture.getContext();
                    const imageData = ctx.getImageData(px, py, 1, 1).data;
                    const alpha = imageData[3] / 255; // 將 alpha 值歸一化

                    if (alpha > 0.01) {
                        const callback = this.registeredPlanes.get(plane);
                        // console.log('pickInfo:', pickInfo, plane.name, alpha);
                        if (callback) {
                            isAllNoAlpha = false;
                            callback({ type: 'hover', plane, pickInfo });
                        }
                    }
                }
            }
        });

        if (isAllNoAlpha) {
            // 如果沒有任何平面被 hover，則觸發所有平面的 noHover 事件
            this.registeredPlanes.forEach((callback, plane) => {
                callback({ type: 'noHover', plane, pickInfo: null });
            });
        }
    }
}
