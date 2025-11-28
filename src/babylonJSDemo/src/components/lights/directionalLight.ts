import { DirectionalLight, Light, Scene, Vector3 } from '@babylonjs/core';

export class DLight {
    public light: DirectionalLight;

    constructor(scene: Scene, direction: Vector3 = new Vector3(0, -1, 0)) {
        this.light = new DirectionalLight('dirLight', direction, scene);
        this.light.intensity = 1.5;
        this.light.lightmapMode = Light.LIGHTMAP_SPECULAR;
    }
}
