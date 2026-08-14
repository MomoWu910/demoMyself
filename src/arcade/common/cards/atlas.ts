import { Application, Container, Graphics, Rectangle, Text, TextStyle, Texture } from 'pixi.js';

/**
 * 撲克牌面——**在 runtime 畫出來，再烘成一張 atlas**，不載任何圖檔。
 *
 * 跟老虎機的符號（games/slot/symbols.ts）同一套手法，但這裡的理由更硬：
 * 一副牌有 52 種面貌，各自一張 texture 的話，桌上同時攤開六張不同的牌就是六次
 * texture 切換、六次 batch 中斷。烘進同一張 atlas 之後，**不論桌上有幾張牌、
 * 是哪幾張，都只是一次 draw call**。
 *
 * 這支放在 `common/` 而不是 `games/baccarat/` 底下，是因為牌是**跨玩法的東西**：
 * 百家樂、龍虎、二十一點用的是同一副牌，差別只在怎麼發、怎麼算。玩法只該負責規則，
 * 不該各自畫一次紅心。
 */

/** atlas 裡每張牌佔的格子（邏輯像素）。2:2.8 接近真實撲克牌的比例。 */
export const CARD_W = 96;
export const CARD_H = 134;

export const SUITS = ['spade', 'heart', 'club', 'diamond'] as const;
export type Suit = (typeof SUITS)[number];

/** 紅色的兩個花色。分開列出來而不是寫 `suit === 'heart' || …`，加花色時才不會漏改。 */
const RED: ReadonlySet<Suit> = new Set<Suit>(['heart', 'diamond']);

/** 牌面的底色。純白在這一頁的暖紫背景上太刺眼，壓一點暖調才像桌上的實體牌。 */
const FACE = 0xf4efe6;
const INK = 0x1a1420;
const RED_INK = 0xd62246;

/** 牌背的主色。用站台既有的紫，讓它跟遊樂場的霓虹是同一家族。 */
const BACK = 0x6a3fa0;

export interface CardAtlas {
    /** `frames.get('heart')?.[11]` = 紅心 J。索引是 rank（1~13），0 沒有用。 */
    frames: Map<Suit, Texture[]>;
    /** 牌背。發牌時先蓋著的那一面。 */
    back: Texture;
    /** 底層那張烘出來的圖。要 track 它，回收才會真的把 GPU 記憶體還回去。 */
    source: Texture;
}

/**
 * 把整副牌畫成 13 欄 × 5 列（四個花色各一列，第五列放牌背），烘成一張 texture。
 *
 * 為什麼一次烘整副而不是「用到才畫」：牌是隨機發的，**任何一張都可能出現**，
 * 延後畫只是把成本從進桌時挪到發牌時——而發牌時正在跑動畫，那才是最不能卡的時候。
 */
export function bakeCardAtlas(app: Application): CardAtlas {
    const sheet = new Container();

    for (let s = 0; s < SUITS.length; s++) {
        for (let rank = 1; rank <= 13; rank++) {
            const card = drawFace(SUITS[s], rank);
            card.x = (rank - 1) * CARD_W;
            card.y = s * CARD_H;
            sheet.addChild(card);
        }
    }

    const backCard = drawBack();
    backCard.x = 0;
    backCard.y = SUITS.length * CARD_H;
    sheet.addChild(backCard);

    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const source = app.renderer.generateTexture({
        target: sheet,
        resolution,
        // 明確指定範圍，不讓它依 bounds 自動推算——描邊會讓 bounds 比格子大一點點，
        // 切 frame 時整副牌就會偏移
        frame: new Rectangle(0, 0, CARD_W * 13, CARD_H * (SUITS.length + 1)),
    });

    sheet.destroy({ children: true });

    const frames = new Map<Suit, Texture[]>();
    for (let s = 0; s < SUITS.length; s++) {
        const row: Texture[] = [];
        // 索引 0 空著，讓 row[rank] 直接對應 rank——差一位的錯在牌面上很難發現
        row.push(Texture.EMPTY);
        for (let rank = 1; rank <= 13; rank++) {
            row.push(
                new Texture({
                    source: source.source,
                    frame: new Rectangle((rank - 1) * CARD_W, s * CARD_H, CARD_W, CARD_H),
                })
            );
        }
        frames.set(SUITS[s], row);
    }

    const back = new Texture({
        source: source.source,
        frame: new Rectangle(0, SUITS.length * CARD_H, CARD_W, CARD_H),
    });

    return { frames, back, source };
}

/** rank 的字面。1/11/12/13 有自己的寫法，其餘就是數字。 */
export function rankLabel(rank: number): string {
    switch (rank) {
        case 1:
            return 'A';
        case 11:
            return 'J';
        case 12:
            return 'Q';
        case 13:
            return 'K';
        default:
            return String(rank);
    }
}

