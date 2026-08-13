import gsap from 'gsap';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ROWS } from '../../net/protocol';
import { Sym, SYMBOLS, WEIGHTS } from './rules';

/**
 * 一根轉軸。
 *
 * **這裡是整個 demo 最能看出「博弈前端跟一般動畫不一樣」的地方。**
 *
 * 直覺的寫法是「轉一轉、隨機停、看停到什麼算什麼」。真的機台不能這樣做——結果是伺服器
 * 算好的（見 net/protocol.ts），前端拿到的是**已經確定的三個符號**，任務是把轉動演到
 * 那裡剛好停住。所以轉軸的介面不是 `stop()` 而是 `stopAt(symbols)`。
 *
 * 於是產生一個真實專案裡必然要處理的問題：轉動中的帶子上是隨機內容，怎麼讓它「剛好」
 * 停在指定的三格？答案是**在停止前改寫帶子**——把即將滑進可視窗的那幾格直接寫成目標值。
 * 玩家看不出來，因為那幾格此刻還在窗外。這是老虎機的通行做法，不是取巧。
 *
 * 另外兩件事值得看：
 *   - 帶子有幾十格，但**只用 ROWS+2 個 sprite**循環復用（改 texture 與 y），
 *     不是每格一個 sprite。轉軸再長，場景樹上的物件數都是固定的。
 *   - 停止用 back.out 的回彈：過頭一點再彈回來。少了這一下，停止會像被按了暫停鍵，
 *     手感整個垮掉——這是老虎機「重量感」的主要來源。
 */

/** 帶子長度。夠長才不會在等速轉動時看出重複的規律。 */
const STRIP_LEN = 32;

/** 可視窗外多留幾個 sprite，捲動時上下邊界才不會出現「憑空冒出來」的一格。 */
const POOL = ROWS + 2;

/** 等速轉動的速度（格／秒）。 */
const SPIN_SPEED = 26;

/** 加速到等速要多久（秒）。 */
const SPIN_UP = 0.28;

/** 停止時最少還要再轉幾格，避免「按下去馬上停」那種廉價感。 */
const MIN_SETTLE_CELLS = 8;

/** 停止緩動時長（秒）。 */
const SETTLE_TIME = 0.62;

export interface ReelOptions {
    frames: Map<Sym, Texture>;
    /** 一格的寬高（像素） */
    cellW: number;
    cellH: number;
}

export class Reel extends Container {
    private frames: Map<Sym, Texture>;
    private cellW: number;
    private cellH: number;

    /** 帶子內容。停止前會被改寫（見 class 說明）。 */
    private strip: Sym[] = [];

    /** 捲動位置，單位是「格」，連續值。整數部分是帶子索引，小數部分是格內偏移。 */
    private offset = 0;

    private sprites: Sprite[] = [];
    private windowMask: Graphics;
    private spinTween: gsap.core.Tween | null = null;
    private settleTween: gsap.core.Tween | null = null;
    private highlights: gsap.core.Tween[] = [];

    /** 目前的捲動速度（格／秒）。加速與煞停都是改它，不是直接改 offset。 */
    private speed = 0;

    private spinning = false;

    constructor(opts: ReelOptions) {
        super();
        this.frames = opts.frames;
        this.cellW = opts.cellW;
        this.cellH = opts.cellH;

        for (let i = 0; i < STRIP_LEN; i++) this.strip.push(randomSymbol());

        for (let i = 0; i < POOL; i++) {
            const s = new Sprite();
            s.anchor.set(0.5);
            s.x = this.cellW / 2;
            s.width = this.cellW;
            s.height = this.cellH;
            this.sprites.push(s);
            this.addChild(s);
        }

        // 可視窗以外要裁掉，否則緩衝用的那兩格會露在轉軸上下
        this.windowMask = new Graphics();
        this.addChild(this.windowMask);
        this.mask = this.windowMask;

        this.resize(opts.cellW, opts.cellH);
    }

    /**
     * 換格子尺寸（畫布縮放時）。
     *
     * sprite 的寬高直接寫死而不是用 scale，是因為 atlas 的 frame 尺寸固定（見 symbols.ts 的 CELL），
     * 用 width/height 指定目標大小，Pixi 自己換算縮放比，之後改 atlas 解析度這裡不用跟著改。
     * 遮罩也要一起重畫——它是 Graphics，尺寸不會自己跟著走。
     */
    public resize(cellW: number, cellH: number): void {
        this.cellW = cellW;
        this.cellH = cellH;

        for (const s of this.sprites) {
            s.x = cellW / 2;
            s.width = cellW;
            s.height = cellH;
        }

        this.windowMask.clear().rect(0, 0, cellW, cellH * ROWS).fill(0xffffff);
        this.layout();
    }

    /** 目前的格子尺寸。中獎線要照它算座標，不能用 Container 的 bounds（會被遮罩與空隙影響）。 */
    public getCellSize(): { w: number; h: number } {
        return { w: this.cellW, h: this.cellH };
    }

    /** 目前是否還在轉（含煞停中）。 */
    public isSpinning(): boolean {
        return this.spinning;
    }

    /** 起轉。加速到等速後就一直轉，等 stopAt 給結果。 */
    public spin(): void {
        this.killTweens();
        this.spinning = true;
        this.spinTween = gsap.to(this, { speed: SPIN_SPEED, duration: SPIN_UP, ease: 'power1.in' });
    }

