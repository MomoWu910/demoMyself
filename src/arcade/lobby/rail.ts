import gsap from 'gsap';
import { Container, FillGradient, Graphics, Text, TextStyle } from 'pixi.js';
import { InertiaScroller } from '../common/scroll/InertiaScroller';
import { t } from '../../i18n';
import { BANKER, BG, DIM, GOLD, GOLD_BRIGHT, GOLD_DEEP, INK, IVORY, IVORY_DIM, TEXT, WELL } from '../theme';
import type { LobbyEntry } from './catalog';

/**
 * 遊戲卡片的橫向滑軌——大廳的主角。
 *
 * 真實的博弈大廳一律是這個東西：一排機台 icon，手指往旁邊撥，撞到頭會回彈。所以
 * 這裡不做「網格排列 + 分頁」，做的是**跟手的一條軌**（捲動核心見 common/scroll）。
 *
 * 卡片全部是程序化畫的，跟符號與牌面同一個決定：這一頁不載任何圖檔。抽象到只剩輪廓的
 * 圖示在小尺寸下反而比寫實的清楚——一排 130px 寬的卡片，寫實插圖只會糊成一團色塊。
 */

/** 卡片的寬高比。沿用商用大廳 icon 常見的橫幅比例（約 235×180） */
const CARD_RATIO = 235 / 180;
const CARD_GAP = 14;
/** 卡片最小做到這裡。再小下去圖示與兩行字就疊在一起了 */
const MIN_CARD_H = 108;
const MIN_CARD_W = 112;
/** 卡片最大做到這裡（基準尺寸下；實際還要乘 UI 縮放係數，見 core/layout.ts） */
const MAX_CARD_W = 280;
const MAX_CARD_H = 200;
/** 最多排幾排。再多下去每一排都太矮，而且十款遊戲在第四排就沒東西可放了 */
const MAX_ROWS = 3;
/** 箭頭按鈕的半徑。捲不動時整顆藏起來 */
const ARROW_R = 17;
/**
 * 卡片群左右各留這麼寬的內距（基準值，實際還要乘 UI 縮放係數）。
 *
 * 這是**最邊緣那張卡 hover 放大時的容身之處**。垂直方向靠 scroller 的 `overflowY`
 * 把遮罩往外放（上下多出來的是背景，露出來無所謂），但水平方向不能那樣做——
 * 捲動軸就是水平的，遮罩往外放露出的會是正要被捲出去的那張卡的半個字。
 *
 * 所以水平改成**往內讓**：裁切線齊著可視範圍，卡片群自己從第 8px 開始排。
 * 捲到底時最邊那張左右各有 8px 可以脹，而捲動中被切的永遠是「本來就只露一半」的卡。
 *
 * 這個內距**要從排版的可用寬度裡先扣掉**，否則「剛好填滿」的排法會多出 16px 的
 * 捲動範圍——卡片明明鋪滿了，箭頭卻亮著、還能晃兩下。
 */
const CARD_INSET = 8;
/**
 * 兩個排法的填滿率差在這個數以內，就當它們一樣滿。
 *
 * 沒有容差的話，0.998 與 1.000 會被判成勝負分明——而那 0.2% 是兩張卡片各差
 * 一個像素的捨入誤差，人眼看到的是同樣鋪滿的一排。少了它，視窗寬度慢慢拉的時候
 * 排數會在兩種擺法之間來回跳。
 */
const FILL_EPS = 0.02;

/** 一種擺法：排幾排、卡片多大、把可用寬度填掉多少。 */
interface GridPlan {
    rows: number;
    cardW: number;
    cardH: number;
    /** 內容寬 ÷ 視窗寬。大於 1 表示要用捲的 */
    fill: number;
}

export class GameRail extends Container {
    private readonly scroller: InertiaScroller;
    private readonly leftArrow: ArrowButton;
    private readonly rightArrow: ArrowButton;
    private readonly onPick: (entry: LobbyEntry) => void;

    private cards: GameCard[] = [];
    private viewW = 0;
    private viewH = 0;
    private cardW = 160;
    private cardH = 122;
    private rows = 1;
    /** UI 縮放係數。**不能叫 `scale`**——Container 自己有一個同名的 ObservablePoint */
    private ui = 1;

    constructor(onPick: (entry: LobbyEntry) => void) {
        super();
        this.onPick = onPick;

        // `overflowY` 是 hover 那 4% 放大的容身之處。沒有它，滑鼠移上去的卡片會被
        // 自己所在的捲動視窗**齊邊切掉**——最上排切頭、最下排切腳。
        // 那個裁切比不放大還糟：它讓卡片看起來像壓在一塊玻璃底下。
        //
        // **水平方向刻意不放寬**：捲動軸就是水平的，往外多切一截露出來的會是
        // 正要被捲出去的那張卡的半個字（見 InertiaScroller 的 overflowX 說明）
        this.scroller = new InertiaScroller({ overflowY: 14 });
        this.addChild(this.scroller);

        this.leftArrow = new ArrowButton(-1, () => this.scroller.pageBy(-1));
        this.rightArrow = new ArrowButton(1, () => this.scroller.pageBy(1));
        this.addChild(this.leftArrow, this.rightArrow);

        this.scroller.on('pointerup', () => this.syncArrows());
        this.scroller.on('pointerupoutside', () => this.syncArrows());
    }