/** 一張牌面畫在 CARD_W×CARD_H 的格子裡，原點在左上。 */
function drawFace(suit: Suit, rank: number): Container {
    const box = new Container();
    const g = new Graphics();
    box.addChild(g);

    const ink = RED.has(suit) ? RED_INK : INK;
    const pad = 4;

    g.roundRect(pad, pad, CARD_W - pad * 2, CARD_H - pad * 2, 9).fill(FACE);
    g.roundRect(pad, pad, CARD_W - pad * 2, CARD_H - pad * 2, 9).stroke({ color: 0x000000, width: 1, alpha: 0.16 });

    // 左上角的 rank 與小花色。真實牌是對角各一組，但這裡的牌永遠正放且會被疊著發，
    // 只畫左上角就夠認，也讓中央的大花色有更多空間
    const label = new Text({
        text: rankLabel(rank),
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: 30,
            fontWeight: '800',
            fill: ink,
        }),
    });
    label.anchor.set(0.5);
    label.position.set(pad + 18, pad + 22);
    box.addChild(label);

    drawSuit(g, suit, pad + 18, pad + 46, 9, ink);
    drawSuit(g, suit, CARD_W / 2, CARD_H * 0.62, 26, ink);

    return box;
}

function drawBack(): Container {
    const box = new Container();
    const g = new Graphics();
    box.addChild(g);

    const pad = 4;
    g.roundRect(pad, pad, CARD_W - pad * 2, CARD_H - pad * 2, 9).fill(BACK);
    g.roundRect(pad + 7, pad + 7, CARD_W - (pad + 7) * 2, CARD_H - (pad + 7) * 2, 6).stroke({
        color: 0xffffff,
        width: 1.5,
        alpha: 0.35,
    });

    // 斜格紋。用一組等距斜線交叉，比畫圖案省事，遠看也像真的牌背
    const step = 11;
    for (let i = -CARD_H; i < CARD_W + CARD_H; i += step) {
        g.moveTo(i, pad).lineTo(i + CARD_H, CARD_H - pad);
        g.moveTo(i, CARD_H - pad).lineTo(i + CARD_H, pad);
    }
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.12 });

    // 蓋一層跟邊框同形的遮罩，把斜線超出圓角的部分收掉
    const mask = new Graphics();
    mask.roundRect(pad + 7, pad + 7, CARD_W - (pad + 7) * 2, CARD_H - (pad + 7) * 2, 6).fill(0xffffff);
    box.addChild(mask);
    g.mask = mask;

    // 遮罩會把邊框一起吃掉，所以外框另外畫一次
    const frame = new Graphics();
    frame.roundRect(pad, pad, CARD_W - pad * 2, CARD_H - pad * 2, 9).stroke({ color: 0xffffff, width: 1.5, alpha: 0.28 });
    box.addChild(frame);

    return box;
}

/**
 * 花色符號。四個都用基本圖元組出來，`size` 是大致的半徑。
 *
 * 黑桃與梅花共用「三個圓 + 一根莖」的骨架，差別只在圓的位置與有沒有尖頂——
 * 這也是為什麼實體牌上這兩個花色遠看容易認錯。
 */
function drawSuit(g: Graphics, suit: Suit, cx: number, cy: number, size: number, color: number): void {
    switch (suit) {
        case 'heart': {
            const r = size * 0.52;
            g.moveTo(cx, cy + size * 0.9)
                .bezierCurveTo(cx - size * 1.5, cy - size * 0.2, cx - r * 0.6, cy - size * 1.1, cx, cy - size * 0.35)
                .bezierCurveTo(cx + r * 0.6, cy - size * 1.1, cx + size * 1.5, cy - size * 0.2, cx, cy + size * 0.9)
                .fill(color);
            break;
        }
        case 'diamond': {
            g.moveTo(cx, cy - size)
                .lineTo(cx + size * 0.72, cy)
                .lineTo(cx, cy + size)
                .lineTo(cx - size * 0.72, cy)
                .closePath()
                .fill(color);
            break;
        }
        case 'spade': {
            // 倒過來的心 + 梯形莖
            g.moveTo(cx, cy - size)
                .bezierCurveTo(cx + size * 1.5, cy + size * 0.2, cx + size * 0.3, cy + size * 0.7, cx, cy + size * 0.35)
                .bezierCurveTo(cx - size * 0.3, cy + size * 0.7, cx - size * 1.5, cy + size * 0.2, cx, cy - size)
                .fill(color);
            g.moveTo(cx - size * 0.42, cy + size)
                .lineTo(cx + size * 0.42, cy + size)
                .lineTo(cx + size * 0.12, cy + size * 0.3)
                .lineTo(cx - size * 0.12, cy + size * 0.3)
                .closePath()
                .fill(color);
            break;
        }
        case 'club': {
            const r = size * 0.46;
            g.circle(cx, cy - size * 0.42, r).fill(color);
            g.circle(cx - size * 0.6, cy + size * 0.22, r).fill(color);
            g.circle(cx + size * 0.6, cy + size * 0.22, r).fill(color);
            g.moveTo(cx - size * 0.42, cy + size)
                .lineTo(cx + size * 0.42, cy + size)
                .lineTo(cx + size * 0.12, cy + size * 0.25)
                .lineTo(cx - size * 0.12, cy + size * 0.25)
                .closePath()
                .fill(color);
            break;
        }
    }
}
