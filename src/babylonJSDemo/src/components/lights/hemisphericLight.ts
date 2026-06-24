import { HemisphericLight, Scene, Vector3, Color3 } from '@babylonjs/core';

export class HLight {
    public light: HemisphericLight;

    /**
     * 建立半球光，預設高度 20（單位：公尺），強度 0.8
     */
    constructor(scene: Scene, direction: Vector3 = new Vector3(0, 20, 0)) {
        this.light = new HemisphericLight('hemisphericLight', direction, scene);
        this.light.intensity = 0.5;
        this.light.diffuse = new Color3(1, 1, 1);
        this.light.groundColor = new Color3(1, 1, 1);
    }
}