    /** 由大廳每幀餵進來（見 core/module.ts：元件自己不碰 ticker）。 */
    public update(dt: number): void {
        this.scroller.update(dt);
        this.syncArrows();
    }

    public setViewport(width: number, height: number, ui = 1): void {
        this.viewW = width;
        this.viewH = height;
        this.ui = ui;

        const plan = this.planGrid(width - CARD_INSET * 2 * ui, height, ui);
        this.rows = plan.rows;
        this.cardW = plan.cardW;
        this.cardH = plan.cardH;

        this.scroller.setViewport(width, height);
        this.layoutCards();

        const cy = height / 2;
        const r = ARROW_R * ui;
        this.leftArrow.setScale(ui);
        this.rightArrow.setScale(ui);
        this.leftArrow.position.set(r + 4, cy);
        this.rightArrow.position.set(width - r - 4, cy);
        this.syncArrows();
    }

    /**
     * 決定排幾排、卡片多大。
     *
     * 原本這裡是「拿高度除以一個理想卡片高」——那在筆電上剛好，在 2560 寬的螢幕上
     * 就露餡了：排數只看得到高度，於是右邊躺著四百多 px 的黑。
     *
     * 現在改成**把三種排法都算出來，挑最好的那個**。每種排法先把寬度平分給每一欄
     * （卡片只會比平分值小、不會更大，所以「剛好用完寬度」是這個算法的天花板），
     * 再讓上限與比例去修它。
     *
     * 挑選的順序不能反：**先看填不填得滿，再看卡片夠不夠大，最後才比排數**。
     * 只比大小會選出「四張巨無霸卡加一片空白」；只比填滿率會選出「一排十張小卡
     * 剛好貼齊邊緣」。而當三種排法都塞不下（手機上必定如此，卡片會溢出去用捲的），
     * 填滿率全都爆表分不出高下，那時才輪到排數——排滿一點，高度才不會空著。
     */
    private planGrid(width: number, height: number, ui: number): GridPlan {
        const gap = CARD_GAP * ui;
        // 寬度那條上限是「一眼要看得到兩張多一點」，否則沒人知道旁邊還有東西
        const capW = Math.min(MAX_CARD_W * ui, width * 0.46);
        const capH = MAX_CARD_H * ui;
        const n = Math.max(1, this.cards.length);

        let best: GridPlan | null = null;

        for (let rows = 1; rows <= MAX_ROWS; rows++) {
            const cols = Math.ceil(n / rows);
            const share = (width - (cols - 1) * gap) / cols;
            let cw = Math.min(capW, share);
            let ch = cw / CARD_RATIO;

            // 高度放不下就從高度回推寬度。**維持比例而不是壓扁**——一張被壓扁的卡片
            // 看起來是壞掉的，一片留白只是空的
            const rowH = (height - (rows - 1) * gap) / rows;
            const hCap = Math.min(capH, rowH);
            if (ch > hCap) {
                ch = hCap;
                cw = ch * CARD_RATIO;
            }
            cw = Math.max(MIN_CARD_W, cw);
            ch = Math.max(MIN_CARD_H, ch);

            // 撞到最小尺寸之後仍然放不下的排法直接淘汰（rows === 1 永遠保留當退路，
            // 否則極矮的視窗會一個候選都不剩）
            if (rows > 1 && rows * ch + (rows - 1) * gap > height) continue;

            const fill = (cols * (cw + gap) - gap) / width;
            if (!best || this.beats({ rows, cardW: cw, cardH: ch, fill }, best)) {
                best = { rows, cardW: cw, cardH: ch, fill };
            }
        }

        return best ?? { rows: 1, cardW: MIN_CARD_W, cardH: MIN_CARD_H, fill: 1 };
    }

    /** planGrid 的排序規則。填滿率一律夾到 1——超出去的都是「要捲」，捲多捲少沒有好壞。 */
    private beats(a: GridPlan, b: GridPlan): boolean {
        const fa = Math.min(a.fill, 1);
        const fb = Math.min(b.fill, 1);
        if (Math.abs(fa - fb) > FILL_EPS) return fa > fb;
        if (Math.abs(a.cardW - b.cardW) > 1) return a.cardW > b.cardW;
        return a.rows > b.rows;
    }

