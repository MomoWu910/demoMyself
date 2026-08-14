import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { ChipStack } from './ChipStack';
import type { ChipAtlas } from './atlas';

/**
 * 一個可以下注的區域：一塊圓角底、標題、賠率、以及押上去的那疊籌碼。
 *
 * 放在 `common/` 是因為「下注區」是桌台遊戲的共同零件——百家樂、骰寶、輪盤的
 * 規則天差地遠，但下注區要做的事永遠是這四件：**看得出範圍、點得到、顯示押了多少、
 * 中了要能亮起來**。差異只在標題與賠率，那是玩法傳進來的字。
 *
 * 它不知道自己是哪一區，也不知道賠付規則——點下去只是回報「我被點了」，
 * 要不要加注、加多少由玩法決定。這樣同一個元件才能同時用在「點一下加籌碼」
 * 與「點一下選中」兩種互動上。
 */
export class BetSpotView extends Container {
    private readonly bg = new Graphics();
    private readonly title: Text;
    private readonly odds: Text;
    private readonly stack: ChipStack;

    private w = 100;
    private h = 60;
    private readonly color: number;

    /** 中獎時的高亮動畫。換下一局前要收掉，否則會跟新的動畫疊在一起 */
    private glow: gsap.core.Tween | null = null;
    private won = false;

    constructor(opts: { label: string; odds: string; color: number; chips: ChipAtlas; onTap: () => void }) {
        super();
        this.color = opts.color;

        this.addChild(this.bg);

        this.title = text(opts.label, 15, 0xffffff, '700');
        this.odds = text(opts.odds, 11, 0xffffff, '500');
        this.odds.alpha = 0.65;
        this.addChild(this.title);
        this.addChild(this.odds);

        this.stack = new ChipStack(opts.chips);
        this.addChild(this.stack);

        // static 就夠了：這個區域不需要滑鼠移動事件，只要點得到。
        // 用 'dynamic' 會讓 Pixi 每幀對它做命中測試，一桌十幾個區加起來不划算
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', opts.onTap);
    }

    public setLabels(label: string, odds: string): void {
        this.title.text = label;
        this.odds.text = odds;
    }

    public setAmount(amount: number): void {
        this.stack.setAmount(amount);
    }

    public setBoxSize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        this.stack.setSize(Math.min(34, h * 0.42));
        this.layout();
    }

    /**
     * 中獎高亮。
     *
     * 用**呼吸式的透明度**而不是換一個亮色底：換底色會讓人一時分不清是中獎還是被選中，
     * 而會動的東西在一桌靜止的區塊裡一眼就找得到。
     */
    public setWin(won: boolean): void {
        if (this.won === won) return;
        this.won = won;
        this.glow?.kill();
        this.glow = null;

        if (!won) {
            this.alpha = 1;
            this.redraw();
            return;
        }

        this.redraw();
        this.glow = gsap.to(this, { alpha: 0.55, duration: 0.42, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    /** 收掉動畫。玩法卸載時呼叫。 */
    public stop(): void {
        this.glow?.kill();
        this.glow = null;
    }

    private layout(): void {
        this.redraw();
        this.title.position.set(this.w / 2, this.h * 0.22);
        this.odds.position.set(this.w / 2, this.h * 0.22 + 15);
        this.stack.position.set(this.w / 2, this.h * 0.72);
    }

    private redraw(): void {
        const g = this.bg;
        g.clear();
        g.roundRect(0, 0, this.w, this.h, 10).fill({ color: this.color, alpha: this.won ? 0.3 : 0.13 });
        g.roundRect(0, 0, this.w, this.h, 10).stroke({
            color: this.color,
            width: this.won ? 2.5 : 1.5,
            alpha: this.won ? 1 : 0.55,
        });
        // 命中範圍跟著底一起換。不設的話 Pixi 會用 bounds，
        // 而 bounds 會被那疊籌碼撐高，變成點在區域外面也算數
        this.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= this.w && y >= 0 && y <= this.h };
    }
}

function text(content: string, size: number, fill: number, weight: '500' | '700'): Text {
    const t = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    t.anchor.set(0.5, 0);
    return t;
}
