import gsap from 'gsap';
import { Container, FillGradient, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';
import { t } from '../../i18n';
import { BG, GOLD, GOLD_BRIGHT, INK, IVORY, METAL, TEXT, WELL } from '../theme';

/**
 * 大廳左側的活動 banner。
 *
 * **這裡的活動是假的**——版面是照真實大廳的樣子做的（那個位置就是放廣告的），內容
 * 只是視覺，沒有任何真的優惠、也沒有任何東西可以領。所以每張右下角都掛著 DEMO 角標，
 * 頁腳也寫了一行；作品集裡放看起來像真的促銷文案而不標明，是會被誤讀的那種東西。
 *
 * 技術上它示範的是 carousel 最經典的一招：**頭尾各複製一張**。
 * 序列排成 `[末, 0, 1, …, 末, 首]`，指標從 1 出發，於是「從最後一張往右滑回第一張」
 * 走的仍然是往右的一段位移，而不是整條軌道往回倒帶。tween 結束後把指標無聲地換到
 * 對應的真實位置——因為兩者畫的是同一張圖，換的那一幀看不出來。
 */

/** 自動換頁的間隔（秒）。 */
const AUTO_EVERY = 7;
/** 換頁的緩動時間。手滑觸發的要快一點，才跟得上手指放開的節奏 */
const SLIDE_AUTO = 0.5;
const SLIDE_USER = 0.24;
/** 拖過這個比例（相對於 banner 寬度）就翻頁，沒過就彈回原頁 */
const FLIP_RATIO = 0.22;

interface Promo {
    /** i18n 鍵前綴 */
    key: string;
    color: number;
    accent: number;
}

// 三張各拿一階金屬色。**底色是深的、accent 才是亮的**——活動圖最容易走鐘的地方
// 就是整張塗成飽和色，那在黑金裡會像貼上去的廣告貼紙
const PROMOS: Promo[] = [
    { key: 'topup', color: METAL.copper, accent: METAL.gold },
    { key: 'rakeback', color: METAL.steel, accent: METAL.champagne },
    { key: 'newgame', color: METAL.bronze, accent: METAL.sand },
];

export class BannerCarousel extends Container {
    private readonly track = new Container();
    private readonly clip = new Graphics();
    /** 邊框畫在最上層。圓角由 clip 給，所以框線要另外描一次，否則會被裁掉一半 */
    private readonly frame = new Graphics();
    private readonly dots = new Container();
    /** 畫在畫面上的順序：[末, 0…n-1, 首]。index 是這條序列上的位置，不是 PROMOS 的 */
    private readonly slides: PromoSlide[] = [];

    private viewW = 0;
    private viewH = 0;
    private index = 1;

    private tween: gsap.core.Tween | null = null;
    private auto: gsap.core.Tween | null = null;

    private dragging = false;
    private dragFrom = 0;
    private dragBase = 0;
    private moved = false;

    constructor() {
        super();
        this.addChild(this.track, this.clip, this.frame, this.dots);
        // **圓角由這一層統一給**，每張活動圖自己畫的是純矩形。
        //
        // 一度是反過來的（圖自己有圓角、光束在圖裡再套一層遮罩），結果畫面上會出現一塊
        // 從隔壁那張漏過來的色塊：**巢狀遮罩不會疊加**——內層那張遮罩取代了外層的裁切，
        // 於是本來在畫面外的那張圖，它的光束逃出來畫在 banner 右上角。
        // 一層遮罩就沒有這個問題，而且圓角只要維護一處。
        this.track.mask = this.clip;

        const order = [PROMOS[PROMOS.length - 1], ...PROMOS, PROMOS[0]];
        for (const promo of order) {
            const slide = new PromoSlide(promo);
            this.slides.push(slide);
            this.track.addChild(slide);
        }

        for (let i = 0; i < PROMOS.length; i++) {
            const dot = new Graphics();
            dot.eventMode = 'static';
            dot.cursor = 'pointer';
            dot.on('pointertap', () => this.goTo(i + 1, 'user'));
            this.dots.addChild(dot);
        }

        this.eventMode = 'static';
        this.on('pointerdown', this.onDown, this);
        this.on('globalpointermove', this.onMove, this);
        this.on('pointerup', this.onUp, this);
        this.on('pointerupoutside', this.onUp, this);

        this.scheduleAuto();
    }

    public setViewport(width: number, height: number): void {
        this.viewW = width;
        this.viewH = height;

        this.clip.clear();
        this.clip.roundRect(0, 0, width, height, 14).fill(0xffffff);
        this.frame.clear();
        this.frame.roundRect(0.5, 0.5, width - 1, height - 1, 14).stroke({ color: GOLD, width: 1, alpha: 0.24 });
        // 遮罩擋得住繪製，擋不住 bounds 與命中判斷（見 common/scroll/InertiaScroller）
        this.hitArea = new Rectangle(0, 0, width, height);
        this.boundsArea = new Rectangle(0, 0, width, height);

        for (let i = 0; i < this.slides.length; i++) {
            this.slides[i].resize(width, height);
            this.slides[i].position.set(i * width, 0);
        }
        this.track.x = -this.index * width;

        this.layoutDots();
    }

    public refreshText(): void {
        for (const slide of this.slides) slide.refreshText();
    }

    /** 卸載前把緩動與排程都收掉——它們不在場景樹上，不會隨 destroy 一起走。 */
    public stop(): void {
        this.tween?.kill();
        this.tween = null;
        this.auto?.kill();
        this.auto = null;
        for (const slide of this.slides) slide.dispose();
    }

    /** 目前顯示的是第幾張**真的** banner（0 起算）。 */
    private get realIndex(): number {
        if (this.index === 0) return PROMOS.length - 1;
        if (this.index === PROMOS.length + 1) return 0;
        return this.index - 1;
    }

    private scheduleAuto(): void {
        this.auto?.kill();
        // 用 delayedCall 而不是 tween 的 delay：delay 只是延後緩動開始，
        // 中間那段時間什麼事都不會發生（這個坑在停軸時序上踩過，見 games/slot/reel.ts）
        this.auto = gsap.delayedCall(AUTO_EVERY, () => this.goTo(this.index + 1, 'auto'));
    }

    private goTo(next: number, by: 'auto' | 'user'): void {
        if (this.viewW <= 0) return;
        this.tween?.kill();
        this.scheduleAuto();

        this.tween = gsap.to(this.track, {
            x: -next * this.viewW,
            duration: by === 'auto' ? SLIDE_AUTO : SLIDE_USER,
            ease: 'power2.out',
            onComplete: () => {
                this.index = next;
                // 走到複製的那一張了：無聲換到對應的真實位置。兩張畫的是同一個內容，
                // 所以這一幀的跳動看不出來——這正是頭尾複製法的重點
                if (next === 0) this.index = PROMOS.length;
                else if (next === PROMOS.length + 1) this.index = 1;
                this.track.x = -this.index * this.viewW;
                this.tween = null;
                this.layoutDots();
            },
        });
        this.index = next;
        this.layoutDots();
    }

    private layoutDots(): void {
        if (this.viewW <= 0) return;
        const active = this.realIndex;
        const gap = 14;
        const total = (PROMOS.length - 1) * gap;
        for (let i = 0; i < this.dots.children.length; i++) {
            const dot = this.dots.children[i] as Graphics;
            dot.clear();
            const on = i === active;
            // 選中的畫成短橫條而不是大一點的圓：形狀差異在 5px 的尺度下比大小差異好認
            if (on) dot.roundRect(-6, -2.5, 12, 5, 2.5).fill({ color: GOLD, alpha: 0.95 });
            else dot.circle(0, 0, 2.6).fill({ color: IVORY, alpha: 0.3 });
            dot.position.set(this.viewW / 2 - total / 2 + i * gap, this.viewH - 14);
            dot.hitArea = new Rectangle(-9, -9, 18, 18);
        }
    }

    private onDown(e: FederatedPointerEvent): void {
        this.tween?.kill();
        this.tween = null;
        this.auto?.kill();
        this.dragging = true;
        this.moved = false;
        this.dragFrom = e.global.x;
        this.dragBase = this.track.x;
    }

    private onMove(e: FederatedPointerEvent): void {
        if (!this.dragging) return;
        const dx = e.global.x - this.dragFrom;
        if (Math.abs(dx) > 6) this.moved = true;
        this.track.x = this.dragBase + dx;
    }

    private onUp(): void {
        if (!this.dragging) return;
        this.dragging = false;

        const dx = this.track.x - this.dragBase;
        const threshold = this.viewW * FLIP_RATIO;
        // 沒拖夠就回到原頁——這比「一碰就翻」好，手指在 banner 上滑過去不該換頁
        if (dx <= -threshold) this.goTo(this.index + 1, 'user');
        else if (dx >= threshold) this.goTo(this.index - 1, 'user');
        else this.goTo(this.index, 'user');
    }
}

/**
 * 一張活動圖。
 *
 * 整張是畫出來的：漸層底、放射光束、大字、假的 CTA 按鈕。用 Graphics 而不是貼圖，
 * 一來這一頁不載外部素材，二來它得跟著 banner 欄寬重新排版——一張固定尺寸的圖
 * 在窄畫面只能整張縮小，字會先糊掉。
 */
class PromoSlide extends Container {
    private readonly promo: Promo;
    private readonly bg = new Graphics();
    private readonly rays = new Graphics();
    private readonly deco = new Graphics();
    private readonly kicker: Text;
    private readonly headline: Text;
    private readonly sub: Text;
    private readonly cta: Graphics;
    private readonly ctaText: Text;
    private readonly demo: Text;

    private w = 0;
    private h = 0;
    private grad: FillGradient | null = null;

    constructor(promo: Promo) {
        super();
        this.promo = promo;

        this.kicker = text(t(`arcade.promo.${promo.key}.kicker`), 11, TEXT, '800', 0.08);
        this.headline = text(t(`arcade.promo.${promo.key}.headline`), 34, promo.accent, '800');
        this.sub = text(t(`arcade.promo.${promo.key}.sub`), 11, TEXT, '500');
        this.ctaText = text(t('arcade.promo.cta'), 11, BG, '800', 0.04);
        this.demo = text('DEMO', 8, IVORY, '800', 0.14);
        this.demo.alpha = 0.45;
        this.cta = new Graphics();

        this.addChild(this.bg, this.rays, this.deco, this.cta, this.kicker, this.headline, this.sub, this.ctaText, this.demo);
    }

    public refreshText(): void {
        this.kicker.text = t(`arcade.promo.${this.promo.key}.kicker`);
        this.headline.text = t(`arcade.promo.${this.promo.key}.headline`);
        this.sub.text = t(`arcade.promo.${this.promo.key}.sub`);
        this.ctaText.text = t('arcade.promo.cta');
        if (this.w > 0) this.resize(this.w, this.h);
    }

    public dispose(): void {
        this.grad?.destroy();
        this.grad = null;
    }

    public resize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        const { color, accent } = this.promo;

        this.dispose();
        this.grad = new FillGradient({
            type: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 0.6, y: 1 },
            colorStops: [
                { offset: 0, color },
                { offset: 0.5, color: INK },
                { offset: 1, color: BG },
            ],
            textureSpace: 'local',
        });

        // 純矩形——圓角與邊框由 BannerCarousel 那層統一給（見那裡的說明）
        this.bg.clear();
        this.bg.rect(0, 0, w, h).fill({ fill: this.grad });

        // 從上方一點放射出去的光束。真實的活動圖幾乎都有這個東西，它負責「發生大事了」的暗示
        this.rays.clear();
        const ox = w / 2;
        const oy = h * 0.3;
        const reach = Math.hypot(w, h);
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + 0.2;
            const spread = 0.055;
            this.rays
                .moveTo(ox, oy)
                .lineTo(ox + Math.cos(a - spread) * reach, oy + Math.sin(a - spread) * reach)
                .lineTo(ox + Math.cos(a + spread) * reach, oy + Math.sin(a + spread) * reach)
                .fill({ color: accent, alpha: 0.042 });
        }
        /**
         * 橫幅還是直立海報。
         *
         * 同一張活動圖要在兩種形狀裡活下來：桌機是左欄的**直立海報**（300×415），
         * 手機是頂部的**橫幅**（358×168）。直立那套排版硬套到橫幅上，圖與按鈕會直接
         * 疊在一起——高度只剩四成，而文字、裝飾、CTA 三段是照高度分配的。
         * 橫幅改成左文右圖，兩邊各拿一半寬度，就都放得下。
         */
        const wide = w > h * 1.15;

        // 字級同時受寬與高約束。只看寬度的話，橫幅那個形狀（寬得很、只是矮）
        // 會被判定成「空間充足」，然後用桌機的字級把自己撐爆
        const k = Math.min(1, w / 240, h / 300);
        this.kicker.style.fontSize = 11 * k;
        this.headline.style.fontSize = 34 * k;
        this.sub.style.fontSize = 11 * k;
        this.ctaText.style.fontSize = 11 * k;

        const ch = 28 * k + 6;
        const cw = Math.min(w * (wide ? 0.36 : 0.72), 132 * k + 40);
        this.cta.clear();
        this.ctaText.anchor.set(0.5);
        this.demo.anchor.set(1, 1);

        if (wide) {
            const textX = w * 0.07;
            // 四段**實際堆疊**而不是各給一個固定偏移。偏移量寫死的話，字級一縮小
            // （橫幅的 k 只有 0.56）行距跟著縮、按鈕高度卻有 6px 的固定底，
            // 副標就會被 CTA 壓掉半行——實測踩到
            const gap = 5 * k;
            const rows = [this.kicker, this.headline, this.sub];
            const heights = rows.map((r) => r.height);
            const total = heights.reduce((a, b) => a + b, 0) + gap * 3 + ch;
            let y = (h - total) / 2;

            for (let i = 0; i < rows.length; i++) {
                rows[i].anchor.set(0, 0);
                rows[i].position.set(textX, y);
                y += heights[i] + gap;
            }

            this.cta.roundRect(textX, y, cw, ch, ch / 2).fill({ color: accent, alpha: 0.95 });
            this.ctaText.position.set(textX + cw / 2, y + ch / 2);

            this.drawDeco(w * 0.76, h / 2, Math.min(w * 0.16, h * 0.34));
            this.demo.position.set(w - 10, h - 8);
        } else {
            for (const label of [this.kicker, this.headline, this.sub]) label.anchor.set(0.5, 0);
            this.kicker.position.set(w / 2, h * 0.1);
            this.headline.position.set(w / 2, h * 0.1 + 20 * k);
            this.sub.position.set(w / 2, h * 0.1 + 62 * k);

            const cy = h - ch - 34;
            this.cta.roundRect(w / 2 - cw / 2, cy, cw, ch, ch / 2).fill({ color: accent, alpha: 0.95 });
            this.ctaText.position.set(w / 2, cy + ch / 2);

            // 裝飾夾在副標與 CTA 中間那一段，不是「畫面中央」——中央會被 CTA 壓到
            const decoTop = h * 0.1 + 78 * k;
            this.drawDeco(w / 2, (decoTop + cy) / 2, Math.min(w * 0.34, (cy - decoTop) * 0.4));
            this.demo.position.set(w - 10, h - 26);
        }
    }

    /**
     * 每張活動圖的那塊視覺。用最直接的形狀去對應文案講的事：
     * 儲值畫硬幣、返水畫循環的環、新機台畫轉軸。
     *
     * 位置與大小由呼叫端給，不在這裡算——它擺在哪要看是橫幅還是直立海報（見 resize）。
     */
    private drawDeco(cx: number, cy: number, s: number): void {
        const g = this.deco;
        const { accent } = this.promo;
        g.clear();
        // `clear()` 只清掉畫出來的線條，**不動子物件**——有些圖是用子物件畫的
        // （牌要各自旋轉）。不收的話每次 resize 都會再疊一組上去
        for (const child of g.removeChildren()) child.destroy();

        switch (this.promo.key) {
            case 'topup': {
                // 一疊硬幣，最上面那枚往前傾
                for (let i = 0; i < 4; i++) {
                    const y = cy + s * 0.42 - i * s * 0.22;
                    g.ellipse(cx, y, s, s * 0.34).fill({ color: accent, alpha: 0.9 - i * 0.05 });
                    g.ellipse(cx, y, s * 0.66, s * 0.2).fill({ color: GOLD_BRIGHT, alpha: 0.5 });
                }
                break;
            }
            case 'rakeback': {
                // 一圈環，缺一段代表「回流」，配一個箭頭
                g.circle(cx, cy, s * 0.78).stroke({ color: accent, width: s * 0.16, alpha: 0.85 });
                g.circle(cx, cy, s * 0.78).stroke({ color: BG, width: s * 0.18, alpha: 1 });
                g.arc(cx, cy, s * 0.78, -Math.PI * 0.75, Math.PI * 0.45).stroke({ color: accent, width: s * 0.16, alpha: 0.9 });
                g.moveTo(cx + s * 0.5, cy + s * 0.5)
                    .lineTo(cx + s * 0.95, cy + s * 0.62)
                    .lineTo(cx + s * 0.62, cy + s * 0.95)
                    .fill({ color: accent, alpha: 0.9 });
                break;
            }
            default: {
                /*
                 * 兩張斜放的牌。
                 *
                 * 這一格原本畫的是三格轉軸——而這張活動的標題是**百家樂**上線。
                 * 文案講牌桌、圖卻是老虎機，那種對不上一眼就看得出來，而且會讓人懷疑
                 * 整頁其他地方是不是也在亂放。圖跟著文案走，不是跟著「哪個形狀好畫」走。
                 */
                const cw = s * 0.82;
                const ch = s * 1.18;
                for (const [dx, angle] of [
                    [-s * 0.34, -0.2],
                    [s * 0.34, 0.18],
                ] as Array<[number, number]>) {
                    const card = new Graphics();
                    card.roundRect(-cw / 2, -ch / 2, cw, ch, 6).fill({ color: IVORY, alpha: 0.96 });
                    card.roundRect(-cw / 2, -ch / 2, cw, ch, 6).stroke({ color: accent, width: 1.4, alpha: 0.9 });
                    // 牌面上的一點花色暗示。畫實心菱形而不是寫字：這個尺寸下字會糊掉
                    card.moveTo(0, -ch * 0.16)
                        .lineTo(cw * 0.15, 0)
                        .lineTo(0, ch * 0.16)
                        .lineTo(-cw * 0.15, 0)
                        .fill({ color: WELL, alpha: 0.75 });
                    card.position.set(cx + dx, cy);
                    card.rotation = angle;
                    // 牌要各自旋轉，所以是各自的物件（畫進同一個 Graphics 會共用變換）
                    this.deco.addChild(card);
                }
            }
        }
    }
}

function text(content: string, size: number, fill: number, weight: '500' | '800', spacing = 0): Text {
    return new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
            letterSpacing: spacing * size,
        }),
    });
}