    /** 換分類：整批換掉卡片。捲動位置回到最左，因為看的已經是另一組東西了。 */
    public setEntries(entries: LobbyEntry[]): void {
        for (const card of this.cards) {
            card.stop();
            card.destroy({ children: true, texture: true, textureSource: true });
        }
        this.cards = entries.map((entry) => {
            const card = new GameCard(entry, () => {
                // 拖曳結束那一下也會發 tap，所以每次都要問一句剛才是不是在滑
                if (this.scroller.didDrag) return;
                this.onPick(entry);
            });
            this.scroller.content.addChild(card);
            return card;
        });

        // 排法要跟著**卡片數**重算，不是只跟著視窗大小。分類 tab 從十款切到兩款，
        // 同樣的寬度該排成一排大卡而不是留著三排的格子空在那裡
        if (this.viewW > 0) {
            const plan = this.planGrid(this.viewW - CARD_INSET * 2 * this.ui, this.viewH, this.ui);
            this.rows = plan.rows;
            this.cardW = plan.cardW;
            this.cardH = plan.cardH;
        }

        this.layoutCards();
        this.scroller.scrollTo(0);
        this.syncArrows();
    }

    public refreshText(): void {
        for (const card of this.cards) card.refreshText();
    }

    public stop(): void {
        this.scroller.stop();
        for (const card of this.cards) card.stop();
    }

    private layoutCards(): void {
        const rows = this.rows;
        const gap = CARD_GAP * this.ui;
        const inset = CARD_INSET * this.ui;
        // **先填直的再往右**（column-major）。橫向填的話，捲動時同一欄的上下兩張
        // 會是清單裡相隔五個位置的東西，看起來像亂排的；直的填才符合「一欄是一組」的直覺
        const cols = Math.max(1, Math.ceil(this.cards.length / rows));
        const blockH = rows * this.cardH + (rows - 1) * gap;
        const top = (this.viewH - blockH) / 2;

        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            card.setSize(this.cardW, this.cardH, this.ui);
            const col = Math.floor(i / rows);
            const row = i % rows;
            // 卡片畫在自己的中心座標裡（hover 放大才會從中間脹開），所以這裡給中心點
            card.position.set(
                inset + col * (this.cardW + gap) + this.cardW / 2,
                top + row * (this.cardH + gap) + this.cardH / 2
            );
        }

        // 內容長度含兩側的內距，右邊那一側才留得住（只加左邊的話，捲到最右時
        // 最後一張會貼死在裁切線上，放大照樣被切）
        const len = this.cards.length === 0 ? 0 : cols * (this.cardW + gap) - gap + inset * 2;
        this.scroller.setContentLength(len);
    }

    /**
     * 箭頭只在**那個方向真的還有東西**時出現。
     *
     * 兩顆一直亮著的話，捲到底還點得下去就成了沒有回應的按鈕；而捲不動的時候
     * （只有一兩張卡）根本不該有箭頭。商用大廳的做法也是這個規則。
     */
    private syncArrows(): void {
        const max = this.scroller.maxOffset;
        const at = this.scroller.offsetX;
        this.leftArrow.setShown(max > 1 && at > 2);
        this.rightArrow.setShown(max > 1 && at < max - 2);
    }
}

/** 一張遊戲卡片。 */
class GameCard extends Container {
    private readonly entry: LobbyEntry;
    private readonly bg = new Graphics();
    private readonly icon = new Container();
    private readonly title: Text;
    private readonly sub: Text;
    private readonly badge = new Graphics();
    private readonly badgeText: Text;

    private w = 160;
    private h = 122;
    /** UI 縮放係數。字級、圓角、內距全部乘它——只放大卡片而字不動，看起來會像貼圖被拉開 */
    private ui = 1;
    private hover = false;
    private tween: gsap.core.Tween | null = null;
    /** 卡片自己烘的兩道漸層（面上的光暈、邊框的金屬邊）。
     *  它們不在場景樹上，destroy 時要另外收 */
    private glow: FillGradient | null = null;
    private edge: FillGradient | null = null;

    constructor(entry: LobbyEntry, onPick: () => void) {
        super();
        this.entry = entry;

        this.addChild(this.bg, this.icon, this.badge);

        this.title = label(this.titleText(), 15, TEXT, '800');
        this.sub = label(this.subText(), 10, TEXT, '500');
        this.sub.alpha = 0.6;
        this.badgeText = label('', 8, BG, '800');
        this.addChild(this.title, this.sub, this.badgeText);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', onPick);
        this.on('pointerover', () => this.setHover(true));
        this.on('pointerout', () => this.setHover(false));

        this.redraw();
    }

    public setSize(w: number, h: number, ui = 1): void {
        this.w = w;
        this.h = h;
        this.ui = ui;
        this.redraw();
    }

    public refreshText(): void {
        this.title.text = this.titleText();
        this.sub.text = this.subText();
        this.badgeText.text = this.badgeLabel();
    }

    public stop(): void {
        this.tween?.kill();
        this.tween = null;
    }

    public override destroy(options?: Parameters<Container['destroy']>[0]): void {
        this.glow?.destroy();
        this.glow = null;
        this.edge?.destroy();
        this.edge = null;
        super.destroy(options);
    }

