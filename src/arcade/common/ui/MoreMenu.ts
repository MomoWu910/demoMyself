import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, MUTED, WELL } from '../../theme';
import type { ChipAtlas, ChipValue } from '../chips/atlas';
import { CHIP_SLOTS, CHIP_VALUES } from '../chips/atlas';
import { StatStrip, type StatSpec } from './StatStrip';
import { TableButton } from './TableButton';

/**
 * 右上角的「更多」，以及它展開的那一片。
 *
 * 桌台把版面讓給了三件主角——發牌區、注區、路單——剩下的東西得有個去處。判準是
 * **會不會影響下一手怎麼押**：延遲會（所以延遲那一格留在桌上的讀數區），緩衝與倍速
 * 不會（收進來）；線路切換是這一頁最值得按的一顆按鈕，但一場只會按一兩次，也收進來。
 *
 * 展開時整片畫面蓋一層半透明底：**它是模態的**。桌上每一個能按的東西都會改變錢的去向，
 * 選單開著的時候讓底下還能點，遲早會有人隔著半透明的面板押錯注區。
 */

export type MenuSection =
    | { kind: 'stats'; title: string; stats: StatSpec[] }
    | { kind: 'segmented'; title: string; options: Array<{ key: string; label: string }>; value: string; onPick: (key: string) => void }
    | { kind: 'chips'; title: string; hint: string }
    | { kind: 'note'; text: string };

export interface MoreMenuOptions {
    atlas: ChipAtlas;
    /** 籌碼設置那一區改動時通知呼叫端。元件自己不寫 store */
    onChipSetChange: (values: ChipValue[]) => void;
}

/** 面板寬度上限。再寬的話說明文字會拉成一行五十幾個字，讀起來要來回掃 */
const PANEL_MAX_W = 360;
/** 一區跟下一區之間留多少 */
const SECTION_GAP = 18;

export class MoreMenu extends Container {
    /** 收起時只有這顆按鈕看得見 */
    public readonly button: TableButton;

    private readonly scrim = new Graphics();
    private readonly panel = new Container();
    private readonly panelBg = new Graphics();
    private readonly body = new Container();

    private readonly picker: ChipPicker;
    private readonly segButtons: TableButton[] = [];
    private readonly strips: StatStrip[] = [];
    private readonly texts: Text[] = [];

    private sections: MenuSection[] = [];
    private open = false;
    private screen = { w: 0, h: 0 };
    private anchor = { x: 0, y: 0 };
    private uiScale = 1;

    constructor(opts: MoreMenuOptions) {
        super();

        this.label = 'more-menu';
        this.button = new TableButton({ label: 'More', icon: 'gear', onTap: () => this.toggle() });
        this.addChild(this.button);

        this.scrim.eventMode = 'static';
        this.scrim.on('pointertap', () => this.setOpen(false));
        this.scrim.visible = false;
        this.addChild(this.scrim);

        this.panel.visible = false;
        // 面板自己要吃掉點擊，否則點在面板空白處會穿到底下的遮罩，選單自己關掉
        this.panel.eventMode = 'static';
        this.panel.addChild(this.panelBg, this.body);
        this.addChild(this.panel);

        this.picker = new ChipPicker(opts.atlas, opts.onChipSetChange);
        this.body.addChild(this.picker);
    }

    /**
     * 換掉按鈕的無障礙名稱。**看得見的是齒輪，不是這串字**——它只是留著讓場景樹裡
     * 那顆按鈕還認得出是誰（驗證腳本與未來的畫布無障礙層要用）。
     */
    public setLabel(label: string): void {
        this.button.setLabel(label);
    }

    /** 目前手邊那五顆。籌碼設置那一區照它畫勾 */
    public setChipSet(values: ChipValue[]): void {
        this.picker.setChosen(values);
    }

