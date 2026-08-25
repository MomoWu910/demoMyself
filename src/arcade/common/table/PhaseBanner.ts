import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, HOT, INK, TEXT } from '../../theme';

/**
 * 桌台的階段指示：現在是哪一段、還剩幾秒。
 *
 * 多人桌把「什麼時候能下注」的主導權從玩家手上拿走了，所以**這塊東西是必需品而不是裝飾**。
 * 單機桌上按鈕本身就是答案（能按就是能玩），多人桌沒有那顆按鈕，玩家唯一能依據的
 * 就是這裡顯示的倒數。它一旦不準或不明顯，整張桌子就變得沒辦法玩。
 *
 * 倒數用**數字加一條會縮的進度條**兩種編碼同時呈現：數字精確但要讀，進度條掃一眼就懂。
 * 最後幾秒轉紅並開始脈動——那是「快封盤了」唯一有效的訊號，光靠數字變小不夠急。
 */

/** 剩幾秒開始變紅並脈動。五秒是還來得及再押一手的長度 */
const URGENT_AT = 5;

export class PhaseBanner extends Container {
    private readonly bg = new Graphics();
    private readonly bar = new Graphics();
    /** 階段名稱。不能叫 `label`——那是 Pixi Container 自己的欄位（字串），會撞型別 */
    private readonly caption: Text;
    private readonly seconds: Text;

    private w = 200;
    private h = 34;

    /** 這一段總共多久（秒）。進度條的分母 */
    private span = 1;
    private left = 0;
    private urgent = false;
    private pulseTween: gsap.core.Tween | null = null;

    constructor() {
        super();
        this.addChild(this.bg);
        this.addChild(this.bar);

        this.caption = text('', 12, TEXT, '700', 0, 0.5);
        this.seconds = text('', 20, GOLD_BRIGHT, '700', 1, 0.5);
        this.addChild(this.caption);
        this.addChild(this.seconds);
    }

    public setBoxSize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        this.redraw();
    }

    /**
     * 換一個階段。
     *
     * `span` 傳 0 代表這一段不倒數（例如換靴），這時只顯示文字——**硬要給它一個倒數
     * 反而更糟**：玩家會以為那個數字歸零時可以做什麼，但其實什麼都不會發生。
     */
    public setPhase(label: string, span: number, countdown: boolean): void {
        this.caption.text = label;
        this.span = Math.max(0.001, span);
        this.seconds.visible = countdown;
        this.setUrgent(false);
        this.redraw();
    }

    /** 每幀更新剩餘秒數。傳的是**浮點秒**，進度條才會連續地縮 */
    public setLeft(secondsLeft: number): void {
        this.left = Math.max(0, secondsLeft);
        this.seconds.text = String(Math.ceil(this.left));
        this.setUrgent(this.seconds.visible && this.left <= URGENT_AT);
        this.drawBar();
    }

    public stop(): void {
        this.pulseTween?.kill();
        this.pulseTween = null;
        gsap.killTweensOf(this.seconds.scale);
    }

    private setUrgent(urgent: boolean): void {
        if (this.urgent === urgent) return;
        this.urgent = urgent;

        this.pulseTween?.kill();
        this.pulseTween = null;
        gsap.killTweensOf(this.seconds.scale);
        this.seconds.scale.set(1);
        this.seconds.style.fill = urgent ? HOT : GOLD_BRIGHT;

        if (urgent) {
            // 縮放脈動而不是閃爍透明度：閃爍在倒數的最後幾秒會讓數字有幾幀讀不到，
            // 而那正是最需要讀得到的時候
            this.pulseTween = gsap.to(this.seconds.scale, {
                x: 1.18,
                y: 1.18,
                duration: 0.5,
                yoyo: true,
                repeat: -1,
                ease: 'sine.inOut',
            });
        }
    }

    private redraw(): void {
        this.bg.clear();
        this.bg.roundRect(0, 0, this.w, this.h, this.h / 2).fill({ color: INK, alpha: 0.9 });
        this.bg.roundRect(0, 0, this.w, this.h, this.h / 2).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.7 });

        this.caption.position.set(14, this.h / 2);
        this.seconds.position.set(this.w - 14, this.h / 2);
        this.drawBar();
    }

    private drawBar(): void {
        const inset = 3;
        const full = this.w - inset * 2;
        const ratio = Math.max(0, Math.min(1, this.left / this.span));

        this.bar.clear();
        if (!this.seconds.visible || ratio <= 0) return;

        // 進度條畫在膠囊**底緣**而不是背後鋪滿：鋪滿的版本會跟文字搶對比，
        // 而這條線只需要被餘光看到
        this.bar
            .roundRect(inset, this.h - inset - 3, full * ratio, 3, 1.5)
            .fill({ color: this.urgent ? HOT : GOLD, alpha: 0.9 });
    }
}

function text(content: string, size: number, fill: number, weight: '500' | '700', ax: number, ay: number): Text {
    const t = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    t.anchor.set(ax, ay);
    return t;
}
