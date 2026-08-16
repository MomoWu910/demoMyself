import { Container, Graphics, Rectangle, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import { RoadGrid, type RoadGridOptions, type RoadMark } from './RoadGrid';
import { BG } from '../../theme';

/**
 * 一張**可以橫向捲動**的路圖。
 *
 * 為什麼需要它：路圖是往右無限長的，畫面卻只有那麼寬。原本的做法是在資料層把記號
 * 裁到「最後 N 欄」（roadView 的 clampToLast），N 由可用寬度除以格子大小算出來——
 * 於是「一次看得到幾欄」跟「這一靴總共有幾欄」被綁死成同一個數字。
 *
 * 那個綁定在手機橫放時整個爆開：路圖高度被壓到 64px、格子只剩 6.2px，同樣的寬度
 * 就除出**119 欄**，畫出一大片空網格，而真正有內容的只有前面十幾欄。
 *
 * 捲動把這兩件事拆開：格子大小由高度決定，一次看幾欄由寬度決定，**看不到的往旁邊捲**。
 * 桌面尺寸也一起受惠——原本只能看最新的幾十欄，現在整靴都回得去。
 *
 * 預設貼齊最右（最新的一局），這跟真實桌台的行為一致；只有玩家自己捲開之後才會脫離，
 * 捲回底又重新黏上。
 */

/** 捲到底時邊緣提示的寬度。用漸層淡出而不是畫箭頭——箭頭在 12px 的格子旁邊太吵。 */
const FADE_W = 14;

export class ScrollableRoad extends Container {
    private readonly grid: RoadGrid;
    private readonly content = new Container();
    private readonly clip = new Graphics();
    private readonly fade = new Graphics();

    private viewW = 0;
    private viewH = 0;
    private cell = 12;

    /** 內容實際有幾欄。由 marks 的最大欄位推出來，不再由可用寬度決定 */
    private cols = 0;
    /** 內容往左位移多少像素 */
    private offset = 0;
    /**
     * 有沒有黏在最新那一端。
     *
     * 需要這個旗標而不是每次都跳到底：玩家往回捲看前面幾局時，如果這時候開了新的一局
     * 就把他彈回最右邊，等於不能看。黏住只在他本來就在底端時才發生。
     */
    private atEnd = true;

    private dragging = false;
    private dragFrom = 0;
    private dragOffset = 0;
    /** 這次按下有沒有真的移動過。用來分辨「拖曳」與「單純點一下」 */
    private moved = false;

    constructor(opts: RoadGridOptions) {
        super();
        this.grid = new RoadGrid(opts);
        this.content.addChild(this.grid);

        this.addChild(this.content);
        this.addChild(this.clip);
        this.addChild(this.fade);
        // 遮罩要留在顯示樹裡才會跟著父層變換。**不要自己設 renderable = false**——
        // 遮罩得先被畫進 stencil 才擋得住東西，關掉它等於交出一張空遮罩，
        // 結果是整張路圖被遮成全黑（實際踩過，畫面上路單整條不見）。
        // 排除在正常繪製之外這件事由 Pixi 指派 mask 時自己處理
        this.content.mask = this.clip;

        this.eventMode = 'static';
        this.on('pointerdown', this.onDown, this);
        this.on('globalpointermove', this.onMove, this);
        this.on('pointerup', this.onUp, this);
        this.on('pointerupoutside', this.onUp, this);
        this.on('wheel', this.onWheel, this);
    }

    /** 這張圖的可視範圍與格子大小。 */
    public setViewport(cell: number, width: number, height: number): void {
        this.cell = cell;
        this.viewW = width;
        this.viewH = height;

        this.clip.clear();
        this.clip.rect(0, 0, width, height).fill(0xffffff);

        // 命中範圍與 bounds 都**明確給死**，不要讓 Pixi 去推。
        // 推出來的會跟著內容寬度跑（一靴七十欄就是七百多 px），於是這個容器對外宣稱的
        // 大小遠比看得到的那一格寬——命中區會蓋到隔壁那張路，外部拿 bounds 排版或
        // 判斷重疊時也會全部算錯。遮罩擋得住繪製，擋不住 bounds。
        this.hitArea = new Rectangle(0, 0, width, height);
        this.boundsArea = new Rectangle(0, 0, width, height);

        this.grid.setLayout(cell, this.gridCols);
        this.apply();
    }

    public setMarks(marks: RoadMark[]): void {
        // 總欄數由**內容**決定，不再由可用寬度決定——這正是捲動要解開的那個綁定
        this.cols = marks.reduce((max, m) => Math.max(max, m.col + 1), 0);
        this.grid.setLayout(this.cell, this.gridCols);
        this.grid.setMarks(marks);
        this.apply();
    }

    /** 一次看得到幾欄。 */
    public get visibleCols(): number {
        return Math.max(1, Math.floor(this.viewW / this.cell));
    }

    /**
     * 網格要畫幾欄。
     *
     * 取「內容欄數」與「看得到的欄數」的**大值**，因為這兩件事各自要滿足一半：
     * 內容比視窗長時要畫到內容尾端（否則捲過去是一片空白），視窗比內容寬時要畫到視窗邊緣
     * （否則開局只有一局，就只畫得出一欄寬的細長條，看起來像壞掉——實際踩過）。
     *
     * 能不能捲仍然只看**內容**（見 maxOffset），所以畫滿視窗不會讓一張空路圖捲得動。
     */
    private get gridCols(): number {
        return Math.max(this.cols, this.visibleCols);
    }

    private get maxOffset(): number {
        return Math.max(0, this.cols * this.cell - this.viewW);
    }

    private apply(): void {
        if (this.atEnd) this.offset = this.maxOffset;
        else this.offset = Math.min(this.offset, this.maxOffset);
        this.content.x = -this.offset;
        this.drawFade();
    }

    /**
     * 兩側的淡出，表示「這個方向還有東西」。
     *
     * 畫在內容**之上**而不是替內容加透明度：內容是一整個 Graphics，
     * 沒辦法只讓邊緣那幾欄變淡。
     */
    private drawFade(): void {
        this.fade.clear();
        if (this.viewW <= 0 || this.viewH <= 0) return;

        // 顏色跟舞台背景同一色（見 theme.ts 的 BG）。用不透明的窄條加遞減的 alpha
        // 疊出漸層，因為 Pixi 的 FillGradient 對這種一格寬的長條反而更貴
        const steps = 7;
        for (let i = 0; i < steps; i++) {
            const alpha = (1 - i / steps) * 0.9;
            const w = FADE_W / steps;
            if (this.offset > 1) {
                this.fade.rect(i * w, 0, w + 0.5, this.viewH).fill({ color: BG, alpha });
            }
            if (this.offset < this.maxOffset - 1) {
                this.fade.rect(this.viewW - (i + 1) * w - 0.5, 0, w + 0.5, this.viewH).fill({ color: BG, alpha });
            }
        }
    }

    private onDown(e: FederatedPointerEvent): void {
        if (this.maxOffset <= 0) return;
        this.dragging = true;
        this.moved = false;
        this.dragFrom = e.global.x;
        this.dragOffset = this.offset;
        this.cursor = 'grabbing';
    }

    private onMove(e: FederatedPointerEvent): void {
        if (!this.dragging) return;
        const dx = e.global.x - this.dragFrom;
        if (Math.abs(dx) > 3) this.moved = true;
        // 往左拖 = 想看右邊 = 內容往左移 = offset 變大
        this.offset = Math.min(this.maxOffset, Math.max(0, this.dragOffset - dx));
        this.atEnd = this.offset >= this.maxOffset - 1;
        this.content.x = -this.offset;
        this.drawFade();
    }

    private onUp(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.cursor = this.maxOffset > 0 ? 'grab' : 'default';
    }

    private onWheel(e: FederatedWheelEvent): void {
        if (this.maxOffset <= 0) return;
        // 直向滾輪也拿來橫捲：這幾張圖是橫向的，桌機使用者手上多半只有直向滾輪
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta === 0) return;
        this.offset = Math.min(this.maxOffset, Math.max(0, this.offset + delta));
        this.atEnd = this.offset >= this.maxOffset - 1;
        this.content.x = -this.offset;
        this.drawFade();
        // 捲得動就別讓頁面跟著捲
        e.preventDefault?.();
    }

    /** 有沒有正在被拖（呼叫端用來避免把拖曳誤判成點擊）。 */
    public get isDragging(): boolean {
        return this.dragging && this.moved;
    }
}
