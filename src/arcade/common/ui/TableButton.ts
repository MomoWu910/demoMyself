import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, INK, MUTED, TEXT } from '../../theme';

/**
 * 桌面上的一顆按鈕。
 *
 * 這一組元件存在的理由是**桌台的介面整個搬進了 canvas**：原本這些東西是 DOM 的
 * `<button>`，由 CSS 給狀態、由瀏覽器給游標與焦點。搬進 Pixi 之後那些全部要自己畫，
 * 所以與其讓每一處各自 `new Graphics()`，不如先把「一顆按鈕該有幾種狀態」講清楚一次。
 *
 * 四種狀態缺一不可，而且**每一種都要有非顏色的線索**：
 * hover 只換邊框顏色（滑鼠已經在上面了，不需要再喊）、按下去往下位移 1px（那是唯一
 * 一種「手指知道自己按到了」的回饋）、選中換成金底黑字（不是加個框，框在深色背景上
 * 太弱）、停用降透明度並換掉游標（光是變淡會被誤讀成「載入中」）。
 */

export type ButtonVariant = 'solid' | 'ghost';

export interface TableButtonOptions {
    label: string;
    /** 虛線邊框的那種。用在**動作**（重複下注）而不是「選一個」的地方 */
    variant?: ButtonVariant;
    fontSize?: number;
    /**
     * 用圖示取代文字。
     *
     * 只有齒輪一種，給「更多／設置」用——那顆按鈕在桌上是**常駐**的，而常駐的東西
     * 用圖示比用字省位置，也不必跟著語言換寬度（中文「更多」與英文「More」差了快一倍）。
     * 其餘按鈕仍然用字：它們不是通用符號，畫成圖示只會變成猜謎。
     */
    icon?: 'gear';
    onTap: () => void;
}

export class TableButton extends Container {
    private readonly bg = new Graphics();
    private readonly icon: Graphics | null;
    private readonly caption: Text;
    private readonly variant: ButtonVariant;
    private readonly onTap: () => void;

    private w = 96;
    private h = 32;
    private hovered = false;
    private pressed = false;
    private active = false;
    private enabled = true;

    constructor(opts: TableButtonOptions) {
        super();
        this.variant = opts.variant ?? 'solid';
        this.onTap = opts.onTap;

        this.addChild(this.bg);

        this.icon = opts.icon === 'gear' ? new Graphics() : null;
        if (this.icon) this.addChild(this.icon);

        this.caption = new Text({
            text: opts.label,
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: opts.fontSize ?? 12,
                fontWeight: '700',
                fill: MUTED,
            }),
        });
        this.caption.anchor.set(0.5);
        // 圖示版仍然保留那個 Text，只是不顯示：`measure()` 要靠它算寬度，
        // 而按鈕的無障礙名稱（給未來的畫布無障礙層用）也還在
        this.caption.visible = this.icon === null;
        this.addChild(this.caption);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerover', () => this.setHover(true));
        this.on('pointerout', () => {
            this.setHover(false);
            this.setPressed(false);
        });
        this.on('pointerdown', () => this.setPressed(true));
        this.on('pointerupoutside', () => this.setPressed(false));
        this.on('pointerup', () => {
            this.setPressed(false);
            if (this.enabled) this.onTap();
        });

        this.redraw();
    }

    public setBoxSize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        this.redraw();
    }

    public setLabel(label: string): void {
        this.caption.text = label;
        this.redraw();
    }

    /** 這顆是不是「目前選中的那個」。只有 solid 會換成金底 */
    public setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        this.redraw();
    }

    public setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        // eventMode 一起關掉，不然停用的按鈕還是會收到 hover 而換色，
        // 看起來像「可以按但沒反應」
        this.eventMode = enabled ? 'static' : 'none';
        this.cursor = enabled ? 'pointer' : 'default';
        this.alpha = enabled ? 1 : 0.4;
        this.redraw();
    }

    /** 量一下這串字要多寬。呼叫端排版時用，省得自己猜字寬 */
    public measure(padX = 14): number {
        return this.caption.width + padX * 2;
    }

    private setHover(hovered: boolean): void {
        if (this.hovered === hovered || !this.enabled) return;
        this.hovered = hovered;
        this.redraw();
    }

    private setPressed(pressed: boolean): void {
        if (this.pressed === pressed) return;
        this.pressed = pressed;
        // 位移只動內容不動 hit 區：整顆一起位移的話，按住往下 1px 就可能滑出
        // 命中範圍，放開時 pointerup 打不到自己
        this.bg.y = pressed ? 1 : 0;
        this.caption.y = this.h / 2 + (pressed ? 1 : 0);
    }

    private redraw(): void {
        const r = Math.min(10, this.h / 2);
        const g = this.bg;
        g.clear();

        if (this.active) {
            g.roundRect(0, 0, this.w, this.h, r).fill(GOLD);
            this.caption.style.fill = INK;
        } else {
            g.roundRect(0, 0, this.w, this.h, r).fill({ color: INK, alpha: 0.82 });
            g.roundRect(0, 0, this.w, this.h, r).stroke({
                color: this.hovered ? GOLD : GOLD_DEEP,
                width: 1,
                alpha: this.variant === 'ghost' ? 0.55 : 0.8,
            });
            this.caption.style.fill = this.hovered ? GOLD_BRIGHT : TEXT;
        }

        this.caption.position.set(this.w / 2, this.h / 2 + (this.pressed ? 1 : 0));
        if (this.icon) this.drawGear(this.active ? INK : this.hovered ? GOLD_BRIGHT : TEXT);
    }

    /**
     * 齒輪。八個齒 + 中心孔，用兩個同心圓夾出輪廓。
     *
     * 畫出來而不是用貼圖或字型圖示：整頁的視覺元素都是程序化畫的（籌碼、牌、路圖），
     * 多一張圖就多一個要跟著 DPR 縮放的資源。
     */
    private drawGear(color: number): void {
        const g = this.icon;
        if (!g) return;
        const cx = this.w / 2;
        const cy = this.h / 2 + (this.pressed ? 1 : 0);
        const r = Math.min(this.w, this.h) * 0.3;

        g.clear();

        // 八個朝外的齒。四個角自己轉——Pixi v8 的 Graphics 沒有 push/rotate 那組
        // 畫布式的變換 API，繞著圓心轉方塊只能算座標
        const teeth = 8;
        const tw = r * 0.4;
        const th = r * 0.44;
        for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const x = cx + cos * r;
            const y = cy + sin * r;
            const pts: number[] = [];
            for (const [px, py] of [
                [-tw / 2, -th / 2],
                [tw / 2, -th / 2],
                [tw / 2, th / 2],
                [-tw / 2, th / 2],
            ]) {
                pts.push(x + px * cos - py * sin, y + px * sin + py * cos);
            }
            g.poly(pts).fill(color);
        }

        // 輪圈用**描邊**而不是填滿再挖洞：挖洞要嘛用 `cut()`（會把整個 context 變成
        // 一條路徑，跟上面那些齒打架），要嘛拿背景色蓋一個圓——而這顆按鈕的底是
        // 半透明的，蓋上去會出現一塊比周圍深的圓斑
        g.circle(cx, cy, r * 0.66).stroke({ color, width: r * 0.5 });
    }
}