    /**
     * 換一組內容。
     *
     * 每次都整組重建（除了籌碼那一區——它有選取狀態）：這裡的內容跟著語言、串流讀數、
     * 線路一起變，diff 的成本比重建高，而它一秒最多重建一次。
     */
    public setSections(sections: MenuSection[]): void {
        this.sections = sections;
        this.rebuild();
    }

    /** 按鈕釘在右上角。面板從它下面展開，靠右對齊 */
    public place(x: number, y: number, screenW: number, screenH: number, scale: number): void {
        this.uiScale = scale;
        this.screen = { w: screenW, h: screenH };
        this.anchor = { x, y };

        // 圖示版是正方形。跟著 uiScale 走，但有下限——它是這張桌上唯一的入口，
        // 小到按不準比佔位置糟
        const side = Math.max(34, 36 * scale);
        this.button.setBoxSize(side, side);
        this.button.position.set(x - side, y);

        this.scrim.clear();
        this.scrim.rect(0, 0, screenW, screenH).fill({ color: 0x000000, alpha: 0.55 });

        this.layoutPanel();
    }

    public isOpen(): boolean {
        return this.open;
    }

    public setOpen(open: boolean): void {
        if (this.open === open) return;
        this.open = open;
        this.scrim.visible = open;
        this.panel.visible = open;
        this.button.setActive(open);
        if (open) this.layoutPanel();
    }

    public toggle(): void {
        this.setOpen(!this.open);
    }

    private rebuild(): void {
        for (const b of this.segButtons) b.destroy({ children: true });
        this.segButtons.length = 0;
        for (const s of this.strips) s.destroy({ children: true });
        this.strips.length = 0;
        for (const t of this.texts) t.destroy();
        this.texts.length = 0;

        // picker 留著（它有選取狀態），只是先摘下來，等下面重排時再依內容決定要不要掛回去
        if (this.picker.parent) this.body.removeChild(this.picker);

        this.layoutPanel();
    }

