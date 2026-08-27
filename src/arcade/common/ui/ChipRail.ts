import gsap from 'gsap';
import { Container, Graphics, Sprite } from 'pixi.js';
import { GOLD, GOLD_BRIGHT } from '../../theme';
import type { ChipAtlas, ChipValue } from '../chips/atlas';
import { InertiaScroller } from '../scroll/InertiaScroller';

/**
 * 桌邊的籌碼架。
 *
 * 這是整次改版最直接的一件事：面額原本是底部面板裡五顆長得像標籤的小按鈕，現在是
 * **真的籌碼**——同一張 atlas 烘出來的貼圖，跟飛到注區上的那些是同一顆。這不只是換皮：
 * 玩家按下去的東西跟飛出去的東西長得一樣，「我押的是這個面額」才不需要對照數字去記。
 *
 * 選中的那顆**往上浮起來**並戴一圈金環。浮起是主要訊號——金環在滿桌金色的介面裡不夠突出，
 * 而位移在餘光裡也看得見。
 *
 * 捲動是必需的而不是加分項：手邊五顆在桌機上一列排得下，但手機直式只放得下三顆半。
 * 沿用大廳滑軌那顆慣性捲動器，順手也拿到了「拖曳中不要誤觸發選取」這件事的答案
 * （見 InertiaScroller 的 didDrag）。
 */

/** 選中那顆往上浮多少（相對於籌碼直徑）。 */
const LIFT_RATIO = 0.16;
/** 籌碼之間留多寬的縫。太窄會讓一排籌碼糊成一條帶子 */
const GAP_RATIO = 0.22;

export interface ChipRailOptions {
    atlas: ChipAtlas;
    onPick: (value: ChipValue) => void;
}

export class ChipRail extends Container {
    private readonly scroller = new InertiaScroller({ overflowY: 14 });
    private readonly onPick: (value: ChipValue) => void;
    private readonly atlas: ChipAtlas;

    private buttons: ChipButton[] = [];
    private values: ChipValue[] = [];
    private selected: ChipValue | null = null;

    private chipPx = 56;
    private viewW = 320;
    private enabled = true;

    constructor(opts: ChipRailOptions) {
        super();
        this.atlas = opts.atlas;
        this.onPick = opts.onPick;
        // 具名是給驗證腳本用的（Pixi 的 `label`）：介面搬進畫布之後，端對端測試沒辦法
        // 再靠 CSS 選擇器找元件，只能在場景樹裡找——而用位置或子節點數量去猜，
        // 版面一改就全錯
        this.label = 'chip-rail';
        this.addChild(this.scroller);
    }

    /**
     * 換一組面額。
     *
     * 整組重建而不是增刪：這只在玩家改籌碼設置時發生（一場遊戲大概零到一次），
     * 而重建讓「按鈕順序＝面額順序」這件事不必另外維護。
     */
    public setChips(values: ChipValue[]): void {
        this.values = [...values];
        for (const b of this.buttons) b.destroy({ children: true });
        this.buttons = [];

        for (const value of this.values) {
            const texture = this.atlas.frames.get(value);
            if (!texture) continue;
            const button = new ChipButton(value, texture, () => {
                // 拖曳結束那一下也會發 tap，問一句捲動器剛剛是不是在拖
                if (this.scroller.didDrag || !this.enabled) return;
                this.onPick(value);
            });
            this.buttons.push(button);
            this.scroller.content.addChild(button);
        }

        this.applySelection();
        this.relayout();
    }

    public setSelected(value: ChipValue | null): void {
        if (this.selected === value) return;
        this.selected = value;
        this.applySelection();
    }