    /**
     * 收到結果，停到指定的三個符號上。回傳一個在完全停住時 resolve 的 Promise。
     *
     * `delay` 讓呼叫端把五根轉軸錯開停——一起停會像畫面卡住，逐根停才有節奏。
     */
    public stopAt(symbols: Sym[], delay = 0): Promise<void> {
        return new Promise((resolve) => {
            this.killTweens();

            /*
             * 目標落點：從現在的位置往前推 MIN_SETTLE_CELLS 格，取下一個整數格。
             * 取整是必要的——停在半格上，可視窗會卡在兩個符號中間。
             */
            const target = Math.ceil(this.offset + MIN_SETTLE_CELLS);

            /*
             * 改寫帶子：讓停下來時可視窗裡的三格正好是伺服器給的結果。
             * 此刻這幾格還在窗外（至少 MIN_SETTLE_CELLS 格遠），改了看不出來。
             */
            for (let row = 0; row < ROWS; row++) {
                this.strip[mod(target + row, STRIP_LEN)] = symbols[row];
            }

            this.speed = 0; // 交給緩動接管，不再靠速度推進
            this.settleTween = gsap.to(this, {
                offset: target,
                duration: SETTLE_TIME,
                delay,
                // back.out 會衝過頭一點再彈回：轉軸「壓下去又彈起來」的重量感全靠這個
                ease: 'back.out(1.6)',
                onUpdate: () => this.layout(),
                onComplete: () => {
                    this.offset = target;
                    this.layout();
                    this.spinning = false;
                    resolve();
                },
            });
        });
    }

    /** 每幀推進。等速段靠它走，煞停段由 gsap 接管（此時 speed 已歸零）。 */
    public update(deltaSec: number): void {
        if (this.speed <= 0) return;
        this.offset += this.speed * deltaSec;
        // offset 會一直長大，久了浮點精度會掉——繞回帶子長度的整數倍，視覺上完全等價
        if (this.offset > STRIP_LEN * 1000) this.offset = mod(this.offset, STRIP_LEN);
        this.layout();
    }

    /**
     * 讓可視窗第 row 格脈動——中獎時用。
     *
     * 由轉軸自己封裝而不是把 sprite 交出去，是因為**這裡的 scale 不是 1**：
     * sprite 的顯示尺寸是用 `width/height` 指定的，Pixi 內部換算成
     * `目標尺寸 ÷ atlas frame 尺寸` 存進 scale。外部若照直覺 tween 到 1，
     * 符號會瞬間縮成 atlas 的原始大小。脈動必須以現值為基準做相對縮放。
     */
    public highlightCell(row: number): void {
        if (this.spinning) return;
        const s = this.sprites[row];
        if (!s) return;

        const base = s.scale.x;
        this.highlights.push(
            gsap.fromTo(
                s.scale,
                { x: base, y: base },
                {
                    x: base * 1.14,
                    y: base * 1.14,
                    duration: 0.32,
                    yoyo: true,
                    repeat: 3,
                    ease: 'sine.inOut',
                    onComplete: () => {
                        s.scale.set(base);
                    },
                }
            )
        );
    }

    /** 收掉高亮並還原尺寸。重跑一次 resize 就會把 scale 算回正確值，不必自己記基準。 */
    public clearHighlights(): void {
        for (const t of this.highlights) t.kill();
        this.highlights = [];
        this.resize(this.cellW, this.cellH);
    }

    /** 把 sprite 池按目前 offset 重新對位。這是唯一改動場景樹的地方。 */
    private layout(): void {
        const first = Math.floor(this.offset);
        const frac = this.offset - first;

        for (let i = 0; i < POOL; i++) {
            const s = this.sprites[i];
            const sym = this.strip[mod(first + i, STRIP_LEN)];
            const tex = this.frames.get(sym);
            if (tex && s.texture !== tex) s.texture = tex;
            s.y = (i - frac + 0.5) * this.cellH;
        }
    }

    private killTweens(): void {
        this.spinTween?.kill();
        this.settleTween?.kill();
        this.spinTween = null;
        this.settleTween = null;
        for (const t of this.highlights) t.kill();
        this.highlights = [];
    }

    /**
     * 轉軸被回收時，**一定要 kill 掉 tween**。
     *
     * gsap 的 tween 活在自己的全域 ticker 上，不會因為目標物件被 destroy 就停下來——
     * 它會繼續對著已經死掉的 Pixi 物件寫值，然後在某一幀丟出看不懂的錯。
     * 玩法切換頻繁的頁面，這是最常見的當機原因之一。
     */
    public override destroy(options?: Parameters<Container['destroy']>[0]): void {
        this.killTweens();
        this.mask = null;
        super.destroy(options);
    }
}

/** 依權重抽一個符號。帶子的初始內容用它填，讓轉動中的畫面密度接近真實盤面。 */
function randomSymbol(): Sym {
    let total = 0;
    for (const s of SYMBOLS) total += WEIGHTS[s];
    let r = Math.random() * total;
    for (const s of SYMBOLS) {
        r -= WEIGHTS[s];
        if (r <= 0) return s;
    }
    return Sym.Cherry;
}

/** 永遠回非負的取餘。JS 的 % 對負數會回負值，帶子索引會直接爆掉。 */
function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}
