import { Container, Sprite, Text, TextStyle } from 'pixi.js';
import { CHIP_SIZE, toChipStack, type ChipAtlas } from './atlas';

/**
 * 下注區上的一疊籌碼。
 *
 * 為什麼要疊出來而不是寫個數字：**籌碼的高度就是資訊**。真實桌上玩家掃一眼就知道
 * 誰押得重，靠的是疊高與顏色而不是讀數字。這是把「同一份資料換一種編碼」做到最省的例子——
 * 底下仍然是一個金額，但它同時被畫成高度與顏色。
 *
 * 金額還是照樣寫在旁邊：疊高只讀得出數量級，要對帳仍然得看數字。
 */
export class ChipStack extends Container {
    private readonly atlas: ChipAtlas;
    private readonly chips = new Container();
    /** 金額文字。不能叫 label——那是 Pixi Container 自己的欄位（字串），會撞型別 */
    private readonly amountText: Text;

    /** 一顆籌碼畫多大（直徑，畫面像素）。 */
    private size: number;

    private amount = 0;

    constructor(atlas: ChipAtlas, size = 34) {
        super();
        this.atlas = atlas;
        this.size = size;

        this.addChild(this.chips);

        this.amountText = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 13,
                fontWeight: '700',
                fill: 0xffffff,
                dropShadow: { color: 0x000000, alpha: 0.7, blur: 4, distance: 0, angle: 0 },
            }),
        });
        this.amountText.anchor.set(0.5, 0);
        this.addChild(this.amountText);

        this.setAmount(0);
    }

    public getAmount(): number {
        return this.amount;
    }

    public setSize(size: number): void {
        this.size = size;
        this.rebuild();
    }

    public setAmount(amount: number): void {
        this.amount = Math.max(0, Math.floor(amount));
        this.rebuild();
    }

    /**
     * 重建整疊。
     *
     * 每次都全部重畫而不是增量加減：一疊最多十幾個 sprite，重建的成本遠低於維護
     * 「上次疊了什麼、這次要加減哪幾顆」的狀態——而那個狀態一旦跟金額對不上，
     * 畫面上的錢就會跟帳上的不一樣，是最不該為了省效能而冒的險。
     */
    private rebuild(): void {
        this.chips.removeChildren().forEach((c) => c.destroy());

        if (this.amount <= 0) {
            this.amountText.text = '';
            this.visible = false;
            return;
        }
        this.visible = true;

        const values = toChipStack(this.amount);
        const scale = this.size / CHIP_SIZE;
        // 每顆往上錯開一點點，看起來才是疊起來的而不是重疊在一起。
        // 0.16 是側面看得到分段又不會太鬆散的比例
        const step = this.size * 0.16;

        for (let i = 0; i < values.length; i++) {
            const texture = this.atlas.frames.get(values[i]);
            if (!texture) continue;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.scale.set(scale);
            sprite.y = -i * step;
            this.chips.addChild(sprite);
        }

        this.amountText.y = this.size * 0.5 + 3;
        this.amountText.text = this.amount.toLocaleString();
    }
}
