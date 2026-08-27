import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { GOLD, GOLD_BRIGHT, GOLD_DEEP, INK, IVORY, WELL } from '../../theme';
import { colorOf, POCKET_COUNT, WHEEL_ORDER } from './rules';
import { POCKET_ANGLE, type SpinSample } from './spin';

/**
 * 輪盤本體：斜俯視的橢圓。
 *
 * **整個立體感只靠一件事：先旋轉，再壓扁。**
 *
 * 盤面在數學上是一個繞垂直軸轉的圓，斜著看它就是一個橢圓。要畫出這件事，正確的做法是
 * 把袋位環照**正圓**畫好、讓它繞中心旋轉，然後對外層容器設 `scale.y`——那正好等於
 * 一個正投影。順序反過來（先壓扁成橢圓再旋轉）畫出來的是一個歪掉的橢圓在原地打轉，
 * 那是完全不同的東西，而且一眼就看得出來不對。
 *
 * 球不能用同一招，因為它的半徑會變（從球道掉進袋位環）。它每一幀自己算座標：
 * `x = cx + r·cosθ`、`y = cy + r·sinθ·TILT`，用的是同一個 TILT，所以它跟盤面對得上。
 *
 * 前後遮擋沒有用 z 排序，而是**在最上層畫一道碗的前唇**：球轉到近側時會被它壓掉一截，
 * 轉到遠側時完整露出來。這比每幀改 parent 或排 zIndex 便宜得多，視覺上也更像真的
 * ——真輪盤的碗緣本來就會擋住靠近自己那一側的球。
 */

/** 壓扁比例：0.44 大約是站著俯視一張賭桌的角度 */
const TILT = 0.44;

/** 球道半徑（佔外半徑的比例） */
const TRACK_R = 0.93;
/** 袋位環的外緣與內緣 */
const POCKET_OUT = 0.78;
const POCKET_IN = 0.5;

const RED_FELT = 0xa8323c;
const BLACK_FELT = 0x211d1a;
const GREEN_FELT = 0x2f6b46;

export class RouletteWheel extends Container {
    private readonly bowl = new Graphics();
    /** 壓扁層。轉動發生在它的**子節點**上，它自己只負責把圓變成橢圓 */
    private readonly tilt = new Container();
    private readonly rotor = new Container();
    private readonly pockets = new Graphics();
    private readonly hub = new Graphics();
    private readonly highlight = new Graphics();
    private readonly numbers: Text[] = [];
    private readonly ball = new Graphics();
    private readonly lip = new Graphics();

    private radius = 120;
    /** 目前高亮哪一格（結算後標出中獎袋位）。null = 不標 */
    private marked: number | null = null;

    constructor() {
        super();

        this.tilt.scale.set(1, TILT);
        this.rotor.addChild(this.pockets, this.highlight);

        for (let i = 0; i < POCKET_COUNT; i++) {
            const label = new Text({
                text: String(WHEEL_ORDER[i]),
                style: new TextStyle({ fontFamily: 'Archivo, ui-sans-serif, sans-serif', fontSize: 12, fontWeight: '700', fill: IVORY }),
            });
            label.anchor.set(0.5);
            this.numbers.push(label);
            this.rotor.addChild(label);
        }

        this.rotor.addChild(this.hub);
        this.tilt.addChild(this.rotor);
        this.addChild(this.bowl, this.tilt, this.ball, this.lip);

        // 具名是給驗證腳本用的（Pixi 的 `label`）：介面住在畫布裡，端對端測試沒辦法
        // 用 CSS 選擇器找東西，只能在場景樹裡找——而用位置或子節點順序去猜，改一次繪製就全錯
        this.label = 'roulette-wheel';
        this.ball.label = 'roulette-ball';
    }

    public setRadius(radius: number): void {
        this.radius = radius;
        this.redraw();
    }

