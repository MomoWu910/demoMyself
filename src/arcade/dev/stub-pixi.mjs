/** 讓 reel.ts 能在 Node 裡跑起來的最小 Pixi 替身。只實作 Reel 真正碰到的東西。 */

export class Container {
    constructor() {
        this.children = [];
        this.mask = null;
        this.x = 0;
        this.y = 0;
        this.destroyed = false;
    }
    addChild(c) {
        this.children.push(c);
        return c;
    }
    addChildAt(c, i) {
        this.children.splice(i, 0, c);
        return c;
    }
    destroy() {
        this.destroyed = true;
    }
}

export class Sprite extends Container {
    constructor() {
        super();
        this.anchor = { set: () => {} };
        this._texture = null;
        this.width = 0;
        this.height = 0;
        this.scale = {
            x: 1,
            y: 1,
            set(v) {
                this.x = v;
                this.y = v;
            },
        };
    }
    get texture() {
        return this._texture;
    }
    set texture(t) {
        this._texture = t;
    }
}

export class Graphics extends Container {
    clear() {
        return this;
    }
    rect() {
        return this;
    }
    fill() {
        return this;
    }
}

export class Texture {}
export class Text extends Container {}
export class TextStyle {}
