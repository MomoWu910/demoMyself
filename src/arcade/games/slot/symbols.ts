import { Application, Container, Graphics, Rectangle, Text, TextStyle, Texture } from 'pixi.js';
import { Sym, SYMBOLS } from './rules';
import { BG, METAL, WELL } from '../../theme';

/**
 * 符號的長相——**在 runtime 畫出來，再烘成一張 atlas**，不載任何圖檔。
 *
 * 兩個理由，第二個才是重點：
 *
 * 1. 零素材、零授權問題。老虎機的符號（櫻桃、BAR、7）是公版視覺語彙，畫得出來就不必找圖。
 *
 * 2. **這正是 atlas 該解決的問題的最小示範**。七個符號如果各自是一張 texture，
 *    轉軸上同時出現不同符號時，renderer 每換一種符號就得換一次 texture、斷一次 batch——
 *    畫面上十幾顆 sprite 可以吃掉十幾個 draw call。烘進同一張 atlas 之後，
 *    它們共用同一個 texture source，整個轉軸不論出現哪些符號都只是**一次** draw call。
 *
 * 烘的時機是進玩法時一次，之後只是取 frame，不再有繪製成本。RenderTexture 由呼叫端
 * track 起來，卸載玩法時跟著回收（見 core/module.ts）。
 */

/** 每個符號在 atlas 裡佔的格子邊長（邏輯像素）。轉軸顯示時再縮放到實際大小。 */
export const CELL = 128;

/**
 * 符號的主色。
 *
 * 這一頁刻意跟站台其他頁**不同調**——那些頁是冷色極簡，這裡是黑金。
 * 符號因此收在金屬色階與少數幾個壓過飽和度的實物色裡（櫻桃是紅的、檸檬是黃的，
 * 那個不能改），而不是原本那套霓虹。**盤面上七個符號同時出現**，
 * 只要有一個是螢光色，整台機器就會拉回廉價感。
 */
const COLOR: Record<Sym, number> = {
    [Sym.Cherry]: 0xb23342,
    [Sym.Lemon]: 0xd9c05a,
    [Sym.Bell]: METAL.gold,
    [Sym.Bar]: METAL.steel,
    [Sym.Seven]: 0xc2454f,
    [Sym.Wild]: METAL.champagne,
    [Sym.Scatter]: 0x7d8c5e,
};

export interface SymbolAtlas {
    /** 每個符號切好的 frame，直接餵給 Sprite */
    frames: Map<Sym, Texture>;
    /** 底層那張烘出來的圖。要 track 它，回收才會真的把 GPU 記憶體還回去。 */
    source: Texture;
}

/**
 * 把所有符號畫成橫排一列，烘成一張 texture，再切成每個符號的 frame。
 *
 * resolution 跟著螢幕走（上限 2）：烘出來的圖之後只會被縮小顯示，
 * 用 1 倍在 retina 上會糊，用 3 倍以上則是白付 GPU 記憶體。
 */
export function bakeSymbolAtlas(app: Application): SymbolAtlas {
    const strip = new Container();
    for (let i = 0; i < SYMBOLS.length; i++) {
        const g = drawSymbol(SYMBOLS[i]);
        g.x = i * CELL;
        strip.addChild(g);
    }

    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const source = app.renderer.generateTexture({
        target: strip,
        resolution,
        // 明確指定範圍，不讓它依 bounds 自動推算——描邊會讓 bounds 比格子大一點點，
        // 切 frame 時就會整排偏移
        frame: new Rectangle(0, 0, CELL * SYMBOLS.length, CELL),
    });

    // 烘完就不需要這些 Graphics 了，留著只是佔記憶體
    strip.destroy({ children: true });

    const frames = new Map<Sym, Texture>();
    for (let i = 0; i < SYMBOLS.length; i++) {
        frames.set(
            SYMBOLS[i],
            new Texture({ source: source.source, frame: new Rectangle(i * CELL, 0, CELL, CELL) })
        );
    }

    return { frames, source };
}