    private layoutPanel(): void {
        // `place()` 還沒被呼叫過就先不排：那時候 `screen` 是 0×0，算出來的欄寬是負的，
        // 而負寬度會沿著 `sprite.width` 的 setter 變成永久的翻轉（見 PickerCell.setSize$）
        if (this.screen.w === 0 || this.sections.length === 0) return;

        const k = this.uiScale;
        const w = Math.max(240, Math.min(PANEL_MAX_W * k, this.screen.w - 24));
        const pad = 18 * k;
        const innerW = w - pad * 2;

        // 每次重排都從頭擺：section 的種類與數量都會變，維護一份「上次擺到哪」
        // 只會在少一區的時候留下孤兒
        let y = pad;
        let segIndex = 0;
        let stripIndex = 0;
        let textIndex = 0;

        for (const section of this.sections) {
            switch (section.kind) {
                case 'stats': {
                    y = this.putTitle(section.title, pad, y, innerW, textIndex++, k);
                    const strip = this.strips[stripIndex] ?? this.newStrip();
                    stripIndex++;
                    strip.setScale$(k);
                    strip.setStats(section.stats);
                    strip.position.set(pad, y);
                    y += strip.height$ + SECTION_GAP * k;
                    break;
                }
                case 'segmented': {
                    y = this.putTitle(section.title, pad, y, innerW, textIndex++, k);
                    const count = section.options.length;
                    const gap = 8 * k;
                    const each = (innerW - gap * (count - 1)) / count;
                    for (const opt of section.options) {
                        const button = this.segButtons[segIndex] ?? this.newButton(opt.label, () => section.onPick(opt.key));
                        segIndex++;
                        button.setLabel(opt.label);
                        button.setActive(opt.key === section.value);
                        button.setBoxSize(each, 34 * k);
                        button.position.set(pad + (each + gap) * section.options.indexOf(opt), y);
                    }
                    y += 34 * k + SECTION_GAP * k;
                    break;
                }
                case 'chips': {
                    y = this.putTitle(section.title, pad, y, innerW, textIndex++, k);
                    if (!this.picker.parent) this.body.addChild(this.picker);
                    this.picker.setHint(section.hint);
                    this.picker.setSize(innerW, k);
                    this.picker.position.set(pad, y);
                    y += this.picker.height$ + SECTION_GAP * k;
                    break;
                }
                case 'note': {
                    const note = this.texts[textIndex] ?? this.newText(11, MUTED, '500');
                    textIndex++;
                    note.text = section.text;
                    note.style.fontSize = 11 * k;
                    note.style.wordWrap = true;
                    note.style.wordWrapWidth = innerW;
                    note.style.lineHeight = 17 * k;
                    note.position.set(pad, y);
                    y += note.height + SECTION_GAP * k;
                    break;
                }
            }
        }

        const h = y - SECTION_GAP * k + pad;

        this.panelBg.clear();
        this.panelBg.roundRect(0, 0, w, h, 16 * k).fill({ color: WELL, alpha: 0.98 });
        this.panelBg.roundRect(0, 0, w, h, 16 * k).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.7 });

        // 靠右對齊按鈕的右緣，但不准頂出畫面左邊——手機上面板比按鈕的位置還寬
        const px = Math.max(12, Math.min(this.anchor.x - w, this.screen.w - w - 12));
        // 放不下就往上收：底下是路單，蓋住它比蓋住上方的發牌區更糟
        const py = Math.min(this.anchor.y + 40 * k, Math.max(12, this.screen.h - h - 12));
        this.panel.position.set(px, py);
    }

    private putTitle(title: string, x: number, y: number, wrapW: number, index: number, k: number): number {
        const text = this.texts[index] ?? this.newText(9.5, GOLD, '700');
        text.text = title.toUpperCase();
        text.style.fontSize = 9.5 * k;
        text.style.wordWrap = true;
        text.style.wordWrapWidth = wrapW;
        text.position.set(x, y);
        return y + text.height + 8 * k;
    }

    private newStrip(): StatStrip {
        const strip = new StatStrip();
        this.strips.push(strip);
        this.body.addChild(strip);
        return strip;
    }

    private newButton(label: string, onTap: () => void): TableButton {
        const button = new TableButton({ label, onTap });
        this.segButtons.push(button);
        this.body.addChild(button);
        return button;
    }

    private newText(size: number, fill: number, weight: '500' | '700'): Text {
        const text = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: size,
                fontWeight: weight,
                letterSpacing: weight === '700' ? 1.1 : 0,
                fill,
                // **中文一定要開 breakWords。** `wordWrap` 是照空白斷行的，而中文整段
                // 沒有一個空格——那段說明在英文版乖乖折成四行，換成中文就變成一條直線
                // 衝出面板右緣。開了之後英文仍照單字斷（只有超長的單一 token 才逐字切）
                breakWords: true,
            }),
        });
        this.texts.push(text);
        this.body.addChild(text);
        return text;
    }
}

/**
 * 籌碼設置：從十種面額裡挑出手邊那幾顆。
 *
 * 為什麼要有這個東西——這是真實桌台的做法：籌碼架就那麼大，你挑常用的放上去。
 * 全部十種都攤在桌邊的話，每次下注都得在一排裡找那顆 100，而**下注是有倒數的**。
 *
 * 規則只有兩條：最多五顆（桌邊擺得下的數量），最少一顆（沒有籌碼就沒辦法押）。
 * 已經滿了還去點第六顆時什麼都不會發生——比自動替換掉某一顆好，那樣玩家會發現
 * 自己手邊少了一個面額卻不知道是什麼時候不見的。
 *
 * **排成兩排五顆，不捲動。** 第一版是一條可橫捲的軌，但那條軌的右緣永遠切著半顆
 * 籌碼——在一塊有金色邊框的面板裡，半顆籌碼看起來就是破圖而不是「還有更多」。
 * 十顆剛好是 5×2，一眼看得完，也跟「挑五顆」這件事對得上。
 */
class ChipPicker extends Container {
    private readonly hint: Text;
    private readonly onChange: (values: ChipValue[]) => void;

