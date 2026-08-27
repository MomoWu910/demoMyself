import { Container, Text, TextStyle } from 'pixi.js';
import { GOLD, MUTED, TEXT } from '../../theme';

/**
 * 一排讀數：本局押注、上一局輸贏、牌靴、延遲。
 *
 * 這塊東西原本是底部面板裡的 `.stat`（DOM）。搬上桌之後位置換到左上角，而排法**橫排
 * 而不是直排**——這是被座位逼出來的：直排三格有一百多 px 高，左邊那一欄正好是三張
 * 椅子的地盤，兩者會疊在一起。橫排只吃頂上一條 34px 的帶子，而那條帶子本來就是空的
 * （頂列與中央區之間）。
 *
 * 每一格仍然是「標籤在上、數值在下」的兩行，跟原本 DOM 的排法一致——**同一種資訊
 * 不該因為換了畫布就換一種讀法**。
 */

/** 一格佔多高（標籤 + 數值）。字級固定，所以這是常數而不是比例 */
const ROW_H = 34;
/** 兩格之間留多寬。窄一點會讓「上一局」跟「牌靴」的數字看起來像同一個數 */
const GAP = 22;

export interface StatSpec {
    /** 已經翻譯好的標籤。這個元件不碰 i18n——它不知道自己在哪一款玩法裡 */
    label: string;
    value: string;
    /** 標成金色。給「這一格現在值得看」用（贏錢、延遲過高） */
    hot?: boolean;
}

export class StatStrip extends Container {
    private rows: Array<{ label: Text; value: Text }> = [];
    private scale$ = 1;
    private measured = 0;

    /**
     * 換一組讀數。
     *
     * 每次都整組重寫文字而不是 diff：一格只有兩個 `Text`，重寫的成本比比對低，
     * 而且**格數會變**——視訊桌台在展開／收起串流讀數時就是不同的格數。
     */
    public setStats(stats: StatSpec[]): void {
        while (this.rows.length < stats.length) {
            const label = text(9.5, MUTED, '700');
            const value = text(15, TEXT, '600');
            this.addChild(label, value);
            this.rows.push({ label, value });
        }

        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];
            const spec = stats[i];
            row.label.visible = row.value.visible = Boolean(spec);
            if (!spec) continue;

            row.label.text = spec.label.toUpperCase();
            row.value.text = spec.value;
            row.value.style.fill = spec.hot ? GOLD : TEXT;
        }

        this.relayout();
    }

    /** 大螢幕整組放大。字級跟著 uiScale 走，不然 4K 上這一排會小得像浮水印 */
    public setScale$(scale: number): void {
        this.scale$ = scale;
        this.relayout();
    }

    public get height$(): number {
        return ROW_H * this.scale$;
    }

    /** 這一排實際多寬。呼叫端拿它避開右邊的東西（更多鈕） */
    public get width$(): number {
        return this.measured;
    }

    private relayout(): void {
        const k = this.scale$;
        let x = 0;
        for (const row of this.rows) {
            if (!row.label.visible) continue;
            row.label.style.fontSize = 9.5 * k;
            row.value.style.fontSize = 15 * k;
            row.label.position.set(x, 0);
            row.value.position.set(x, 13 * k);
            // 欄寬由**兩行裡較寬的那一行**決定。只看數值的話，「THIS HAND」這種長標籤
            // 會壓到下一格的數字上
            x += Math.max(row.label.width, row.value.width) + GAP * k;
        }
        this.measured = Math.max(0, x - GAP * k);
    }
}

function text(size: number, fill: number, weight: '600' | '700'): Text {
    const t = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            letterSpacing: weight === '700' ? 1.1 : 0,
            fill,
        }),
    });
    t.anchor.set(0, 0);
    return t;
}
