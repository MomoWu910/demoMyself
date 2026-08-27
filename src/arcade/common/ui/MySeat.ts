import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { GOLD_BRIGHT, GOLD_DEEP, GOOD, HOT, MUTED, TEXT } from '../../theme';

/**
 * 我自己的位置。
 *
 * 改版前這張桌子上**沒有我**——註解裡寫的是「我是路過的玩家，沒有座位」，籌碼從底部
 * 面板那一側飛上來。那在面板還貼著畫面底的時候說得通：面板就是我，籌碼從我這邊出去。
 * 面板拿掉之後這件事就斷了，籌碼會從畫面下緣憑空冒出來。
 *
 * 所以補一張自己的椅子，擺在左偏下——**跟其他玩家同一種畫法，但戴一圈金環**。同一種
 * 畫法是重點：桌上六個人跟我用的是同一套視覺語言，我才會覺得自己也在這張桌上，
 * 而不是在操作一台機器。
 */

/** 頭像圓佔整格寬度的比例。跟 SeatView 的 AVATAR_RATIO 是同一個判準 */
const AVATAR_RATIO = 0.56;

export class MySeat extends Container {
    private readonly ring = new Graphics();
    private readonly initial: Text;
    private readonly nameText: Text;
    private readonly balanceText: Text;
    private readonly delta: Text;

    private w = 116;
    private h = 76;
    private compact = false;
    /** 頭像底色。不能叫 `tint`——那是 Pixi Container 自己的欄位，會撞型別 */
    private avatarTint = 0xc9a227;
    private deltaTween: gsap.core.Tween | null = null;

    constructor() {
        super();
        this.addChild(this.ring);

        this.initial = label('', 16, TEXT, '700', 0.5, 0.5);
        this.nameText = label('', 10, MUTED, '500', 0, 0.5);
        this.balanceText = label('', 13, GOLD_BRIGHT, '700', 0, 0.5);
        this.delta = label('', 13, GOOD, '700', 0.5, 1);
        this.delta.alpha = 0;

        this.addChild(this.initial, this.nameText, this.balanceText, this.delta);
    }

    /**
     * 名字與頭像色。`tint` 收的是 CSS 色碼字串——那是外殼 store 存的格式
     * （見 store.ts 的 loadPlayer），在這裡轉一次比讓每個呼叫端各轉一次好。
     */
    public setPlayer(name: string, tint: string): void {
        this.avatarTint = cssToHex(tint, this.avatarTint);
        this.initial.text = name.slice(0, 1).toUpperCase();
        this.nameText.text = name.replace(/\d+$/, '');
        this.redraw();
    }

    /** 餘額。唯一的寫入來源仍然是 server 封包，這裡只是把它畫出來 */
    public setBalance(n: number): void {
        this.balanceText.text = n.toLocaleString();
        this.redraw();
    }

    public setBoxSize(w: number, h: number, compact: boolean): void {
        this.w = w;
        this.h = h;
        this.compact = compact;
        this.redraw();
    }

    /**
     * 籌碼從這裡飛出去（相對於父層）。
     *
     * 取頭像圓心而不是整格中心：名字與餘額在右邊，用整格中心的話籌碼會從字裡飛出來。
     */
    public originPoint(): { x: number; y: number } {
        const r = this.avatarR();
        return { x: this.x + r + 2, y: this.y + this.h / 2 };
    }

    /** 結算後飄一個輸贏數字。跟其他座位同一套演法（見 SeatView.flashDelta） */
    public flashDelta(amount: number): void {
        if (amount === 0) return;
        this.deltaTween?.kill();
        this.delta.text = amount > 0 ? `+${amount.toLocaleString()}` : amount.toLocaleString();
        this.delta.style.fill = amount > 0 ? GOOD : HOT;
        this.delta.alpha = 1;
        this.delta.position.set(this.avatarR() + 2, this.h / 2 - this.avatarR() - 2);

        this.deltaTween = gsap.to(this.delta, {
            y: this.h / 2 - this.avatarR() - 20,
            alpha: 0,
            duration: 1.1,
            ease: 'power1.out',
        });
    }

    public stop(): void {
        this.deltaTween?.kill();
        this.deltaTween = null;
        gsap.killTweensOf(this.delta);
    }

    private avatarR(): number {
        return Math.min(this.h * 0.42, (this.w * AVATAR_RATIO) / 2);
    }

    private redraw(): void {
        const r = this.avatarR();
        const cx = r + 2;
        const cy = this.h / 2;

        const g = this.ring;
        g.clear();
        g.circle(cx, cy, r).fill({ color: this.avatarTint, alpha: 0.92 });
        // 兩圈金環：這是**唯一一個把我跟其他六個人分開**的訊號，一圈在深色背景上不夠明顯
        g.circle(cx, cy, r).stroke({ color: GOLD_BRIGHT, width: 2, alpha: 0.95 });
        g.circle(cx, cy, r + 3.5).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.55 });

        this.initial.style.fontSize = Math.max(11, r * 0.86);
        this.initial.position.set(cx, cy);

        // 窄畫面砍掉名字只留餘額——**餘額是這一格唯一會變的數字**，名字我自己知道
        const textX = cx + r + 8;
        this.nameText.visible = !this.compact;
        this.nameText.style.fontSize = 10;
        this.balanceText.style.fontSize = this.compact ? 12 : 13;

        if (this.compact) {
            this.balanceText.position.set(textX, cy);
        } else {
            this.nameText.position.set(textX, cy - 9);
            this.balanceText.position.set(textX, cy + 8);
        }
    }
}

/** `#rrggbb` → `0xrrggbb`。解析不出來就沿用上一個顏色，不要讓一格頭像變黑洞 */
function cssToHex(css: string, fallback: number): number {
    const match = /^#?([0-9a-f]{6})$/i.exec(css.trim());
    return match ? Number.parseInt(match[1], 16) : fallback;
}

function label(content: string, size: number, fill: number, weight: '500' | '700', ax: number, ay: number): Text {
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