    private titleText(): string {
        return t(`arcade.lobby.${this.entry.key}`);
    }

    private subText(): string {
        return this.entry.playable ? t(`arcade.lobby.${this.entry.key}Desc`) : t('arcade.lobby.soonDesc');
    }

    private badgeLabel(): string {
        if (!this.entry.playable) return t('arcade.lobby.soon');
        return this.entry.badge ? t(`arcade.lobby.badge.${this.entry.badge}`) : '';
    }

    private setHover(on: boolean): void {
        // 還沒做的卡片不做浮起：那個動作是在說「這個可以進去」
        if (this.hover === on) return;
        this.hover = on;
        this.redraw();

        this.tween?.kill();
        const scale = on && this.entry.playable ? 1.04 : 1;
        this.tween = gsap.to(this.scale, { x: scale, y: scale, duration: 0.2, ease: 'power2.out' });
    }

    private redraw(): void {
        const { w, h, ui } = this;
        const playable = this.entry.playable;
        const c = this.entry.color;
        const g = this.bg;
        // 圓角跟著放大。固定的 14px 貼在一張 390 寬的卡片上會顯得幾乎是直角
        const radius = 14 * ui;

        /*
         * 字級跟著縮放走。**這一段是「大螢幕上字太小」的正主**——原本 15／10／8
         * 這三個數字是在 1440 寬調出來的絕對值，螢幕變成 2560 之後它們一點都沒變。
         *
         * 但光乘一個係數還不夠：字級是絕對值、卡片寬度不是，兩者在手機上會對撞。
         * 實測 390×844 的卡片只有 113px 寬，而百家樂的副標「Five roadmaps · 8-deck shoe」
         * 量出來 131px——**左右各有 9px 的字跑到卡片外面**。所以理想字級之後還要
         * 過一道「量出來太寬就縮回去」（見 fitText）。
         */
        const maxTextW = w - 14 * ui;
        fitText(this.title, 15 * ui, maxTextW);
        fitText(this.sub, 10 * ui, maxTextW);
        this.badgeText.style.fontSize = 8 * ui;

        g.clear();
        g.roundRect(-w / 2, -h / 2, w, h, radius).fill({ color: INK, alpha: 0.96 });

        /*
         * 上緣往下的一道金屬光暈。
         *
         * **這道漸層是「機台」與「網頁按鈕」的分界**：純色加描邊怎麼調都是後者。
         * 而黑金要低調，所以光暈的透明度壓得很低（未 hover 只有 0.16）——
         * 金色在這裡是打在卡片上緣的一道光，不是塗在卡片上的一層漆。
         */
        this.glow?.destroy();
        this.glow = new FillGradient({
            type: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [
                { offset: 0, color: c },
                { offset: 1, color: INK },
            ],
            textureSpace: 'local',
        });
        const glowAlpha = playable ? (this.hover ? 0.3 : 0.16) : 0.1;
        g.roundRect(-w / 2, -h / 2, w, h * 0.62, radius).fill({ fill: this.glow, alpha: glowAlpha });

        /*
         * 邊框也是漸層——**上緣亮、下緣暗**。
         *
         * 這是金屬邊跟「畫了一條線」的差別：真實的金屬邊會有一面迎光。同樣一個金色，
         * 均勻描一圈看起來是貼紙，上下拉開兩階就有厚度。整套黑金的高級感幾乎都靠
         * 這類一兩個明度階的細節堆出來，而不是靠顏色本身。
         */
        this.edge?.destroy();
        this.edge = new FillGradient({
            type: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [
                { offset: 0, color: this.hover && playable ? GOLD_BRIGHT : c },
                { offset: 1, color: GOLD_DEEP },
            ],
            textureSpace: 'local',
        });
        g.roundRect(-w / 2, -h / 2, w, h, radius).stroke({
            fill: this.edge,
            width: (this.hover && playable ? 1.8 : 1) * ui,
            alpha: playable ? (this.hover ? 1 : 0.42) : 0.3,
        });
        // 底部的一條光：讓卡片看起來是站在檯面上的
        g.roundRect(-w / 2 + 14 * ui, h / 2 - 2.5 * ui, w - 28 * ui, 2.5 * ui, 1.5 * ui).fill({
            color: c,
            alpha: playable ? (this.hover ? 0.85 : 0.34) : 0.18,
        });

        // 命中範圍明確給死，不要讓 Pixi 去推 bounds——「Container 包著幾個 Graphics 與 Text」
        // 這種結構推出來的命中與否取決於子物件各自的 eventMode，hover 會動但點擊不一定會觸發
        this.hitArea = {
            contains: (x: number, y: number) => x >= -w / 2 && x <= w / 2 && y >= -h / 2 && y <= h / 2,
        };

        // 還沒做的那幾張整體壓暗，但**保留自己那一階金屬色**——一整排掃過去仍然是
        // 有層次的，只是暗一階。壓成同一個灰會讓大廳右半邊整片死掉
        this.alpha = playable ? 1 : 0.72;

        // 圖示往上偏一點點而不是正中：下面那兩行字要位置，正中的話字會貼著卡片底緣
        drawIcon(this.icon, this.entry.key, playable ? c : DIM, Math.min(w, h) * 0.36, playable ? IVORY : IVORY_DIM);
        this.icon.position.set(0, -h * 0.11);

        this.title.anchor.set(0.5);
        this.sub.anchor.set(0.5);
        this.title.position.set(0, h / 2 - 34 * ui);
        this.sub.position.set(0, h / 2 - 16 * ui);

        this.drawBadge(c);
    }

