import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../../../i18n';
import type { Rect } from '../../common/table/tableLayout';
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, IVORY } from '../../theme';
import { computeFelt, feltAnchor, hitTestFelt, OUTSIDE_DROP, type FeltGeometry } from './felt';
import { cellOf, colorOf, numbersOf, numberAt, parseBetKey, type BetKey } from './rules';

/**
 * 桌布：37 個號碼格加兩排外注。
 *
 * 這一塊的難處不在畫，在**回饋**。輪盤桌上「我現在要押的是哪一注」完全由手指的位置決定，
 * 而位置差幾個像素就是不同的注——所以畫面必須在按下去**之前**就告訴玩家答案。
 * 做法是滑過去（或按住）時把那一注蓋住的號碼整批高亮起來：押分注會亮兩格、押角注亮四格、
 * 押第一打亮十二格。**玩家不必知道規則，看亮起來幾格就知道自己在押什麼。**
 *
 * 沒有這個預覽的話，這張桌子對新手是不能玩的：他會以為自己押了 17，實際上押在
 * 17 和 20 的中間那條線上，然後開出 17 卻只賠一半，看起來就像程式壞了。
 */

const RED_FELT = 0xa8323c;
const BLACK_FELT = 0x231f1c;
const GREEN_FELT = 0x2f6b46;

/** 外注區塊的底色。比號碼格暗一階，兩排東西才分得開 */
const OUTSIDE_FELT = 0x16211b;

export class FeltView extends Container {
    private readonly cells = new Graphics();
    private readonly overlay = new Graphics();
    private readonly labels: Text[] = [];
    /** 號碼格的文字，索引 0~36 直接對號碼。高亮時要改顏色，所以得存起來 */
    private readonly numberLabels = new Map<number, Text>();

    private geo: FeltGeometry;
    private rect: Rect = { x: 0, y: 0, w: 100, h: 40 };

    /** 滑鼠正懸在哪一注上（或手指按著哪一注） */
    private hovered: BetKey | null = null;
    /** 中獎號碼。結算時標出來 */
    private winning: number | null = null;

    /** 玩家點了某一注。座標已經換算成注別，呼叫端不必碰幾何 */
    public onPick: ((key: BetKey) => void) | null = null;

    constructor() {
        super();
        this.geo = computeFelt(this.rect);
        this.addChild(this.cells, this.overlay);
        this.buildLabels();

        // 具名是給驗證腳本用的，同 ChipRail 的理由
        this.label = 'roulette-felt';
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointermove', (e) => this.hover(this.keyAt(e.global.x, e.global.y)));
        this.on('pointerleave', () => this.hover(null));
        this.on('pointerdown', (e) => this.hover(this.keyAt(e.global.x, e.global.y)));
        this.on('pointertap', (e) => {
            const key = this.keyAt(e.global.x, e.global.y);
            if (key) this.onPick?.(key);
        });
    }

    public setRect(rect: Rect): void {
        this.rect = rect;
        this.geo = computeFelt(rect);
        this.hitArea = { contains: (x, y) => this.inside(x, y) };
        this.redraw();
    }

    public geometry(): FeltGeometry {
        return this.geo;
    }

    /** 某一注的籌碼該疊在哪。飛幣與重排都問這一支 */
    public anchor(key: BetKey): { x: number; y: number } | null {
        return feltAnchor(this.geo, key);
    }

    /** 標出中獎號碼（結算時）。傳 null 清掉 */
    public mark(n: number | null): void {
        this.winning = n;
        this.drawOverlay();
    }

    public refreshLabels(): void {
        this.applyLabelText();
        this.redraw();
    }

    private hover(key: BetKey | null): void {
        if (this.hovered === key) return;
        this.hovered = key;
        this.drawOverlay();
    }

    private keyAt(globalX: number, globalY: number): BetKey | null {
        const local = this.toLocal({ x: globalX, y: globalY });
        return hitTestFelt(this.geo, local.x, local.y);
    }

    private inside(x: number, y: number): boolean {
        const { rect } = this.geo;
        // 命中區要**比桌布本身高一截**：街注與線注押在號碼區下緣線上，籌碼有一半在格子外，
        // 而外注那兩排就在下面——只用桌布的框，那條線上的注會有一半按不到
        return x >= rect.x - 4 && x <= rect.x + rect.w + 4 && y >= rect.y - 4 && y <= rect.y + rect.h + 4;
    }

    private buildLabels(): void {
        for (let n = 0; n <= 36; n++) {
            const label = text(String(n), IVORY, '700');
            this.numberLabels.set(n, label);
            this.labels.push(label);
            this.addChild(label);
        }
        for (let i = 0; i < 3; i++) {
            const label = text('2:1', GOLD, '700');
            this.labels.push(label);
            this.addChild(label);
        }
        for (let i = 0; i < 3; i++) {
            const label = text('', GOLD_BRIGHT, '700');
            this.labels.push(label);
            this.addChild(label);
        }
        for (let i = 0; i < 6; i++) {
            const label = text('', GOLD_BRIGHT, '700');
            this.labels.push(label);
            this.addChild(label);
        }
        this.applyLabelText();
    }

    /**
     * 外注的字。
     *
     * 紅與黑那兩格**不寫字，畫菱形**——真桌就是這樣，而且那是這張桌上唯一不需要翻譯的
     * 兩個注。單雙大小則反過來，各語言的說法差很多，得走字典。
     */
    private applyLabelText(): void {
        const dozen = [t('arcade.rou.dozen1'), t('arcade.rou.dozen2'), t('arcade.rou.dozen3')];
        for (let i = 0; i < 3; i++) this.labels[37 + 3 + i].text = dozen[i];

        const evens = ['1-18', t('arcade.rou.even'), '', '', t('arcade.rou.odd'), '19-36'];
        for (let i = 0; i < 6; i++) this.labels[43 + i].text = evens[i];
    }