    /** 這一幀球與盤在哪裡。**只讀 sample，不自己累加角度**——那是 spin.ts 的責任 */
    public apply(sample: SpinSample): void {
        this.rotor.rotation = sample.wheelAngle;

        const trackR = this.radius * TRACK_R;
        const pocketR = this.radius * ((POCKET_OUT + POCKET_IN) / 2);
        const r = pocketR + (trackR - pocketR) * sample.radius01;

        this.ball.x = Math.cos(sample.ballAngle) * r;
        this.ball.y = Math.sin(sample.ballAngle) * r * TILT;
        // 近的球大、遠的球小。幅度很小（±12%），大了會像在放大縮小而不像有深度
        const depth = 1 + Math.sin(sample.ballAngle) * 0.12;
        this.ball.scale.set(depth);
    }

    /** 標出中獎的那一格。傳 null 取消 */
    public mark(n: number | null): void {
        this.marked = n;
        this.drawHighlight();
    }

    private redraw(): void {
        const R = this.radius;

        this.bowl.clear();
        // 木質外框：三層同心橢圓由深到淺，最外一圈描金
        this.bowl.ellipse(0, 0, R * 1.08, R * 1.08 * TILT).fill({ color: WELL });
        this.bowl.ellipse(0, 0, R * 1.08, R * 1.08 * TILT).stroke({ color: GOLD_DEEP, width: 2, alpha: 0.8 });
        this.bowl.ellipse(0, 0, R, R * TILT).fill({ color: 0x2a211a });
        this.bowl.ellipse(0, 0, R * TRACK_R, R * TRACK_R * TILT).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.55 });

        this.drawPockets();
        this.drawHub();
        this.drawHighlight();

        this.ball.clear();
        this.ball.circle(0, 0, Math.max(3, R * 0.045)).fill({ color: 0xfdfaf2 });
        this.ball.circle(-R * 0.014, -R * 0.014, Math.max(1, R * 0.016)).fill({ color: 0xffffff, alpha: 0.9 });

        /*
         * 碗壁。**這是整個立體感的收尾**，兩道環各講一件事：
         *
         * - 近側（下半）壓一層暗帶：球轉到自己這一側時會被碗緣的陰影蓋過去一截，
         *   而不是憑空消失——半透明而不是實心，因為真的碗壁擋得住光擋不住視線
         * - 遠側（上半）補一道亮邊：光從上方來，對面的內壁會反光
         *
         * 少了這兩道，橢圓看起來就只是一個被壓扁的圓，不像一個碗。
         */
        this.lip.clear();
        ring(this.lip, R * 0.88, R * 1.07, 0, Math.PI, 0x120e0c, 0.5);
        ring(this.lip, R * 0.9, R * 1.06, Math.PI, Math.PI * 2, GOLD_DEEP, 0.22);
        this.lip.scale.set(1, TILT);
    }

    /**
     * 袋位環：37 個楔子。
     *
     * 顏色直接由號碼決定（`colorOf`），不另外存一份表——輪盤上的紅黑順序與桌布上的
     * 紅黑必須是同一個事實，兩份表遲早會有一份被改到。
     */
    private drawPockets(): void {
        const R = this.radius;
        const outer = R * POCKET_OUT;
        const inner = R * POCKET_IN;

        this.pockets.clear();
        for (let i = 0; i < POCKET_COUNT; i++) {
            const n = WHEEL_ORDER[i];
            const from = i * POCKET_ANGLE - POCKET_ANGLE / 2;
            const to = from + POCKET_ANGLE;
            const color = colorOf(n) === 'red' ? RED_FELT : colorOf(n) === 'black' ? BLACK_FELT : GREEN_FELT;

            this.pockets.moveTo(Math.cos(from) * inner, Math.sin(from) * inner);
            this.pockets.arc(0, 0, inner, from, to);
            this.pockets.lineTo(Math.cos(to) * outer, Math.sin(to) * outer);
            this.pockets.arc(0, 0, outer, to, from, true);
            this.pockets.fill({ color });
            this.pockets.stroke({ color: GOLD_DEEP, width: 1, alpha: 0.5 });
        }

        const labelR = (outer + inner) / 2;
        for (let i = 0; i < POCKET_COUNT; i++) {
            const label = this.numbers[i];
            const angle = i * POCKET_ANGLE;
            label.x = Math.cos(angle) * labelR;
            label.y = Math.sin(angle) * labelR;
            // 字腳朝內：站在桌邊的人不管轉到哪一格都讀得到
            label.rotation = angle + Math.PI / 2;
            label.style.fontSize = Math.max(7, R * 0.075);
        }
    }

    /** 轉子中央：金屬十字骨架 ＋ 中心錐。真輪盤靠它把球撥開，畫面上它是最容易辨識轉速的東西 */
    private drawHub(): void {
        const R = this.radius;
        const inner = R * POCKET_IN;

        this.hub.clear();
        this.hub.circle(0, 0, inner).fill({ color: INK });
        this.hub.circle(0, 0, inner).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.7 });

        /*
         * 十字骨架：四條從中心往外收窄的臂。
         *
         * 第一版畫成「中心一點、外緣兩點」的三角形，結果是一顆羅盤星——那是**指北針
         * 的長相**，不是輪盤的。真的轉子是四根等寬收窄的金屬臂，所以四個點都要給，
         * 內側那條邊才有寬度。
         */
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            const dx = Math.cos(a);
            const dy = Math.sin(a);
            const px = -dy;
            const py = dx;
            const w0 = R * 0.05;
            const w1 = R * 0.022;

            this.hub.moveTo(px * w0, py * w0);
            this.hub.lineTo(dx * inner + px * w1, dy * inner + py * w1);
            this.hub.lineTo(dx * inner - px * w1, dy * inner - py * w1);
            this.hub.lineTo(-px * w0, -py * w0);
            this.hub.fill({ color: GOLD_DEEP, alpha: 0.5 });
        }

        this.hub.circle(0, 0, R * 0.14).fill({ color: GOLD_DEEP });
        this.hub.circle(0, 0, R * 0.1).fill({ color: GOLD });
        this.hub.circle(0, 0, R * 0.045).fill({ color: GOLD_BRIGHT });
    }

    private drawHighlight(): void {
        this.highlight.clear();
        if (this.marked === null) return;

        const index = WHEEL_ORDER.indexOf(this.marked as (typeof WHEEL_ORDER)[number]);
        if (index < 0) return;

        const R = this.radius;
        const from = index * POCKET_ANGLE - POCKET_ANGLE / 2;
        const to = from + POCKET_ANGLE;

        this.highlight.moveTo(Math.cos(from) * R * POCKET_IN, Math.sin(from) * R * POCKET_IN);
        this.highlight.arc(0, 0, R * POCKET_IN, from, to);
        this.highlight.lineTo(Math.cos(to) * R * POCKET_OUT, Math.sin(to) * R * POCKET_OUT);
        this.highlight.arc(0, 0, R * POCKET_OUT, to, from, true);
        this.highlight.fill({ color: GOLD_BRIGHT, alpha: 0.35 });
        this.highlight.stroke({ color: GOLD_BRIGHT, width: 2 });
    }
}

/**
 * 畫一段環形（外弧過去、內弧回來）。
 *
 * 抽成函式是因為 Pixi v8 沒有現成的環形 API，而這個「去程用外半徑、回程用內半徑
 * 且方向要相反」的寫法一旦手寫第二次就會有一次把 `true` 忘了——那會畫出一個
 * 扭在一起的圖形，而且不會報錯。
 */
function ring(g: Graphics, inner: number, outer: number, from: number, to: number, color: number, alpha: number): void {
    g.moveTo(Math.cos(from) * outer, Math.sin(from) * outer);
    g.arc(0, 0, outer, from, to);
    g.lineTo(Math.cos(to) * inner, Math.sin(to) * inner);
    g.arc(0, 0, inner, to, from, true);
    g.fill({ color, alpha });
}