    private cells: PickerCell[] = [];
    private chosen: ChipValue[] = [];
    private k = 1;
    private gridH = 0;

    constructor(atlas: ChipAtlas, onChange: (values: ChipValue[]) => void) {
        super();
        this.onChange = onChange;
        this.label = 'chip-picker';

        for (const value of CHIP_VALUES) {
            const texture = atlas.frames.get(value);
            if (!texture) continue;
            const cell = new PickerCell(value, texture, () => this.toggle(value));
            this.cells.push(cell);
            this.addChild(cell);
        }

        this.hint = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: 10,
                fontWeight: '500',
                fill: MUTED,
                wordWrap: true,
                breakWords: true,
            }),
        });
        this.addChild(this.hint);
    }

    public get height$(): number {
        return this.gridH + this.hint.height + 8 * this.k;
    }

    public setChosen(values: ChipValue[]): void {
        this.chosen = [...values];
        for (const cell of this.cells) cell.setChosen(this.chosen.includes(cell.value));
    }

    public setHint(text: string): void {
        this.hint.text = text;
    }

    /** 五顆一排、兩排。籌碼大小由欄寬決定，不由高度——這一區是被面板寬度框住的 */
    public setSize(width: number, scale: number): void {
        this.k = scale;
        const cols = CHIP_SLOTS;
        const gap = 8 * scale;
        const size = Math.max(16, Math.min((width - gap * (cols - 1)) / cols, 58 * scale));

        for (let i = 0; i < this.cells.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            this.cells[i].setSize$(size);
            this.cells[i].position.set(col * (size + gap) + size / 2, row * (size + gap) + size / 2);
        }

        const rows = Math.ceil(this.cells.length / cols);
        this.gridH = rows * size + (rows - 1) * gap;
        this.hint.style.fontSize = 10 * scale;
        this.hint.style.wordWrapWidth = width;
        this.hint.position.set(0, this.gridH + 6 * scale);
    }

    private toggle(value: ChipValue): void {
        const has = this.chosen.includes(value);
        if (has && this.chosen.length <= 1) return;
        if (!has && this.chosen.length >= CHIP_SLOTS) return;

        const next = has ? this.chosen.filter((v) => v !== value) : [...this.chosen, value];
        next.sort((a, b) => a - b);
        this.setChosen(next);
        this.onChange(next);
    }
}

/** 池子裡的一格。選中的畫一圈金環，沒選中的整顆變暗 */
class PickerCell extends Container {
    private readonly sprite: Sprite;
    private readonly ring = new Graphics();
    private size = 44;
    private chosen = false;

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
    }

    /**
     * 設定籌碼大小。
     *
     * **直接寫 `scale` 而不是 `sprite.width = px`。** Pixi 的 `width` setter 會
     * 保留 scale 原本的正負號（`sign * value / textureWidth`），所以只要有任何一次
     * 傳進負數，這顆 sprite 就**永遠上下顛倒**——之後傳再多正數都救不回來。
     *
     * 這不是假設性的問題：選單面板在 `place()` 之前會先排版一次，那時候螢幕寬度還是 0，
     * 算出來的欄寬是負的。症狀是籌碼上的面額整個倒過來印，而畫面其他地方一切正常。
     */
    public setSize$(px: number): void {
        this.size = px;
        this.sprite.scale.set(px / this.sprite.texture.orig.width);
        this.redraw();
    }

    public setChosen(chosen: boolean): void {
        this.chosen = chosen;
        this.redraw();
    }

    private redraw(): void {
        // 沒選中的壓到四成亮度：**「哪五顆在手邊」要能一眼掃出來**，
        // 而在深色背景上「暗＝沒選」比「多一個框＝有選」更快讀
        this.sprite.alpha = this.chosen ? 1 : 0.4;

        const g = this.ring;
        g.clear();
        if (!this.chosen) return;
        g.circle(0, 0, this.size / 2 + 3).stroke({ color: GOLD_BRIGHT, width: 2, alpha: 0.9 });
    }
}