    /**
     * 非下注階段整排變暗且按不動。
     *
     * 不是把它藏起來：籌碼架消失會讓底下那條空一塊，而版面在開牌那幾秒抖一下，
     * 比「暫時按不了」更難受。
     */
    public setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        this.alpha = enabled ? 1 : 0.45;
        for (const b of this.buttons) b.setEnabled(enabled);
    }

    /**
     * 可視範圍。高度決定籌碼多大——**籌碼跟著那條帶子長**，不是反過來由籌碼撐出高度，
     * 因為那條帶子的高度是版面分配好的（見 tableLayout）。
     */
    public setViewport(width: number, height: number): void {
        this.viewW = width;
        // 高度定上限（留出浮起的位移與金環的線寬，不然選中那顆的上緣會被遮罩切掉），
        // **寬度定下限**：一條窄軌上只露出兩顆半的話，捲動就從「還有更多」變成
        // 「看起來壞掉了」——切邊那半顆籌碼比空白更像破圖。至少要看得到三顆半
        this.chipPx = Math.max(28, Math.min(84, height / (1 + LIFT_RATIO + 0.08), width / 3.6));
        this.scroller.setViewport(width, height);
        this.relayout();
    }

    /** 每幀推進慣性。由玩法在 `ctx.frame()` 裡餵（見 InertiaScroller 的說明） */
    public update(dt: number): void {
        this.scroller.update(dt);
    }

    public stop(): void {
        this.scroller.stop();
        for (const b of this.buttons) b.stop();
    }

    /** 整排實際有多寬。呼叫端拿它決定要不要置中 */
    public contentWidth(): number {
        const step = this.chipPx * (1 + GAP_RATIO);
        return this.buttons.length === 0 ? 0 : step * this.buttons.length - this.chipPx * GAP_RATIO;
    }

    private relayout(): void {
        const step = this.chipPx * (1 + GAP_RATIO);
        const total = this.contentWidth();
        // 放得下就置中，放不下就貼左邊從頭捲。置中的短列在寬螢幕上才不會孤零零地靠左
        const startX = total < this.viewW ? (this.viewW - total) / 2 : 0;

        for (let i = 0; i < this.buttons.length; i++) {
            const b = this.buttons[i];
            b.setSize$(this.chipPx);
            b.position.set(startX + i * step + this.chipPx / 2, this.chipPx / 2 + this.chipPx * LIFT_RATIO);
        }
        this.scroller.setContentLength(startX + total);
    }

    private applySelection(): void {
        for (const b of this.buttons) b.setSelected(b.value === this.selected, this.chipPx * LIFT_RATIO);
    }
}

/** 一顆可以按的籌碼。錨點在中心，所以浮起只要動 y */
class ChipButton extends Container {
    private readonly sprite: Sprite;
    private readonly ring = new Graphics();
    private lift: gsap.core.Tween | null = null;
    private size = 56;
    private selected = false;

    constructor(
        public readonly value: ChipValue,
        texture: Sprite['texture'],
        onTap: () => void
    ) {
        super();
        this.addChild(this.ring);

        this.sprite = new Sprite(texture);
        this.sprite.anchor.set(0.5);
        this.addChild(this.sprite);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', onTap);
        // hover 稍微放大：桌機上這是唯一能分辨「這是可以按的」的線索，
        // 因為籌碼本來就長得像一顆裝飾
        this.on('pointerover', () => {
            if (!this.selected) gsap.to(this.scale, { x: 1.07, y: 1.07, duration: 0.14 });
        });
        this.on('pointerout', () => gsap.to(this.scale, { x: 1, y: 1, duration: 0.14 }));
    }

    /** 直接寫 scale，理由見 MoreMenu 的 PickerCell.setSize$——`width` setter 會記住負號 */
    public setSize$(px: number): void {
        this.size = px;
        this.sprite.scale.set(px / this.sprite.texture.orig.width);
        this.drawRing();
    }

    public setSelected(selected: boolean, lift: number): void {
        this.selected = selected;
        this.drawRing();

        // 浮起改動的是 sprite 與 ring 的位移而不是整顆的 y：整顆位移會讓它跑出
        // 捲動器的命中區，選中那顆就變得比別顆難按
        this.lift?.kill();
        this.lift = gsap.to([this.sprite, this.ring], { y: selected ? -lift : 0, duration: 0.18, ease: 'back.out(2)' });
    }

    public setEnabled(enabled: boolean): void {
        this.eventMode = enabled ? 'static' : 'none';
        this.cursor = enabled ? 'pointer' : 'default';
    }

    public stop(): void {
        this.lift?.kill();
        gsap.killTweensOf([this.sprite, this.ring, this.scale]);
    }

    private drawRing(): void {
        const g = this.ring;
        g.clear();
        if (!this.selected) return;
        const r = this.size / 2 + 3;
        g.circle(0, 0, r).stroke({ color: GOLD_BRIGHT, width: 2.5, alpha: 0.95 });
        g.circle(0, 0, r + 3).stroke({ color: GOLD, width: 1, alpha: 0.4 });
    }
}