/** 一個符號畫在 CELL×CELL 的格子裡，原點在左上。 */
function drawSymbol(sym: Sym): Container {
    const box = new Container();
    const c = COLOR[sym];
    const g = new Graphics();
    box.addChild(g);

    // 共用的底：一塊圓角暗牌，讓每個符號都有一致的落腳處，轉軸上才不會看起來高低不齊
    g.roundRect(6, 6, CELL - 12, CELL - 12, 18).fill({ color: WELL, alpha: 0.92 });
    g.roundRect(6, 6, CELL - 12, CELL - 12, 18).stroke({ color: c, width: 2, alpha: 0.5 });

    const mid = CELL / 2;

    switch (sym) {
        case Sym.Cherry: {
            // 兩顆果實 + 一段梗。梗用兩條曲線從同一點分出去，看起來才是連在一起的
            g.moveTo(mid + 4, 30).quadraticCurveTo(mid + 26, 52, mid + 24, 74);
            g.moveTo(mid + 4, 30).quadraticCurveTo(mid - 20, 54, mid - 22, 72);
            g.stroke({ color: 0x7d8c5e, width: 4 });
            g.circle(mid - 24, 88, 17).fill(c);
            g.circle(mid + 24, 90, 17).fill(c);
            // 高光：一顆果實上的小亮點，是讓平塗看起來有體積最省事的一筆
            g.circle(mid - 30, 82, 5).fill({ color: 0xffffff, alpha: 0.55 });
            break;
        }
        case Sym.Lemon: {
            g.ellipse(mid, mid + 4, 30, 22).fill(c);
            // 兩端的尖：檸檬跟橢圓的差別就在這兩點
            g.moveTo(mid - 34, mid + 4).lineTo(mid - 26, mid + 4);
            g.moveTo(mid + 26, mid + 4).lineTo(mid + 34, mid + 4);
            g.stroke({ color: c, width: 5 });
            g.ellipse(mid - 9, mid - 4, 9, 6).fill({ color: 0xffffff, alpha: 0.45 });
            break;
        }
        case Sym.Bell: {
            // 鐘體：上窄下寬，底部收一條橫樑
            g.moveTo(mid - 30, 84)
                .quadraticCurveTo(mid - 28, 40, mid, 34)
                .quadraticCurveTo(mid + 28, 40, mid + 30, 84)
                .lineTo(mid - 30, 84)
                .fill(c);
            g.roundRect(mid - 34, 84, 68, 9, 4).fill({ color: c, alpha: 0.85 });
            g.circle(mid, 100, 7).fill(c); // 鈴舌
            g.circle(mid - 12, 52, 5).fill({ color: 0xffffff, alpha: 0.5 });
            break;
        }
        case Sym.Bar: {
            g.roundRect(mid - 40, mid - 17, 80, 34, 8).fill(c);
            box.addChild(label('BAR', BG, 24, mid, mid));
            break;
        }
        case Sym.Seven: {
            box.addChild(label('7', c, 76, mid, mid + 2));
            break;
        }
        case Sym.Wild: {
            // 菱形襯底 + 字。Wild 要一眼跟水果類分開，所以用幾何形而不是具象物件
            g.moveTo(mid, 26).lineTo(CELL - 26, mid).lineTo(mid, CELL - 26).lineTo(26, mid).closePath().fill(c);
            box.addChild(label('W', BG, 44, mid, mid));
            break;
        }
        case Sym.Scatter: {
            star(g, mid, mid, 38, 17, 6).fill(c);
            g.circle(mid, mid, 9).fill({ color: BG, alpha: 0.85 });
            break;
        }
    }

    return box;
}

/** 置中的文字。符號上的字都用站台的顯示字體，跟其他頁維持同一個字面。 */
function label(text: string, color: number, size: number, x: number, y: number): Text {
    const t = new Text({
        text,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: '900',
            fill: color,
            letterSpacing: text.length > 1 ? 1 : 0,
        }),
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    return t;
}

/** n 角星。外徑內徑交替取點，是畫星形最短的寫法。 */
function star(g: Graphics, cx: number, cy: number, outer: number, inner: number, points: number): Graphics {
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + (i * Math.PI) / points;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
    }
    g.closePath();
    return g;
}