    private drawBadge(color: number): void {
        const text = this.badgeLabel();
        this.badge.clear();
        this.badgeText.text = text;
        this.badgeText.visible = text !== '';
        if (text === '') return;

        // 膠囊寬度跟著文字走——中英文的長度差很多（SOON vs 規劃中），寫死會切字
        this.badgeText.anchor.set(0.5);
        const padX = 7 * this.ui;
        const bw = this.badgeText.width + padX * 2;
        const bh = 15 * this.ui;
        const bx = this.w / 2 - bw / 2 - 8 * this.ui;
        const by = -this.h / 2 + bh / 2 + 8 * this.ui;

        this.badge.roundRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2).fill({
            color: this.entry.playable ? color : 0x322d26,
            alpha: this.entry.playable ? 0.95 : 1,
        });
        this.badgeText.position.set(bx, by);
        this.badgeText.style.fill = this.entry.playable ? BG : 0xcfc6b6;
    }
}

/**
 * 卡片圖示。
 *
 * 每款畫的都是「這款遊戲桌上最好認的那個東西」而不是它的 logo：老虎機是三格轉軸、
 * 百家樂是兩張斜牌、骰寶是三顆骰子。玩家在大廳掃過去的時候認的是形狀。
 */
function drawIcon(host: Container, key: string, color: number, size: number, face: number): void {
    // 每次重畫都整批換掉。**子物件要一起 destroy**，只 removeChildren 的話舊的
    // Graphics 會留在記憶體裡，resize 幾次就疊出一堆孤兒
    for (const child of host.removeChildren()) child.destroy();

    const g = new Graphics();
    host.addChild(g);
    const s = size;

    switch (key) {
        case 'slot': {
            /*
             * 三格轉軸，每格一個 7。
             *
             * **777 是老虎機唯一不用解釋的符號。** 原本這裡畫的是三個空轉軸加中間
             * 一條亮條——那個形狀在 130px 的卡片上看起來像三顆並排的按鈕，
             * 抽象到失去了指涉對象。抽象的目的是在小尺寸下更好認，不是更難認。
             */
            const cw = s * 0.42;
            const ch = s * 0.66;
            const gap = s * 0.12;
            const round = s * 0.07;
            for (let i = -1; i <= 1; i++) {
                const cx = i * (cw + gap);
                g.roundRect(cx - cw / 2, -ch / 2, cw, ch, round).fill({ color: WELL, alpha: 0.95 });
                g.roundRect(cx - cw / 2, -ch / 2, cw, ch, round).stroke({ color, width: Math.max(1, s * 0.032), alpha: 0.55 });

                // 「7」用一橫一斜的**筆畫**而不是實心多邊形：實心的字腳在這個尺寸下
                // 會糊成一塊，而筆畫的線寬跟著 s 走，放大縮小都是同一個字形
                const fw = cw * 0.5;
                const fh = ch * 0.5;
                g.moveTo(cx - fw / 2, -fh / 2)
                    .lineTo(cx + fw / 2, -fh / 2)
                    .lineTo(cx - fw * 0.14, fh / 2)
                    .stroke({
                        color,
                        width: Math.max(1.2, s * 0.072),
                        alpha: 0.95,
                        cap: 'round',
                        join: 'round',
                    });
            }
            break;
        }
        case 'baccarat': {
            /*
             * 兩張牌加一疊籌碼——**牌桌的樣子**。
             *
             * 原本是兩張一模一樣的白牌加中間一個圓點：兩張同尺寸同角度的牌看起來像
             * 一張牌畫歪了，中間那個圓點則不代表任何東西。現在後面一張大、前面一張小，
             * 花色一黑一紅，右下角壓三枚部分重疊的籌碼——**大小差、花色差、遮擋關係**，
             * 三件事一起才說得出「這是一張正在下注的牌桌」，少了任何一件都只是幾何圖形。
             */
            const lw = Math.max(1, s * 0.03);
            const round = s * 0.07;
            /*
             * 整組往左讓一點。牌偏左、籌碼偏右，兩邊的外框加起來不對稱，
             * 不補這一下，圖示的重心會落在右邊，一排卡片掃過去只有這張是歪的。
             */
            const ox = -s * 0.1;

            // 後面那張大牌，左傾。牌各自旋轉，所以要各自是一個物件
            const big = new Graphics();
            const bw = s * 0.62;
            const bh = s * 0.82;
            big.roundRect(-bw / 2, -bh / 2, bw, bh, round).fill({ color: face, alpha: 0.97 });
            big.roundRect(-bw / 2, -bh / 2, bw, bh, round).stroke({ color, width: lw, alpha: 0.85 });
            spade(big, 0, -bh * 0.04, s * 0.16, WELL);
            big.position.set(ox - s * 0.26, 0);
            big.rotation = -0.2;
            host.addChild(big);

            // 前面那張小牌，右傾且壓在大牌上緣——遮擋是「這兩張有前後」最省事的說法
            const small = new Graphics();
            const sw = s * 0.5;
            const sh = s * 0.66;
            small.roundRect(-sw / 2, -sh / 2, sw, sh, round).fill({ color: face, alpha: 0.97 });
            small.roundRect(-sw / 2, -sh / 2, sw, sh, round).stroke({ color, width: lw, alpha: 0.85 });
            heart(small, 0, 0, s * 0.13, BANKER);
            small.position.set(ox + s * 0.22, -s * 0.12);
            small.rotation = 0.26;
            host.addChild(small);

            /*
             * 右下角三枚籌碼。**最後畫**，所以它們疊在牌上——籌碼壓著牌是牌桌上的常態，
             * 反過來（牌壓著籌碼）看起來像東西掉在地上。
             *
             * 位置偏右而不是偏下，是被卡片的版面逼出來的：圖示下方 20px 就是標題那一行，
             * 而這張圖示比其他張都「高」（牌本來就是直立的）。籌碼往正下方堆的話，
             * **手機上那疊籌碼會直接壓在「百家樂」三個字上**——實測 390×844 踩到。
             */
            const chips = new Graphics();
            const r = s * 0.19;
            for (const [cx, cy, tint] of [
                [ox + s * 0.34, s * 0.14, GOLD_DEEP],
                [ox + s * 0.66, s * 0.04, color],
                [ox + s * 0.52, s * 0.28, GOLD],
            ] as Array<[number, number, number]>) {
                chips.circle(cx, cy, r).fill({ color: tint, alpha: 0.97 });
                // 深色描邊讓疊在一起的三枚分得開——同色的圓疊在一起會糊成一團雲
                chips.circle(cx, cy, r).stroke({ color: WELL, width: lw * 1.5, alpha: 0.9 });
                chips.circle(cx, cy, r * 0.5).fill({ color: face, alpha: 0.8 });
            }
            host.addChild(chips);
            break;
        }
        case 'dragontiger': {
            // 龍虎是「兩邊各一張牌對賭」，所以畫成左右分立而不是疊在一起，
            // 中間留一條斜線當對峙的界線
            twoCards(host, color, s, face, [-0.1, 0.1], s * 0.42);
            g.moveTo(0, -s * 0.6).lineTo(0, s * 0.6).stroke({ color: GOLD, width: 1.6, alpha: 0.7 });
            break;
        }
        case 'sicbo': {
            // 三顆骰子，點數 1／4／3 只是為了讓三顆看起來不一樣
            const d = s * 0.44;
            const spots: Array<[number, number, number]> = [
                [-s * 0.32, s * 0.16, 1],
                [s * 0.3, s * 0.2, 4],
                [-s * 0.02, -s * 0.3, 3],
            ];
            for (const [dx, dy, pips] of spots) {
                g.roundRect(dx - d / 2, dy - d / 2, d, d, 5).fill({ color: face, alpha: 0.95 });
                g.roundRect(dx - d / 2, dy - d / 2, d, d, 5).stroke({ color, width: 1.2, alpha: 0.8 });
                for (const [px, py] of pipLayout(pips)) {
                    g.circle(dx + px * d * 0.3, dy + py * d * 0.3, d * 0.09).fill(0x241f18);
                }
            }
            break;
        }
        case 'ox28': {
            // 二八槓打的是麻將牌，兩張直立、其中一張露出筒子的圓點
            const tw = s * 0.4;
            const th = s * 0.86;
            for (const [dx, tilt] of [
                [-s * 0.26, -0.06],
                [s * 0.26, 0.06],
            ] as Array<[number, number]>) {
                const tile = new Graphics();
                tile.roundRect(-tw / 2, -th / 2, tw, th, 4).fill({ color: face, alpha: 0.95 });
                tile.roundRect(-tw / 2, -th / 2, tw, th, 4).stroke({ color, width: 1.2, alpha: 0.8 });
                for (let i = 0; i < 2; i++) {
                    tile.circle(0, (i - 0.5) * th * 0.34, tw * 0.15).fill({ color, alpha: 0.85 });
                }
                tile.position.set(dx, 0);
                tile.rotation = tilt;
                host.addChild(tile);
            }
            break;
        }
        case 'roulette': {
            // 輪盤：外圈分格、內圈、一顆球
            const r = s * 0.62;
            g.circle(0, 0, r).fill({ color: 0x241f18, alpha: 0.95 });
            g.circle(0, 0, r).stroke({ color, width: 1.4, alpha: 0.85 });
            for (let i = 0; i < 12; i++) {
                const a = (i / 12) * Math.PI * 2;
                // 隔一格填色，才看得出是輪盤而不是時鐘
                if (i % 2 === 0) continue;
                g.moveTo(0, 0)
                    .arc(0, 0, r, a, a + Math.PI / 6)
                    .fill({ color, alpha: 0.28 });
            }
            g.circle(0, 0, r * 0.38).fill({ color: INK, alpha: 1 });
            g.circle(0, 0, r * 0.38).stroke({ color, width: 1, alpha: 0.6 });
            g.circle(r * 0.76, -r * 0.32, s * 0.09).fill(face);
            break;
        }
        case 'goldenflower': {
            // 炸金花是三張牌，扇形展開——跟三公的並排區隔開
            for (const angle of [-0.34, 0, 0.34]) {
                const card = new Graphics();
                const cw = s * 0.5;
                const chh = s * 0.74;
                card.roundRect(-cw / 2, -chh / 2, cw, chh, 4).fill(face);
                card.roundRect(-cw / 2, -chh / 2, cw, chh, 4).stroke({ color, width: 1.1, alpha: 0.8 });
                // 扇形的支點在牌的下緣，所以往下推一段再轉
                card.position.set(Math.sin(angle) * s * 0.5, Math.cos(angle) * s * 0.1 - s * 0.05);
                card.rotation = angle;
                host.addChild(card);
            }
            break;
        }
        case 'sangong': {
            // 三公也是三張牌，但是並排、中間那張高一點
            const cw = s * 0.44;
            const chh = s * 0.66;
            for (const [dx, dy] of [
                [-s * 0.5, s * 0.06],
                [0, -s * 0.08],
                [s * 0.5, s * 0.06],
            ] as Array<[number, number]>) {
                g.roundRect(dx - cw / 2, dy - chh / 2, cw, chh, 4).fill(face);
                g.roundRect(dx - cw / 2, dy - chh / 2, cw, chh, 4).stroke({ color, width: 1.1, alpha: 0.8 });
                g.circle(dx, dy, cw * 0.16).fill({ color, alpha: 0.85 });
            }
            break;
        }
        case 'fruit': {
            // 水果盤：兩顆櫻桃加梗。這是老式電子機台最好認的符號
            g.moveTo(0, -s * 0.72)
                .bezierCurveTo(-s * 0.34, -s * 0.4, -s * 0.5, -s * 0.1, -s * 0.44, s * 0.12)
                .stroke({ color: 0x7d8c5e, width: 2, alpha: 0.85 });
            g.moveTo(0, -s * 0.72)
                .bezierCurveTo(s * 0.3, -s * 0.34, s * 0.44, -s * 0.05, s * 0.42, s * 0.14)
                .stroke({ color: 0x7d8c5e, width: 2, alpha: 0.85 });
            for (const dx of [-0.44, 0.42]) {
                g.circle(dx * s, s * 0.42, s * 0.29).fill({ color, alpha: 0.95 });
                g.circle(dx * s - s * 0.09, s * 0.34, s * 0.08).fill({ color: GOLD_BRIGHT, alpha: 0.5 });
            }
            break;
        }
        case 'paigow': {
            // 牌九是骨牌：一塊橫躺的長條，中間一道分隔線，兩邊各一組點
            const pw = s * 1.15;
            const ph = s * 0.56;
            g.roundRect(-pw / 2, -ph / 2, pw, ph, 4).fill({ color: 0x241f18, alpha: 0.95 });
            g.roundRect(-pw / 2, -ph / 2, pw, ph, 4).stroke({ color, width: 1.3, alpha: 0.85 });
            g.moveTo(0, -ph / 2 + 3).lineTo(0, ph / 2 - 3).stroke({ color, width: 1, alpha: 0.5 });
            for (const [px, py] of [
                [-0.62, -0.22],
                [-0.62, 0.22],
                [0.4, 0],
                [0.78, 0],
            ] as Array<[number, number]>) {
                g.circle(px * pw * 0.42, py * ph, ph * 0.13).fill({ color: face, alpha: 0.9 });
            }
            break;
        }
        default:
            g.circle(0, 0, s * 0.5).stroke({ color, width: 1.5, alpha: 0.6 });
    }
}

