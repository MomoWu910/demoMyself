import { PointLight, Scene, Vector3 } from '@babylonjs/core';

export class PLight {
    public light: PointLight;

    constructor(scene: Scene, position: Vector3 = new Vector3(0, 5, 0)) {
        this.light = new PointLight('pointLight', position, scene);
        this.light.intensity = 2;
        this.light.range = 100;
    }
}
