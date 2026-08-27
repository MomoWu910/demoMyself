import { Application, Container, Graphics, Rectangle, Text, TextStyle, Texture } from 'pixi.js';

/**
 * 籌碼——一樣是畫出來再烘成 atlas。
 *
 * 籌碼比牌更需要 atlas：下注區上會**同時疊著十幾二十顆**，而且每一顆都可能是不同面額。
 * 各自一張 texture 的話，一疊混色籌碼就能吃掉十幾個 draw call；共用 atlas 之後
 * 整桌所有籌碼都在同一批。
 *
 * 面額配色照真實賭場的慣例（見 CHIP_COLOR）——這不是裝飾，是**功能**：荷官要能隔著
 * 一張桌子一眼判斷疊的是多少錢，所以顏色比數字重要。同理，籌碼邊緣那圈分段也不是花紋，
 * 它讓側面疊起來時還數得出有幾顆。
 */

/** atlas 裡每顆籌碼佔的格子（邏輯像素）。 */
export const CHIP_SIZE = 72;

/**
 * 可用的面額，**由小到大**。拆解金額時會反著走，順序不能亂。
 *
 * 這是**面額池**而不是桌上會出現的那幾顆：真實桌台的籌碼架不會把十種面額全攤出來，
 * 玩家自己從池子裡挑五個常用的放在手邊（見 arcade store 的 `chipSet`）。池子放大到
 * 十種是為了讓那個「挑」的動作有意義——五種全選就等於沒得選。
 */
export const CHIP_VALUES = [1, 5, 10, 25, 50, 100, 500, 1000, 5000, 10000] as const;
export type ChipValue = (typeof CHIP_VALUES)[number];

/** 桌上同時擺得下幾顆。籌碼要大到拇指按得準，五顆是 720px 寬度下的上限 */
export const CHIP_SLOTS = 5;

/** 沒設定過的人拿到的那五顆。就是這一頁原本的面額表 */
export const DEFAULT_CHIP_SET: ChipValue[] = [25, 50, 100, 500, 1000];

/**
 * 面額配色照真實賭場的慣例（白 1、紅 5、藍 10、綠 25、橘 50、黑 100、紫 500、金 1000）。
 *
 * 這不是裝飾而是**功能**：荷官要能隔著一張桌子一眼判斷疊的是多少錢，所以顏色比數字
 * 重要。低面額那三顆（1／5／10）與最高那兩顆是這次擴池補上的，一樣照慣例走——
 * 自己配一組好看的顏色，會讓認得真桌的人每一次都要重讀數字。
 */
const CHIP_COLOR: Record<ChipValue, number> = {
    1: 0xdedad2,
    5: 0xb5333d,
    10: 0x2f6fd0,
    25: 0x2e9e5b,
    50: 0xd2761f,
    100: 0x24242f,
    500: 0x7b3fb5,
    1000: 0xd4a017,
    5000: 0x8a3324,
    10000: 0x1c7f86,
};

/**
 * 面額字要用什麼顏色。
 *
 * 只有白籌碼是深色字——**白底白字等於沒有數字**。這一格看起來像小事，但它是整套
 * 擴池唯一會「畫出來才發現壞掉」的地方：其餘九顆的底都夠深，白字一律讀得出來。
 */
const CHIP_INK: Partial<Record<ChipValue, number>> = {
    1: 0x2a2620,
};

/** 面額標籤。上千用 K，籌碼那麼小塞不下五位數還要看得清楚。 */
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
 * 貪心在這裡是正確的而不是近似解：面額表是 1/5/10/25/50/100/500/1K/5K/10K，每一階都能被
 * 更大的那幾階用整數倍湊出來，不會出現「用小額湊反而更少顆」的情況。換一組不規則面額
 * 就要重想——所以面額表跟這支函式綁在同一個檔案裡。
 *
 * **拆解走的是整個池，不是玩家挑出來的那五顆。** 桌上散落的籌碼是在演「這一注有多少錢」，
 * 用玩家的偏好去拆會讓同一筆金額在不同人的畫面上疊出不同高度。
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
    // 邊緣分段在白籌碼上要反過來用深色，否則白底白段等於整顆沒有分段
    const edge = CHIP_INK[value] !== undefined ? 0x2a2620 : 0xffffff;
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
        g.stroke({ color: edge, width: 9, alpha: 0.9 });
    }

    // 內圈與圓心：把面額襯出來，也遮住分段的內緣讓邊界乾淨
    g.circle(mid, mid, r - 11).fill({ color: 0x000000, alpha: 0.16 });
    g.circle(mid, mid, r - 13).fill(c);
    g.circle(mid, mid, r - 13).stroke({ color: edge, width: 1.5, alpha: 0.4 });

    const label = new Text({
        text: chipLabel(value),
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: value >= 1000 ? 20 : 22,
            fontWeight: '800',
            fill: CHIP_INK[value] ?? 0xffffff,
        }),
    });
    label.anchor.set(0.5);
    label.position.set(mid, mid);
    box.addChild(label);

    return box;
}

/**
 * 挑一顆籌碼來代表某個金額。**兩支不是同一件事**，所以分成兩個名字。
 *
 * 這兩支原本是兩張百家樂桌各自的區域函式，而且**都叫 `nearestChip`、實作卻不一樣**：
 * 一邊取「不超過金額的最大面額」（下注飛幣：飛出去的那顆不該比押的錢還大），
 * 另一邊取「數值上最接近的面額」（撒快照籌碼：那是視覺化，只求看起來合理）。
 * 同名不同義是最容易在複製貼上時出事的一種形狀，所以搬上來的時候一併改成兩個講得清楚
 * 的名字，第三款玩法就不必再猜該複製哪一份。
 */

/** 不超過 `amount` 的最大面額。下注時飛出去的那顆用這支 */
export function largestChipUnder(amount: number): ChipValue {
    let best: ChipValue = CHIP_VALUES[0];
    for (const value of CHIP_VALUES) {
        if (value <= amount) best = value;
    }
    return best;
}

/** 數值上最接近 `target` 的面額。撒快照籌碼用這支——它只求看起來合理，不必精確 */
export function nearestChipTo(target: number, pool: readonly ChipValue[] = DEFAULT_CHIP_SET): ChipValue {
    let best = pool[0];
    for (const value of pool) if (Math.abs(value - target) < Math.abs(best - target)) best = value;
    return best;
}
