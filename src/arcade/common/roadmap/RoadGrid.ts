import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { TIE } from '../../theme';

/**
 * 一張「有限列數的網格 + 在格子上畫記號」的圖。
 *
 * 這支**不知道百家樂**，也不知道什麼是莊閒——它收到的是一串「第幾欄第幾列、畫什麼形狀、
 * 什麼顏色」。路圖之所以能被抽成這樣，是因為四張路的差別全在**內容**（誰去算格子與顏色），
 * 版面規則是同一套：固定列數、由左往右長、格子等寬。
 *
 * 這樣切的好處在龍虎、骰寶這些同樣有路圖的玩法上才會兌現——它們的推算規則不同，
 * 但畫出來的東西是同一張網格。推算住在玩法自己那邊（games/baccarat/roadmap.ts），
 * 繪製留在這裡。
 *
 * 整張圖用**一個 Graphics** 畫完：幾百顆珠子若各自是一個物件，
 * 光是建立與回收就比重畫一次貴，而路圖每局才更新一次。
 */

export type MarkShape = 'circle' | 'filled' | 'slash';

export interface RoadMark {
    col: number;
    row: number;
    shape: MarkShape;
    color: number;
    /** 疊在記號上的斜線數（百家樂用它表示這一顆之後開了幾次和） */
    ties?: number;
    /** 左上角的小點（閒對） */
    cornerTL?: number;
    /** 右下角的小點（莊對） */
    cornerBR?: number;
    /** 格子中央的字（珠盤路用「莊／閒／和」） */
    text?: string;
}

export interface RoadGridOptions {
    /** 幾列。四張路的慣例都是 6 */
    rows: number;
    /** 要不要畫底下的格線 */
    grid?: boolean;
    /** 格線顏色 */
    gridColor?: number;
}

export class RoadGrid extends Container {
    private readonly opts: Required<RoadGridOptions>;
    private readonly gfx = new Graphics();
    private readonly labels = new Container();

    private cell = 18;
    private cols = 0;
    private marks: RoadMark[] = [];

    /**
     * 文字物件的回收池。
     *
     * 珠盤路每局都會多一個字，若每次重畫都 new 一批 Text，一靴打完就製造了幾百個
     * 短命物件——而 Text 在 Pixi 是有 texture 的，回收不及時會讓記憶體階梯式上升。
     * 這正是這一頁在講的資源紀律（見 core/module.ts），在自己的元件裡也要守。
     */
    private pool: Text[] = [];

    constructor(opts: RoadGridOptions) {
        super();
        this.opts = {
            rows: opts.rows,
            grid: opts.grid ?? true,
            gridColor: opts.gridColor ?? 0xffffff,
        };
        this.addChild(this.gfx);
        this.addChild(this.labels);
    }

    /** 目前這張圖畫出來有多大。上層要排版時用得到。 */
    public get size(): { width: number; height: number } {
        return { width: this.cols * this.cell, height: this.opts.rows * this.cell };
    }

    public setLayout(cell: number, cols: number): void {
        this.cell = cell;
        this.cols = cols;
        this.redraw();
    }

    public setMarks(marks: RoadMark[]): void {
        this.marks = marks;
        this.redraw();
    }

    /** 收掉所有子物件。玩法卸載時由 ctx 統一處理，這裡提供給手動重建用。 */
    public clear(): void {
        this.marks = [];
        this.redraw();
    }

    private redraw(): void {
        const { rows, grid, gridColor } = this.opts;
        const cell = this.cell;
        const g = this.gfx;
        g.clear();

        if (grid && this.cols > 0) {
            for (let c = 0; c <= this.cols; c++) {
                g.moveTo(c * cell, 0).lineTo(c * cell, rows * cell);
            }
            for (let r = 0; r <= rows; r++) {
                g.moveTo(0, r * cell).lineTo(this.cols * cell, r * cell);
            }
            g.stroke({ color: gridColor, width: 1, alpha: 0.1 });
        }

        let used = 0;
        const radius = cell * 0.34;

        for (const mark of this.marks) {
            // 超出可見範圍的不畫。路圖是往右長的，看的人只在乎最近這幾十欄
            if (mark.col >= this.cols) continue;

            const cx = mark.col * cell + cell / 2;
            const cy = mark.row * cell + cell / 2;

            switch (mark.shape) {
                case 'circle':
                    g.circle(cx, cy, radius).stroke({ color: mark.color, width: Math.max(1.5, cell * 0.11) });
                    break;
                case 'filled':
                    g.circle(cx, cy, radius).fill(mark.color);
                    break;
                case 'slash': {
                    // 曱甴路用的斜線。由左下往右上，跟和局的斜線方向相反才不會混淆
                    const d = radius * 0.95;
                    g.moveTo(cx - d, cy + d)
                        .lineTo(cx + d, cy - d)
                        .stroke({ color: mark.color, width: Math.max(1.5, cell * 0.11) });
                    break;
                }
            }

            // 和局的斜線疊在記號上，由左上往右下
            if (mark.ties && mark.ties > 0) {
                const d = radius * 1.05;
                g.moveTo(cx - d, cy - d).lineTo(cx + d, cy + d);
                g.stroke({ color: TIE, width: Math.max(1.2, cell * 0.08) });
                // 連開三次以上的和很罕見，畫第二條就夠表示「不只一次」，
                // 再多會把珠子整個蓋掉
                if (mark.ties > 1) {
                    g.moveTo(cx - d, cy + d * 0.2).lineTo(cx + d * 0.2, cy + d);
                    g.stroke({ color: TIE, width: Math.max(1.2, cell * 0.08) });
                }
            }

            if (mark.cornerTL !== undefined) {
                g.circle(cx - radius * 0.85, cy - radius * 0.85, Math.max(1.4, cell * 0.09)).fill(mark.cornerTL);
            }
            if (mark.cornerBR !== undefined) {
                g.circle(cx + radius * 0.85, cy + radius * 0.85, Math.max(1.4, cell * 0.09)).fill(mark.cornerBR);
            }

            if (mark.text) {
                const label = this.take(used++);
                label.text = mark.text;
                label.style.fontSize = Math.max(8, cell * 0.42);
                label.position.set(cx, cy);
                label.visible = true;
            }
        }

        // 這一輪沒用到的文字先收起來，下一輪還在池子裡等著被重用
        for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
    }

    private take(index: number): Text {
        let label = this.pool[index];
        if (!label) {
            label = new Text({
                text: '',
                style: new TextStyle({
                    fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                    fontSize: 10,
                    fontWeight: '700',
                    fill: 0xffffff,
                }),
            });
            label.anchor.set(0.5);
            this.labels.addChild(label);
            this.pool[index] = label;
        }
        return label;
    }
}