/**
 * 花色。
 *
 * 兩個都是**兩顆圓加一個三角**拼的，不是貝茲曲線也不是文字。
 * 文字要載字型而且不同平台的 ♠ ♥ 長得不一樣；貝茲在 20px 見方的尺寸下，
 * 那幾個控制點的差別根本看不出來，卻要多維護八個座標。
 */
function heart(g: Graphics, cx: number, cy: number, size: number, color: number): void {
    g.moveTo(cx - size * 0.86, cy - size * 0.04)
        .lineTo(cx + size * 0.86, cy - size * 0.04)
        .lineTo(cx, cy + size * 0.98)
        .fill(color);
    g.circle(cx - size * 0.43, cy - size * 0.28, size * 0.47).fill(color);
    g.circle(cx + size * 0.43, cy - size * 0.28, size * 0.47).fill(color);
}

function spade(g: Graphics, cx: number, cy: number, size: number, color: number): void {
    // 紅心倒過來，再補一根梗——黑桃跟紅心的差別就只有這兩件事
    g.moveTo(cx - size * 0.86, cy + size * 0.22)
        .lineTo(cx + size * 0.86, cy + size * 0.22)
        .lineTo(cx, cy - size * 0.92)
        .fill(color);
    g.circle(cx - size * 0.43, cy + size * 0.18, size * 0.47).fill(color);
    g.circle(cx + size * 0.43, cy + size * 0.18, size * 0.47).fill(color);
    g.moveTo(cx - size * 0.3, cy + size * 1.02)
        .lineTo(cx, cy + size * 0.42)
        .lineTo(cx + size * 0.3, cy + size * 1.02)
        .fill(color);
}

