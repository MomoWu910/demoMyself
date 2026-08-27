import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../../../i18n';
import type { Rect } from '../../common/table/tableLayout';
import { GOLD_BRIGHT, GOLD_DEEP, INK, IVORY, MUTED } from '../../theme';
import { colorOf } from './rules';

/**
 * 開獎歷史：最近的號碼，加三條比例條。
 *
 * **輪盤不該有路圖，這是刻意的。** 百家樂的五張路圖之所以成立，是因為那一靴牌會被
 * 一路發完——牌少一張，下一局的機率就真的變了，所以「走勢」在數學上不是完全的幻覺。
 * 輪盤沒有這回事：每一局都是獨立事件，球不記得上一局停在哪。把它畫成大路那種
 * 「連莊連閒」的圖，等於在暗示一個不存在的規律。
 *
 * 所以這裡呈現的是**統計而不是走勢**：最近開了什麼、紅黑各佔多少、單雙大小的比例。
 * 這些數字真實桌台的看板上也有，玩家愛看，而它們至少不騙人——它們講的是已經發生的事，
 * 沒有暗示接下來會發生什麼。
 */

const RED_FELT = 0xa8323c;
const BLACK_FELT = 0x2a2522;
const GREEN_FELT = 0x2f6b46;

/** 比例條看最近幾局。太少會劇烈跳動，太多就永遠停在 50% 附近沒有變化 */
const WINDOW = 24;

/** 三條比例條各比什麼。左邊那半的判定函式，右邊就是其餘的號碼 */
const BARS: Array<{ left: string; right: string; test: (n: number) => boolean; leftColor: number }> = [
    { left: 'arcade.rou.red', right: 'arcade.rou.black', test: (n) => colorOf(n) === 'red', leftColor: RED_FELT },
    { left: 'arcade.rou.odd', right: 'arcade.rou.even', test: (n) => n % 2 === 1, leftColor: 0x7fa8bd },
    { left: 'arcade.rou.low', right: 'arcade.rou.high', test: (n) => n <= 18, leftColor: 0x86a86b },
];

export class HistoryView extends Container {
    private readonly bg = new Graphics();
    private readonly dots = new Graphics();
    private readonly bars = new Graphics();
    private readonly caption: Text;
    /** 還沒開過任何一局時的提示。**空白的看板跟壞掉的看板長得一樣** */
    private readonly empty: Text;
    private readonly barLabels: Text[] = [];
    private readonly numbers: Text[] = [];

    private rect: Rect = { x: 0, y: 0, w: 200, h: 60 };
    private history: number[] = [];

    constructor() {
        super();
        this.caption = label(t('arcade.rou.recent'), MUTED, 10);
        this.caption.anchor.set(0, 0.5);
        this.empty = label(t('arcade.rou.noHistory'), MUTED, 10);
        this.addChild(this.bg, this.dots, this.bars, this.caption, this.empty);

        for (let i = 0; i < BARS.length * 2; i++) {
            const node = label('', IVORY, 9);
            node.anchor.set(i % 2 === 0 ? 0 : 1, 0.5);
            this.barLabels.push(node);
            this.addChild(node);
        }
    }

    public setRect(rect: Rect): void {
        this.rect = rect;
        this.redraw();
    }

    public setHistory(history: number[]): void {
        this.history = history;
        this.redraw();
    }

    public refreshLabels(): void {
        this.caption.text = t('arcade.rou.recent');
        this.empty.text = t('arcade.rou.noHistory');
        this.redraw();
    }