    private redraw(): void {
        const g = this.geo;
        const { cellW, cellH } = g.grid;

        this.cells.clear();

        // 0：綠色，左端跨三列
        panel(this.cells, g.zero, GREEN_FELT);
        place(this.numberLabels.get(0)!, g.zero, Math.min(cellW, cellH) * 0.5);

        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 12; c++) {
                const n = numberAt(r, c);
                const cell: Rect = { x: g.grid.x + c * cellW, y: g.grid.y + r * cellH, w: cellW, h: cellH };
                panel(this.cells, cell, colorOf(n) === 'red' ? RED_FELT : BLACK_FELT);
                place(this.numberLabels.get(n)!, cell, Math.min(cellW, cellH) * 0.5);
            }
        }

        for (let i = 0; i < 3; i++) {
            panel(this.cells, g.columns[i], OUTSIDE_FELT);
            place(this.labels[37 + i], g.columns[i], Math.min(g.columns[i].w, cellH) * 0.42, LABEL_V);
        }
        for (let i = 0; i < 3; i++) {
            panel(this.cells, g.dozens[i], OUTSIDE_FELT);
            place(this.labels[40 + i], g.dozens[i], g.dozens[i].h * 0.36, LABEL_V);
        }
        for (let i = 0; i < 6; i++) {
            const { key, rect } = g.evens[i];
            panel(this.cells, rect, OUTSIDE_FELT);
            place(this.labels[43 + i], rect, rect.h * 0.36, LABEL_V);

            // 紅黑那兩格畫菱形而不是寫字
            if (key === 'red' || key === 'black') {
                const cx = rect.x + rect.w / 2;
                const cy = rect.y + rect.h * LABEL_V;
                const s = Math.min(rect.w, rect.h) * 0.3;
                this.cells.moveTo(cx, cy - s);
                this.cells.lineTo(cx + s * 0.72, cy);
                this.cells.lineTo(cx, cy + s);
                this.cells.lineTo(cx - s * 0.72, cy);
                this.cells.fill({ color: key === 'red' ? RED_FELT : BLACK_FELT });
                this.cells.stroke({ color: GOLD_DEEP, width: 1, alpha: 0.7 });
            }
        }

        this.drawOverlay();
    }

    /**
     * 高亮層：懸停預覽與中獎標示。
     *
     * 兩者共用一個 Graphics 而不是各畫一層，是因為它們**永遠不會同時出現**——
     * 中獎標示只在結算階段，那時桌布不能點。分兩層的話只是多一個要維護的東西。
     */
    private drawOverlay(): void {
        this.overlay.clear();

        if (this.winning !== null) {
            const rect = this.cellRect(this.winning);
            if (rect) {
                panelStroke(this.overlay, rect, GOLD_BRIGHT, 3, 0.9);
                this.overlay.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: GOLD_BRIGHT, alpha: 0.24 });
            }
            return;
        }

        if (!this.hovered) return;

        const bet = parseBetKey(this.hovered);
        if (!bet) return;

        // 蓋住的每一格都亮起來——**亮幾格就是賠率的另一種說法**
        for (const n of numbersOf(bet)) {
            const rect = this.cellRect(n);
            if (rect) this.overlay.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: GOLD_BRIGHT, alpha: 0.2 });
        }

        // 籌碼會落在哪裡也先畫出來：分注與角注的位置不在格子中央，光看高亮猜不到
        const at = feltAnchor(this.geo, this.hovered);
        if (at) {
            const r = Math.min(this.geo.grid.cellW, this.geo.grid.cellH) * 0.3;
            this.overlay.circle(at.x, at.y, r).stroke({ color: GOLD_BRIGHT, width: 2, alpha: 0.95 });
        }
    }

    /** 某個號碼那一格的框。格位換算走規則層那一支，這裡不再自己算一次 */
    private cellRect(n: number): Rect | null {
        const g = this.geo;
        if (n === 0) return g.zero;
        const cell = cellOf(n);
        if (!cell) return null;
        return { x: g.grid.x + cell.c * g.grid.cellW, y: g.grid.y + cell.r * g.grid.cellH, w: g.grid.cellW, h: g.grid.cellH };
    }
}

/**
 * 一格桌布。
 *
 * 描邊的 alpha 從 0.55 提到 0.8，黑格的底色也提亮了一階：**黑格原本跟畫面底色
 * 幾乎同一個顏色**，在手機上看過去像是那幾格沒畫出來。桌布上的每一格都是一個
 * 可以按的東西，看不見邊界就等於不知道自己按在哪。
 */
function panel(g: Graphics, rect: Rect, color: number): void {
    g.rect(rect.x, rect.y, rect.w, rect.h).fill({ color });
    g.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.8 });
}

function panelStroke(g: Graphics, rect: Rect, color: number, width: number, alpha: number): void {
    g.rect(rect.x, rect.y, rect.w, rect.h).stroke({ color, width, alpha });
}

function place(label: Text, rect: Rect, fontSize: number, v = 0.5): void {
    label.position.set(rect.x + rect.w / 2, rect.y + rect.h * v);
    label.style.fontSize = Math.max(6, fontSize);
}

/** 外注的字往上讓，讓籌碼疊在下半（見 felt.ts 的 OUTSIDE_DROP） */
const LABEL_V = (1 - OUTSIDE_DROP) * 0.92;

function text(content: string, fill: number, weight: '500' | '700'): Text {
    const node = new Text({
        text: content,
        style: new TextStyle({ fontFamily: 'Archivo, ui-sans-serif, sans-serif', fontSize: 12, fontWeight: weight, fill }),
    });
    node.anchor.set(0.5);
    return node;
}
