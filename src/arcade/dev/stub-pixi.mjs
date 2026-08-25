/** 讓 reel.ts 能在 Node 裡跑起來的最小 Pixi 替身。只實作 Reel 真正碰到的東西。 */

export class Container {
    constructor() {
        this.children = [];
        this.mask = null;
        this.x = 0;
        this.y = 0;
        this.alpha = 1;
        this.visible = true;
        this.destroyed = false;
        // `position.set(x, y)` 要寫到 x／y 本身——gsap 動的是 `.x`／`.y`，
        // 兩者不同步的話測試會讀到一個永遠不變的舊值，然後印出綠燈
        this.position = {
            owner: this,
            set(x, y = x) {
                this.owner.x = x;
                this.owner.y = y;
            },
        };
    }
    addChild(c) {
        this.children.push(c);
        return c;
    }
    addChildAt(c, i) {
        this.children.splice(i, 0, c);
        return c;
    }
    setChildIndex(c, i) {
        const at = this.children.indexOf(c);
        if (at < 0) return;
        this.children.splice(at, 1);
        this.children.splice(i, 0, c);
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

/** 只是個資料袋。烘 atlas 的程式用它切圖框，Node 這側不需要它真的做什麼 */
export class Rectangle {
    constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
}

/** 佔位。atlas 那幾支檔案 import 了它（烘圖要 renderer），但 Node 這側不會走到烘圖 */
export class Application {}
export class Text extends Container {}
export class TextStyle {}