/** 兩張牌。各自是一個物件因為要各自旋轉——畫進同一個 Graphics 會共用變換。 */
function twoCards(host: Container, color: number, s: number, face: number, angles: [number, number], spread = s * 0.34): void {
    const cw = s * 0.56;
    const ch = s * 0.8;
    for (let i = 0; i < 2; i++) {
        const card = new Graphics();
        card.roundRect(-cw / 2, -ch / 2, cw, ch, 4).fill(face);
        card.roundRect(-cw / 2, -ch / 2, cw, ch, 4).stroke({ color, width: 1.2, alpha: 0.8 });
        card.position.set((i === 0 ? -1 : 1) * spread, 0);
        card.rotation = angles[i];
        host.addChild(card);
    }
}

/** 骰子點數的位置（單位是「半格」，-1 ~ 1）。 */
function pipLayout(pips: number): Array<[number, number]> {
    switch (pips) {
        case 1:
            return [[0, 0]];
        case 3:
            return [
                [-1, -1],
                [0, 0],
                [1, 1],
            ];
        default:
            return [
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1],
            ];
    }
}

/** 左右翻頁鍵。 */
class ArrowButton extends Container {
    private readonly g = new Graphics();
    private shown = false;
    private tween: gsap.core.Tween | null = null;

    constructor(dir: 1 | -1, onTap: () => void) {
        super();
        this.addChild(this.g);

        const r = ARROW_R;
        this.g.circle(0, 0, r).fill({ color: INK, alpha: 0.94 });
        this.g.circle(0, 0, r).stroke({ color: GOLD, width: 1.2, alpha: 0.4 });
        // 箭頭指向它會把人帶去的方向：右邊那顆指右。`dir` 是位移的正負，
        // 所以尖端在 `dir * 3`、尾巴在 `-dir * 3`
        this.g
            .moveTo(-dir * 3, -6)
            .lineTo(dir * 3, 0)
            .lineTo(-dir * 3, 6)
            .stroke({ color: GOLD, width: 2, alpha: 0.9 });

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', onTap);

        this.alpha = 0;
        this.visible = false;
    }

