import { Application, Container, Graphics, Rectangle, Text, TextStyle, Texture } from 'pixi.js';

/**
 * 籌碼——一樣是畫出來再烘成 atlas。
 *
 * 籌碼比牌更需要 atlas：下注區上會**同時疊著十幾二十顆**，而且每一顆都可能是不同面額。
 * 各自一張 texture 的話，一疊混色籌碼就能吃掉十幾個 draw call；共用 atlas 之後
 * 整桌所有籌碼都在同一批。
 *
 * 面額配色照真實賭場的慣例（綠 25、藍 50、黑 100、紫 500、金 1000）——這不是裝飾，
 * 是**功能**：荷官要能隔著一張桌子一眼判斷疊的是多少錢，所以顏色比數字重要。
 * 同理，籌碼邊緣那圈白色分段也不是花紋，它讓側面疊起來時還數得出有幾顆。
 */

/** atlas 裡每顆籌碼佔的格子（邏輯像素）。 */
export const CHIP_SIZE = 72;

/** 可用的面額，**由小到大**。拆解金額時會反著走，順序不能亂。 */
export const CHIP_VALUES = [25, 50, 100, 500, 1000] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

const CHIP_COLOR: Record<ChipValue, number> = {
    25: 0x2e9e5b,
    50: 0x2f6fd0,
    100: 0x24242f,
    500: 0x7b3fb5,
    1000: 0xd4a017,
};

/** 面額標籤。上千用 K，籌碼那麼小塞不下四位數還要看得清楚。 */
export function chipLabel(value: number): string {
    return value >= 1000 ? `${value / 1000}K` : String(value);
}

export interface ChipAtlas {
    frames: Map<ChipValue, Texture>;
    source: Texture;
}

export function bakeChipAtlas(app: Application): ChipAtlas {
    const strip = new Container();
    for (let i = 0; i < CHIP_VALUES.length; i++) {
        const chip = drawChip(CHIP_VALUES[i]);
        chip.x = i * CHIP_SIZE;
        strip.addChild(chip);
    }

    const resolution = Math.min(window.devicePixelRatio || 1, 2);
    const source = app.renderer.generateTexture({
        target: strip,
        resolution,
        frame: new Rectangle(0, 0, CHIP_SIZE * CHIP_VALUES.length, CHIP_SIZE),
    });
    strip.destroy({ children: true });

    const frames = new Map<ChipValue, Texture>();
    for (let i = 0; i < CHIP_VALUES.length; i++) {
        frames.set(
            CHIP_VALUES[i],
            new Texture({ source: source.source, frame: new Rectangle(i * CHIP_SIZE, 0, CHIP_SIZE, CHIP_SIZE) })
        );
    }

    return { frames, source };
}

/**
 * 把一筆金額拆成一疊籌碼，**由大到小貪心取**。
 *
 * 貪心在這裡是正確的而不是近似解：面額表是 25/50/100/500/1000，每一階都是前面幾階的
 * 整數倍組合，不會出現「用小額湊反而更少顆」的情況。換一組不規則面額就要重想——
 * 所以面額表跟這支函式綁在同一個檔案裡。
 *
 * 超過上限的顆數會被截斷：桌上疊三十顆跟疊十顆看起來一樣高，但後者少畫二十個 sprite。
 */
export function toChipStack(amount: number, maxChips = 12): ChipValue[] {
    const stack: ChipValue[] = [];
    let left = Math.floor(amount);

    for (let i = CHIP_VALUES.length - 1; i >= 0; i--) {
        const value = CHIP_VALUES[i];
        while (left >= value && stack.length < maxChips) {
            stack.push(value);
            left -= value;
        }
    }

    return stack;
}

/** 一顆籌碼畫在 CHIP_SIZE 見方的格子裡，原點在左上。 */
function drawChip(value: ChipValue): Container {
    const box = new Container();
    const g = new Graphics();
    box.addChild(g);

    const c = CHIP_COLOR[value];
    const mid = CHIP_SIZE / 2;
    const r = mid - 4;

    g.circle(mid, mid, r).fill(c);

    // 邊緣的白色分段：真實籌碼靠它在疊起來時數顆數。六段是最常見的配置
    const segments = 6;
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / segments / 2;
        g.moveTo(mid + Math.cos(a0) * (r - 9), mid + Math.sin(a0) * (r - 9));
        g.arc(mid, mid, r - 4.5, a0, a1);
        g.stroke({ color: 0xffffff, width: 9, alpha: 0.9 });
    }

    // 內圈與圓心：把面額襯出來，也遮住分段的內緣讓邊界乾淨
    g.circle(mid, mid, r - 11).fill({ color: 0x000000, alpha: 0.16 });
    g.circle(mid, mid, r - 13).fill(c);
    g.circle(mid, mid, r - 13).stroke({ color: 0xffffff, width: 1.5, alpha: 0.4 });

    const label = new Text({
        text: chipLabel(value),
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: value >= 1000 ? 20 : 22,
            fontWeight: '800',
            fill: 0xffffff,
        }),
    });
    label.anchor.set(0.5);
    label.position.set(mid, mid);
    box.addChild(label);

    return box;
}
