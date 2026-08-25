import gsap from 'gsap';
import { Container, Sprite } from 'pixi.js';
import { CARD_H, CARD_W, type CardAtlas, type Suit } from './atlas';

/**
 * 一張牌。負責的只有兩件事：**顯示哪一面、翻面的動作**。
 *
 * 它不知道自己是誰發的、也不知道規則——牌在百家樂、龍虎、二十一點桌上長得一樣，
 * 差別在誰來發、發到哪裡，那是玩法的事。所以這支住在 `common/`。
 *
 * 內部只有一個 Sprite，翻面是換 texture 而不是換物件：換物件會讓上層抓著的參考失效，
 * 而發牌動畫正好是「抓著參考做位移」的典型場景。
 */
export class CardView extends Container {
    private readonly atlas: CardAtlas;
    private readonly sprite: Sprite;

    /** 這張牌的正面是什麼。翻到正面時才會被用上。 */
    private suit: Suit | null = null;
    private rank = 0;

    private up = false;

    /** 目前的縮放基準。翻牌動畫要回到這個值，不能寫死 1。 */
    private base = 1;

    /** 進行中的翻牌動畫。重複呼叫 flip 時要先收掉，否則兩個 tween 會搶同一個 scale.x */
    private tween: gsap.core.Timeline | null = null;

    /**
     * 進行中那個 `flip()` 的 resolve。
     *
     * 存起來的理由：**kill 一個 gsap timeline 不會觸發它的 `onComplete`**，
     * 於是 `await card.flip()` 的呼叫端會永遠停在那一行。百家樂整局演出掛掉
     * （只剩一張沒翻開的牌、沒有結算、路圖不動）就是這樣來的——中斷動畫是合理的，
     * 但**中斷不能等於讓等它的人永遠等下去**。
     *
     * 規則：凡是會 kill 這個 timeline 的地方，都要先經過 `cutFlip()`。
     */
    private finishFlip: (() => void) | null = null;

    /** 進行中那個 `flip()` 翻完之後**應該是哪一面**。中途收掉動畫時要直接跳到它 */
    private flipTarget = false;

    constructor(atlas: CardAtlas, width: number) {
        super();
        this.atlas = atlas;

        this.sprite = new Sprite(atlas.back);
        // 錨點在中心，翻牌才是繞著自己轉而不是繞左上角甩出去
        this.sprite.anchor.set(0.5);
        this.addChild(this.sprite);

        this.resize(width);
    }

    public get faceUp(): boolean {
        return this.up;
    }

    /**
     * 牌面尺寸。高度照 atlas 的比例算，不讓呼叫端自己乘。
     *
     * **改尺寸前要先把翻牌收掉**：翻牌動畫的終點寫的是「回到 `base`」，而那個值是
     * 建立 tween 當下抓的。中途換掉 base 的話，牌翻完會停在舊的寬度——畫面上就是
     * 一張被壓扁或拉長的牌，而且再也不會自己修正。resize 本來就是重排的時刻，
     * 讓牌直接呈現該有的那一面，比留著半個動畫合理。
     */
    public resize(width: number): void {
        this.cutFlip();
        this.base = width / CARD_W;
        this.sprite.scale.set(this.base);
    }

    /** 這張牌畫出來多高。不能叫 height——那是 Pixi Container 自己的可寫屬性 */
    public get cardHeight(): number {
        return CARD_H * this.base;
    }

    /**
     * 設定這張牌的正面內容。**不會翻面**——蓋著的牌也要先知道自己是什麼，
     * 翻的時候才不必再傳一次（傳兩次就有兩個地方可以傳錯）。
     */
    public setFace(suit: Suit, rank: number): void {
        this.suit = suit;
        this.rank = rank;
        if (this.up) this.sprite.texture = this.faceTexture();
    }

    /** 立刻顯示某一面，不做動畫。用在重建畫面（resize、重新進桌）的時候。 */
    public setFaceUp(up: boolean): void {
        this.cutFlip();
        this.up = up;
        this.sprite.texture = up ? this.faceTexture() : this.atlas.back;
        this.sprite.scale.x = this.base;
    }

    /**
     * 翻面。
     *
     * 做法是把 x 方向壓扁到 0、在**最扁的那一瞬間換 texture**、再拉回來。這是 2D 翻牌
     * 最省的寫法：不需要 3D 變換，也不需要兩張牌互相遮擋，而且壓到 0 的那一幀本來就
     * 看不見任何內容，換得再突兀也沒人看得到。
     *
     * 回傳 Promise 讓玩法能 `await` 一串翻牌——百家樂的翻牌是有順序的，
     * 閒家先翻、莊家後翻，用 callback 串會變成巢狀。
     */
    public flip(duration = 0.32): Promise<void> {
        this.cutFlip();

        const target = !this.up;
        this.flipTarget = target;

        return new Promise((resolve) => {
            this.finishFlip = resolve;
            const tl = gsap.timeline({
                onComplete: () => {
                    this.tween = null;
                    this.finishFlip = null;
                    resolve();
                },
            });

            tl.to(this.sprite.scale, {
                x: 0,
                duration: duration / 2,
                ease: 'power2.in',
                onComplete: () => {
                    this.up = target;
                    this.sprite.texture = this.up ? this.faceTexture() : this.atlas.back;
                },
            }).to(this.sprite.scale, {
                x: this.base,
                duration: duration / 2,
                ease: 'power2.out',
            });

            this.tween = tl;
        });
    }

    /** 收掉進行中的動畫。玩法卸載時呼叫，避免 tween 對著已經 destroy 的物件動手。 */
    public stop(): void {
        this.cutFlip();
    }

    /**
     * 收掉翻牌動畫，**跳到它該有的終點**，然後讓等它的人繼續往下走。
     *
     * 三件事缺一不可：
     * - `kill`：不收的話它會繼續對著 `scale.x` 動手，跟後面的動畫打架
     * - **補上終點狀態**：純 kill 會讓牌停在翻到一半的樣子（壓扁的、或者根本還沒翻面），
     *   而呼叫端已經當它翻好了往下走，那張牌就再也沒有人會去翻它
     * - `resolve`：kill 不觸發 `onComplete`，不補這一下，`await flip()` 會永遠等下去
     */
    private cutFlip(): void {
        const tl = this.tween;
        this.tween = null;
        const done = this.finishFlip;
        this.finishFlip = null;

        if (tl) {
            tl.kill();
            this.up = this.flipTarget;
            this.sprite.texture = this.up ? this.faceTexture() : this.atlas.back;
            this.sprite.scale.x = this.base;
        }
        done?.();
    }

    private faceTexture() {
        if (!this.suit) return this.atlas.back;
        return this.atlas.frames.get(this.suit)?.[this.rank] ?? this.atlas.back;
    }
}
