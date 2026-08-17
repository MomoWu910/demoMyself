import gsap from 'gsap';
import { Container, Graphics, Rectangle, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';

/**
 * 帶慣性的橫向捲動視窗。
 *
 * 大廳的遊戲滑軌與路圖要的是同一件事：**內容比視窗長，看不到的往旁邊捲**。差別在
 * 手感——路圖是查資料，跟到手指就夠了；大廳的滑軌是每個人進站第一個碰到的東西，
 * 放開手指之後還會滑一段、撞到邊界會回彈，那個手感是「這是個 app 而不是網頁」的分界。
 *
 * 三件事刻意做成呼叫端的責任，因為它們的答案在不同場合不一樣：
 *
 * 1. **每幀更新走 `update(dt)`，元件自己不碰 ticker。** 模組契約規定每幀邏輯要登記在
 *    `ctx.frame()` 才會在卸載時被收回（見 core/module.ts）。元件自己抓 ticker 的話，
 *    它就變成第二條沒人管的生命週期——那正是這一頁想證明不會發生的事。
 * 2. **邊界由 `setContentLength()` 給。** 內容的實際長度只有呼叫端知道（幾張卡片、
 *    幾欄記號），元件去量 `content.width` 會被子物件的 filter 或空白區間騙到。
 * 3. **點擊與拖曳的分辨由 `didDrag` 提供，元件不代為攔截。** 卡片自己收 `pointertap`
 *    比較好寫，但拖曳結束那一下也會發 tap；讓卡片問一句「剛剛是在拖嗎」比在這裡
 *    模擬一套點擊分派乾淨。
 */

/** 拖曳超過這個距離（px）就算「在滑」，不再算點擊。 */
const DRAG_SLOP = 8;
/** 慣性的線性減速度（px/s²）。數字大 = 滑一下就停，小 = 溜過頭。 */
const FRICTION = 2600;
/** 甩出去的初速上限（px/s）。不設限的話一個快速輕彈可以直接飛到列尾 */
const MAX_FLING = 4200;
/** 超出邊界時位移打的折。0.35 的意思是「再怎麼拉也只走三分之一」，手感上就是拉到橡皮筋 */
const RUBBER = 0.35;
/** 回彈時間（秒）。 */
const SNAP_BACK = 0.32;

/*
 * 這裡曾經有一組 `fadeColor` / `fadeWidth`，在兩側畫一道往外淡出的底色當作
 * 「還捲得動」的提示。**拿掉了**（2026-08-17，Eric 回報「像破圖」）：
 *
 * 那道漸層是用八段矩形疊出來的，最內側 alpha 0.95 幾乎是實心。疊在深色卡片上
 * 看不出漸層，只看得到兩條硬邊的黑柱，形狀像個 `[ ]` 框住整條軌。
 * **在近黑的底上用底色做淡出，本來就沒有可以淡的空間。**
 *
 * 「旁邊還有東西」這件事沒有因此失去提示——左右兩顆箭頭本來就照同一個條件出現
 * （見 rail.ts 的 syncArrows），而且它按得下去，比一道漸層說得更清楚。
 * 真要重做的話該用 alpha 遮罩而不是疊色塊，那是另一件事，不是把這段調一調。
 */
export interface ScrollerOptions {
    /**
     * 遮罩往上下放寬幾 px（預設 0，齊邊裁切）。
     *
     * 給滑鼠移上去會**放大或浮起**的內容用。遮罩齊著可視範圍切的話，那些效果會在
     * 邊緣的項目上被切掉一角——看起來像卡片壓在玻璃底下，比不做效果還糟。
     *
     * **只有垂直方向該這樣放寬。** 捲動軸是水平的，所以上下多出來的那一截露出的是
     * 背景，而左右多出來的那一截露出的是**正要被捲出去的那張卡**——一截半個字、
     * 半張圖，每次捲動都在那裡，看起來就是破圖。當初這個瑕疵被兩側的淡出色塊蓋著，
     * 色塊拿掉之後它才現形（見上面那段說明）。
     */
    overflowY?: number;
    /**
     * 遮罩往左右放寬幾 px（預設 0，齊邊裁切）。
     *
     * 幾乎都該維持 0，理由見 `overflowY`。代價是**最邊緣那張**在 hover 放大時
     * 側面會被切掉幾 px——那是偶發且視線不在的地方，比常駐露出半張卡片好。
     */
    overflowX?: number;
}

export class InertiaScroller extends Container {
    /** 要捲的東西放進來。它的 x 由這個元件控制，不要自己改。 */
    public readonly content = new Container();

    private readonly clip = new Graphics();
    private readonly overflowX: number;
    private readonly overflowY: number;

    private viewW = 0;
    private viewH = 0;
    private contentLen = 0;

    /** 內容往左位移多少像素。0 = 貼最左 */
    private offset = 0;
    private velocity = 0;

    private dragging = false;
    private dragFrom = 0;
    private dragOffset = 0;
    private moved = false;
    /**
     * 最近幾個移動取樣，用來算放開手指那一刻的速度。
     *
     * 只用「最後一次 move 的位移÷時間」是不夠的：那一筆常常是 0（手指停住才放開），
     * 於是慣性完全不會發生。取一個小窗口內的平均才符合「甩出去」的直覺。
     */
    private samples: Array<{ x: number; t: number }> = [];

    private snap: gsap.core.Tween | null = null;

    constructor(opts: ScrollerOptions = {}) {
        super();
        this.overflowX = opts.overflowX ?? 0;
        this.overflowY = opts.overflowY ?? 0;

        this.addChild(this.content);
        this.addChild(this.clip);
        // 遮罩要留在顯示樹裡（見 ScrollableRoad 的同一段註解）——設 renderable = false
        // 等於交出一張空遮罩，被遮的東西會整片消失
        this.content.mask = this.clip;

        this.eventMode = 'static';
        this.on('pointerdown', this.onDown, this);
        this.on('globalpointermove', this.onMove, this);
        this.on('pointerup', this.onUp, this);
        this.on('pointerupoutside', this.onUp, this);
        this.on('wheel', this.onWheel, this);
    }

    /** 可視範圍。命中區與 bounds 一起釘死——遮罩擋得住繪製，擋不住 `getBounds()`。 */
    public setViewport(width: number, height: number): void {
        this.viewW = width;
        this.viewH = height;

        this.clip.clear();
        const ox = this.overflowX;
        const oy = this.overflowY;
        this.clip.rect(-ox, -oy, width + ox * 2, height + oy * 2).fill(0xffffff);
        // 命中區與 bounds **不跟著放寬**：放寬的只是「畫得出來的範圍」，
        // 這個元件對外宣稱佔多大、以及哪裡按得到，仍然是原本那塊可視範圍
        this.hitArea = new Rectangle(0, 0, width, height);
        this.boundsArea = new Rectangle(0, 0, width, height);

        this.clamp();
        this.apply();
    }

    /** 內容實際有多長（px）。比視窗短就捲不動。 */
    public setContentLength(len: number): void {
        this.contentLen = len;
        this.clamp();
        this.apply();
    }

    public get maxOffset(): number {
        return Math.max(0, this.contentLen - this.viewW);
    }

    public get scrollable(): boolean {
        return this.maxOffset > 1;
    }

    /** 目前捲到哪（px）。名字不叫 position 是因為 Container 已經有那個屬性。 */
    public get offsetX(): number {
        return this.offset;
    }

    /**
     * 捲到指定位置。`animate` 給 true 會用緩動過去——箭頭翻頁用的就是這條。
     */
    public scrollTo(target: number, animate = false): void {
        const to = Math.min(this.maxOffset, Math.max(0, target));
        this.velocity = 0;
        this.killSnap();
        if (!animate) {
            this.offset = to;
            this.apply();
            return;
        }
        // tween 的是一個代理物件而不是 this.offset：gsap 沒辦法直接補間 getter/setter 以外的
        // 私有欄位，而每幀都要跟著更新 content.x 與淡出
        const proxy = { v: this.offset };
        this.snap = gsap.to(proxy, {
            v: to,
            duration: SNAP_BACK,
            ease: 'power3.out',
            onUpdate: () => {
                this.offset = proxy.v;
                this.apply();
            },
            onComplete: () => {
                this.snap = null;
            },
        });
    }

    /** 往前／後翻一頁（一個可視寬度扣掉一點重疊，讓人知道自己沒跳過東西）。 */
    public pageBy(dir: 1 | -1): void {
        this.scrollTo(this.offset + dir * this.viewW * 0.86, true);
    }

    /**
     * 每幀推進慣性。由呼叫端在 `ctx.frame()` 裡餵 delta（秒）。
     *
     * 拖曳中不做事——手指按著的時候位置由手指決定，慣性是放開之後才存在的東西。
     */
    public update(dt: number): void {
        if (this.dragging || this.velocity === 0 || this.snap) return;

        this.offset -= this.velocity * dt;

        // 線性減速而不是指數衰減：指數衰減永遠停不下來（速度趨近 0 但不等於 0），
        // 得另外設一個「夠慢就當作停了」的門檻；線性減速自己會歸零，
        // 而且「甩多快滑多遠」是可預期的正比關係，手感比較好調
        const drop = FRICTION * dt;
        if (Math.abs(this.velocity) <= drop) this.velocity = 0;
        else this.velocity -= Math.sign(this.velocity) * drop;

        // 慣性期間撞到邊界就直接停下來回彈，不做彈跳往復——那個手感在遊戲大廳偏吵
        if (this.offset < 0 || this.offset > this.maxOffset) {
            this.velocity = 0;
            this.scrollTo(this.offset < 0 ? 0 : this.maxOffset, true);
            return;
        }
        this.apply();
    }

    /**
     * 剛才那一下是拖曳而不是點擊嗎。
     *
     * 這個旗標在 `pointerup` 之後仍然成立、到下一次 `pointerdown` 才清掉，
     * 因為卡片的 `pointertap` 是在 up 之後才發的——在 up 就清掉的話這個問句永遠是 false。
     */
    public get didDrag(): boolean {
        return this.moved;
    }

    /** 卸載前收掉緩動。gsap 的 tween 不在場景樹上，不會隨 destroy 一起走。 */
    public stop(): void {
        this.killSnap();
        this.velocity = 0;
    }

    private killSnap(): void {
        this.snap?.kill();
        this.snap = null;
    }

    private clamp(): void {
        this.offset = Math.min(this.maxOffset, Math.max(0, this.offset));
    }

    private apply(): void {
        this.content.x = -this.offset;
        this.cursor = this.scrollable ? (this.dragging ? 'grabbing' : 'grab') : 'default';
    }

    private onDown(e: FederatedPointerEvent): void {
        this.killSnap();
        this.velocity = 0;
        this.dragging = true;
        this.moved = false;
        this.dragFrom = e.global.x;
        this.dragOffset = this.offset;
        this.samples = [{ x: e.global.x, t: performance.now() }];
        this.apply();
    }

    private onMove(e: FederatedPointerEvent): void {
        if (!this.dragging) return;
        const dx = e.global.x - this.dragFrom;
        if (Math.abs(dx) > DRAG_SLOP) this.moved = true;

        // 往左拖 = 想看右邊 = 內容往左移 = offset 變大
        let next = this.dragOffset - dx;
        // 出界的部分打折，手上就會有「拉到底了」的阻力。硬夾住的話拉到底之後
        // 手指還在動、畫面卻定住，感覺像卡住而不是到底
        if (next < 0) next *= RUBBER;
        else if (next > this.maxOffset) next = this.maxOffset + (next - this.maxOffset) * RUBBER;

        this.offset = next;
        this.apply();

        const now = performance.now();
        this.samples.push({ x: e.global.x, t: now });
        // 只留最近 120ms：更早的取樣會把「先快後慢」的甩動平均成中速
        while (this.samples.length > 2 && now - this.samples[0].t > 120) this.samples.shift();
    }

    private onUp(): void {
        if (!this.dragging) return;
        this.dragging = false;

        if (this.offset < 0 || this.offset > this.maxOffset) {
            this.scrollTo(this.offset < 0 ? 0 : this.maxOffset, true);
            return;
        }

        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const dt = last && first ? (last.t - first.t) / 1000 : 0;
        if (dt > 0.008 && this.moved) {
            const v = (last.x - first.x) / dt;
            this.velocity = Math.max(-MAX_FLING, Math.min(MAX_FLING, v));
        }
        this.samples = [];
        this.apply();
    }

    private onWheel(e: FederatedWheelEvent): void {
        if (!this.scrollable) return;
        // 直向滾輪也拿來橫捲：滑軌是橫的，桌機使用者手上多半只有直向滾輪
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        this.killSnap();
        this.velocity = 0;
        this.offset = Math.min(this.maxOffset, Math.max(0, this.offset + delta));
        this.apply();
        e.preventDefault?.();
    }
}
