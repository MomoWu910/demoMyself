import gsap from 'gsap';
import { Container, FillGradient, Graphics, Text, TextStyle } from 'pixi.js';
import { InertiaScroller } from '../common/scroll/InertiaScroller';
import { t } from '../../i18n';
import { BG, DIM, GOLD, GOLD_BRIGHT, GOLD_DEEP, INK, IVORY, IVORY_DIM, TEXT, WELL } from '../theme';
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

/** 卡片的寬高比。沿用真實大廳 icon 的橫幅比例（Ducky 是 235×180） */
const CARD_RATIO = 235 / 180;
const CARD_GAP = 14;
/** 卡片最矮做到這裡。再矮下去圖示與兩行字就疊在一起了 */
const MIN_CARD_H = 108;
/** 最多排幾排。再多下去每一排都太矮，而且十款遊戲在第四排就沒東西可放了 */
const MAX_ROWS = 3;
/** 箭頭按鈕的半徑。捲不動時整顆藏起來 */
const ARROW_R = 17;

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

    constructor(onPick: (entry: LobbyEntry) => void) {
        super();
        this.onPick = onPick;

        // `overflow` 是 hover 那 4% 放大的容身之處。沒有它，滑鼠移上去的卡片會被
        // 自己所在的捲動視窗**齊邊切掉**——最上排切頭、最下排切腳、最邊那張切側面。
        // 那個裁切比不放大還糟：它讓卡片看起來像壓在一塊玻璃底下
        this.scroller = new InertiaScroller({ fadeColor: BG, fadeWidth: 22, overflow: 14 });
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

    public setViewport(width: number, height: number): void {
        this.viewW = width;
        this.viewH = height;

        /*
         * 排幾排，是**由卡片的理想大小反推的**，不是拿高度除以一個常數。
         *
         * 因為卡片有多大其實是**寬度**決定的：`width * 0.46` 那條規則（一眼要看得到
         * 兩張多一點，否則沒人知道旁邊還有東西）在手機上把卡片壓到 127 高、在桌機上
         * 是 200 高。所以同樣 420 的高度，手機該排三排、桌機該排兩排——
         * 用固定的「每排 200」去除，手機就會排成兩排小卡加一大片空白。
         */
        const cardWMax = Math.min(280, width * 0.46);
        const idealH = Math.max(MIN_CARD_H, Math.min(200, cardWMax / CARD_RATIO));
        this.rows = Math.max(1, Math.min(MAX_ROWS, Math.round(height / (idealH + CARD_GAP))));

        // 卡片尺寸由排數與高度起算、被寬度修正，最後回頭夾一次高度好維持比例
        const perRow = (height - (this.rows - 1) * CARD_GAP) / this.rows;
        const maxH = Math.max(MIN_CARD_H, Math.min(perRow, 200));
        this.cardW = Math.max(112, Math.min(maxH * CARD_RATIO, cardWMax));
        this.cardH = Math.max(MIN_CARD_H, Math.min(maxH, this.cardW / CARD_RATIO));

        this.scroller.setViewport(width, height);
        this.layoutCards();

        const cy = height / 2;
        this.leftArrow.position.set(ARROW_R + 4, cy);
        this.rightArrow.position.set(width - ARROW_R - 4, cy);
        this.syncArrows();
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
        // **先填直的再往右**（column-major）。橫向填的話，捲動時同一欄的上下兩張
        // 會是清單裡相隔五個位置的東西，看起來像亂排的；直的填才符合「一欄是一組」的直覺
        const cols = Math.max(1, Math.ceil(this.cards.length / rows));
        const blockH = rows * this.cardH + (rows - 1) * CARD_GAP;
        const top = (this.viewH - blockH) / 2;

        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            card.setSize(this.cardW, this.cardH);
            const col = Math.floor(i / rows);
            const row = i % rows;
            // 卡片畫在自己的中心座標裡（hover 放大才會從中間脹開），所以這裡給中心點
            card.position.set(
                col * (this.cardW + CARD_GAP) + this.cardW / 2,
                top + row * (this.cardH + CARD_GAP) + this.cardH / 2
            );
        }

        const len = this.cards.length === 0 ? 0 : cols * (this.cardW + CARD_GAP) - CARD_GAP;
        this.scroller.setContentLength(len);
    }

    /**
     * 箭頭只在**那個方向真的還有東西**時出現。
     *
     * 兩顆一直亮著的話，捲到底還點得下去就成了沒有回應的按鈕；而捲不動的時候
     * （只有一兩張卡）根本不該有箭頭。Ducky 的大廳也是這個規則。
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

    public setSize(w: number, h: number): void {
        this.w = w;
        this.h = h;
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
        const { w, h } = this;
        const playable = this.entry.playable;
        const c = this.entry.color;
        const g = this.bg;

        g.clear();
        g.roundRect(-w / 2, -h / 2, w, h, 14).fill({ color: INK, alpha: 0.96 });

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
        g.roundRect(-w / 2, -h / 2, w, h * 0.62, 14).fill({ fill: this.glow, alpha: glowAlpha });

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
        g.roundRect(-w / 2, -h / 2, w, h, 14).stroke({
            fill: this.edge,
            width: this.hover && playable ? 1.8 : 1,
            alpha: playable ? (this.hover ? 1 : 0.42) : 0.3,
        });
        // 底部的一條光：讓卡片看起來是站在檯面上的
        g.roundRect(-w / 2 + 14, h / 2 - 2.5, w - 28, 2.5, 1.5).fill({
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
        this.title.position.set(0, h / 2 - 34);
        this.sub.position.set(0, h / 2 - 16);

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
        const padX = 7;
        const bw = this.badgeText.width + padX * 2;
        const bh = 15;
        const bx = this.w / 2 - bw / 2 - 8;
        const by = -this.h / 2 + bh / 2 + 8;

        this.badge.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 7).fill({
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
            // 三格轉軸，中間那格亮著
            const cw = s * 0.42;
            const ch = s * 0.66;
            const gap = s * 0.12;
            for (let i = -1; i <= 1; i++) {
                const x = i * (cw + gap) - cw / 2;
                g.roundRect(x, -ch / 2, cw, ch, 4).fill({ color: WELL, alpha: 0.95 });
                g.roundRect(x, -ch / 2, cw, ch, 4).stroke({ color, width: 1.4, alpha: 0.75 });
            }
            g.roundRect(-cw / 2 + 3, -s * 0.11, cw - 6, s * 0.22, 3).fill(color);
            break;
        }
        case 'baccarat': {
            // 兩張斜放的牌。角度相反才看得出是兩張疊著，不是一張變形
            twoCards(host, color, s, face, [-0.18, 0.16]);
            g.circle(0, s * 0.04, s * 0.1).fill({ color, alpha: 0.9 });
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