    private redraw(): void {
        const { x, y, w, h } = this.rect;

        this.bg.clear();
        this.bg.roundRect(x, y, w, h, 8).fill({ color: INK, alpha: 0.85 });
        this.bg.roundRect(x, y, w, h, 8).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.5 });

        const pad = Math.max(6, h * 0.08);
        this.caption.position.set(x + pad, y + pad + 6);
        this.caption.style.fontSize = Math.max(8, h * 0.075);

        this.drawDots(x + pad, y + pad + 20, w - pad * 2, h * 0.34);
        this.drawBars(x + pad, y + h * 0.52, w - pad * 2, h * 0.44 - pad);

        this.empty.visible = this.history.length === 0;
        this.empty.position.set(x + w / 2, y + pad + 20 + h * 0.17);
        this.empty.style.fontSize = Math.max(8, h * 0.075);
    }

    /**
     * 最近的號碼。
     *
     * 新的在左邊，跟真實看板一樣。畫成圓點而不是方格，是為了跟百家樂那五張路圖
     * **一眼就分得出來**——同一個遊樂場裡兩種不同性質的歷史，長得像的話玩家會
     * 拿讀路圖的方式去讀它。
     */
    private drawDots(x: number, y: number, w: number, h: number): void {
        this.dots.clear();

        const r = Math.min(h / 2, w / 28);
        const gap = r * 2.4;
        const count = Math.min(this.history.length, Math.floor(w / gap));

        while (this.numbers.length < count) {
            const node = label('', IVORY, 9);
            this.numbers.push(node);
            this.addChild(node);
        }
        for (let i = 0; i < this.numbers.length; i++) this.numbers[i].visible = i < count;

        for (let i = 0; i < count; i++) {
            const n = this.history[i];
            const cx = x + r + i * gap;
            const cy = y + h / 2;
            const color = colorOf(n) === 'red' ? RED_FELT : colorOf(n) === 'black' ? BLACK_FELT : GREEN_FELT;

            this.dots.circle(cx, cy, r).fill({ color });
            // 最新的那一顆描金：它是玩家真正在找的東西
            if (i === 0) this.dots.circle(cx, cy, r).stroke({ color: GOLD_BRIGHT, width: 1.5 });

            const node = this.numbers[i];
            node.text = String(n);
            node.style.fontSize = Math.max(6, r * 0.95);
            node.position.set(cx, cy);
        }
    }

    private drawBars(x: number, y: number, w: number, h: number): void {
        this.bars.clear();

        const recent = this.history.slice(0, WINDOW);
        const rowH = h / BARS.length;
        const barH = Math.max(3, rowH * 0.34);

        for (let i = 0; i < BARS.length; i++) {
            const spec = BARS[i];
            const hits = recent.filter(spec.test).length;
            // 0 不屬於任何一邊，所以分母是「有效局數」而不是取樣數——
            // 用取樣數當分母的話，兩邊加起來永遠不到 100%，那條線看起來就像畫錯了
            const valid = recent.filter((n) => n !== 0).length;
            const ratio = valid === 0 ? 0.5 : hits / valid;

            const rowY = y + i * rowH;
            const barY = rowY + rowH - barH - 2;

            this.bars.roundRect(x, barY, w, barH, barH / 2).fill({ color: 0x2a2522 });
            if (ratio > 0 && valid > 0) {
                this.bars.roundRect(x, barY, Math.max(barH, w * ratio), barH, barH / 2).fill({ color: spec.leftColor });
            }

            const left = this.barLabels[i * 2];
            const right = this.barLabels[i * 2 + 1];
            const size = Math.max(7, rowH * 0.36);
            // 還沒有資料時寫「—」而不是 50%：那個 50% 是**沒有根據的**，
            // 而它看起來跟「開了二十局剛好一半一半」一模一樣
            left.text = valid === 0 ? `${t(spec.left)} —` : `${t(spec.left)} ${Math.round(ratio * 100)}%`;
            right.text = valid === 0 ? `— ${t(spec.right)}` : `${Math.round((1 - ratio) * 100)}% ${t(spec.right)}`;
            left.style.fontSize = size;
            right.style.fontSize = size;
            left.position.set(x, rowY + rowH * 0.3);
            right.position.set(x + w, rowY + rowH * 0.3);
        }
    }
}

function label(content: string, fill: number, size: number): Text {
    const node = new Text({
        text: content,
        style: new TextStyle({ fontFamily: 'Archivo, ui-sans-serif, sans-serif', fontSize: size, fontWeight: '700', fill }),
    });
    node.anchor.set(0.5);
    return node;
}