    /**
     * 跟著 UI 縮放。
     *
     * 用 `scale` 而不是重畫：這顆圓裡面只有一個圓和一個箭頭，等比放大不會有任何
     * 細節走樣，而重畫要多維護一份「線寬也得乘」的規則。**能用變換解決的就別重畫**——
     * 卡片得重畫是因為它裡面有文字（文字放大會糊）。
     */
    public setScale(ui: number): void {
        this.scale.set(ui);
    }

    /** 淡入淡出而不是直接開關：捲到底的瞬間硬消失會讓人以為畫面閃了一下。 */
    public setShown(on: boolean): void {
        if (this.shown === on) return;
        this.shown = on;
        this.tween?.kill();
        if (on) this.visible = true;
        this.tween = gsap.to(this, {
            alpha: on ? 1 : 0,
            duration: 0.18,
            // 藏起來之後要真的關掉 visible，否則透明的圓還是接得到點擊
            onComplete: () => {
                this.visible = this.shown;
            },
        });
    }
}

/**
 * 給理想字級，量出來太寬就按比例縮到剛好。
 *
 * 改 `fontSize` 而不是改 `scale`：Pixi 的 Text 是烘成貼圖的，縮放會糊掉，
 * 而重設字級是重烘一張——在這個尺寸下，糊掉的小字比小一號的清楚字難讀得多。
 *
 * 一次就夠，不必迭代：字寬與字級是線性的，比例算一次就落在目標上。
 */
function fitText(text: Text, size: number, maxW: number): void {
    text.style.fontSize = size;
    const w = text.width;
    if (w > maxW && w > 0) text.style.fontSize = size * (maxW / w);
}

function label(content: string, size: number, fill: number, weight: '500' | '800'): Text {
    const text = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    text.anchor.set(0.5);
    return text;
}
