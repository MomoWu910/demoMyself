import { Sprite, Texture } from 'pixi.js';

export class Shiba extends Sprite {
    speedX: number;
    speedY: number;

    constructor(texture: Texture) {
        super(texture);
        this.speedX = Math.random() * 10;
        this.speedY = (Math.random() * 10) - 5;
        this.anchor.set(0.5);
        this.scale.set(0.025);
    }

    public randomizePosition(maxX: number, maxY: number) {
        this.x = Math.random() * maxX;
        this.y = Math.random() * maxY;
    }

    public update(gravity: number, maxX: number, maxY: number) {
        this.x += this.speedX;
        this.y += this.speedY;
        this.speedY += gravity;

        if (this.x > maxX) {
            this.speedX *= -1;
            this.speedY *= -0.6;
            if (Math.random() > 0.5) {
                this.speedY -= Math.random() * 4.5;
            }
            this.x = maxX;
        } else if (this.x < 0) {
            this.speedX *= -1;
            this.speedY *= -0.6;
            if (Math.random() > 0.5) {
                this.speedY -= Math.random() * 4.5;
            }
            this.x = 0;
        }

        if (this.y > maxY) {
            this.speedY *= -0.6;
            this.y = maxY;
            if (Math.random() > 0.5) {
                this.speedY -= Math.random() * 4.5;
            }
        } else if (this.y < 0) {
            this.speedY = 0;
            this.y = 0;
        }
    }
}
