import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { CARD_ASPECT } from '../cards/atlas';
import { BANKER, GOLD_DEEP, MUTED, PLAYER } from '../../theme';

/**
 * 桌面上那兩個牌位。
 *
 * 改版把發牌區放大到整個上半部之後，冒出一個改版前不存在的問題：**下注的十五秒裡
 * 那塊地方是全黑的**。改版前它只有兩百多 px 高，空著看起來像留白；放大之後空著就
 * 看起來像沒載入。
 *
 * 真實桌台不會有這個問題，因為檯面上印著閒／莊的牌位——**桌子不發牌的時候仍然
 * 看得出它是一張桌子**。所以這裡把那兩個框畫出來：牌發下來時正好落在框裡，
 * 沒牌時它們就是桌面的圖案。
 *
 * 視訊桌台不需要這個東西，它的檯面本來就在影片裡（那是拍到的真桌）。
 */

/** 框比牌組本身放大多少。太貼會像把牌關在盒子裡，太鬆就不像一組 */
const PAD_RATIO = 0.22;

export class DealSpots extends Container {
    private readonly frame = new Graphics();
    private readonly playerLabel: Text;
    private readonly bankerLabel: Text;

    constructor() {
        super();
        // 具名給驗證腳本用：直屏曾經整組超出畫面（見 baccarat/index.ts 的 placeCards）
        this.label = 'deal-spots';
        this.addChild(this.frame);
        this.playerLabel = label(PLAYER);
        this.bankerLabel = label(BANKER);
        this.addChild(this.playerLabel, this.bankerLabel);
    }

    /** 已經翻譯好的閒／莊。語言換了要重叫 */
    public setLabels(player: string, banker: string): void {
        this.playerLabel.text = player.toUpperCase();
        this.bankerLabel.text = banker.toUpperCase();
    }

    /**
     * 照牌位中心與牌寬重畫。
     *
     * 兩個參數都由 `placeCards` 算好——**框不自己決定位置**，不然版面一改就會跟牌錯開，
     * 而那種錯開看起來像框畫歪了，不像座標不同步。
     */
    public place(player: { x: number; y: number }, banker: { x: number; y: number }, cardW: number): void {
        // 框住的是**兩張原牌**，上面留半張補牌的餘裕。
        //
        // 一度把整張補牌都包進去（+1.3 倍牌寬），結果框在寬螢幕上高達三百 px，而牌只有
        // 一百三——沒發牌的時候那是兩個大黑洞，比原本什麼都不畫還糟。真實桌台的牌位
        // 也只框原牌，補牌是橫著擱在旁邊的。
        const w = cardW * (2.24 + PAD_RATIO);
        const h = cardW * CARD_ASPECT * (1 + PAD_RATIO) + cardW * 0.6;
        const r = Math.max(6, cardW * 0.12);

        const g = this.frame;
        g.clear();
        for (const [at, color] of [
            [player, PLAYER],
            [banker, BANKER],
        ] as const) {
            // 底色壓得很低（4%）：它要能在近黑的背景上被看見，又不能在牌蓋上來時
            // 從牌的邊緣透出一圈顏色
            g.roundRect(at.x - w / 2, at.y - h * 0.62, w, h, r).fill({ color, alpha: 0.035 });
            g.roundRect(at.x - w / 2, at.y - h * 0.62, w, h, r).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.3 });
        }

        // 標籤釘在框**內側的左下角**。
        //
        // 上方不能放：補牌橫放在原牌之上，橫向範圍正好是框的中段、上緣還高過框頂，
        // 六個字母的標籤怎麼擺都會被壓到一半。左下角則是這張桌上唯一「牌永遠不會蓋到」
        // 的地方——原牌的下緣在框底之上，而那行點數是置中的。
        const labelY = player.y + h * 0.38 - 7;
        const size = Math.min(13, Math.max(8, cardW * 0.15));
        this.playerLabel.style.fontSize = size;
        this.bankerLabel.style.fontSize = size;
        this.playerLabel.position.set(player.x - w / 2 + 9, labelY);
        this.bankerLabel.position.set(banker.x - w / 2 + 9, labelY);
    }
}

function label(fill: number): Text {
    const t = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 2.4,
            fill: MUTED,
            stroke: { color: fill, width: 0 },
        }),
    });
    t.anchor.set(0, 1);
    t.alpha = 0.7;
    return t;
}
