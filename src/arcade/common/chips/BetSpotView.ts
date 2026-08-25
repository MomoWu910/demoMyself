import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { ChipDrop } from './FlyingChips';
import { GOLD, MUTED } from '../../theme';

/**
 * 一個可以下注的區域：一塊圓角底、標題、賠率，以及角落的兩個金額。
 *
 * 放在 `common/` 是因為「下注區」是桌台遊戲的共同零件——百家樂、骰寶、輪盤的
 * 規則天差地遠，但下注區要做的事永遠是這四件：**看得出範圍、點得到、顯示押了多少、
 * 中了要能亮起來**。差異只在標題與賠率，那是玩法傳進來的字。
 *
 * 它不知道自己是哪一區，也不知道賠付規則——點下去只是回報「我被點了」，
 * 要不要加注、加多少由玩法決定。這樣同一個元件才能同時用在「點一下加籌碼」
 * 與「點一下選中」兩種互動上。
 *
 * ---
 *
 * **這裡不再畫自己那疊籌碼了**，這是改成多人桌時最大的一個取捨。
 *
 * 單機桌上只有你一個人押注，把金額疊成一疊籌碼是最好的編碼——高度就是資訊。
 * 但多人桌的注區裡同時有幾十顆別人的籌碼散落著，再在正中間插一疊「自己的」，
 * 兩者會擠在一起，而且**疊高在滿桌籌碼的背景裡完全讀不出來**。
 *
 * 所以自己的注改成角落一行數字，桌面留給散落的籌碼（那些由 FlyingChips 那一層畫）。
 * 資訊沒有變少，只是換了個編碼：**熱鬧程度看籌碼，確切金額看數字。**
 */

/** 角落金額那一行要留多高。字級固定，所以是常數 */
const AMOUNT_H = 15;

export class BetSpotView extends Container {
    private readonly bg = new Graphics();
    private readonly title: Text;
    private readonly odds: Text;
    /** 桌上所有人押在這一區的總額 */
    private readonly totalText: Text;
    /** 我自己押了多少。押了才顯示 */
    private readonly mineText: Text;

    private w = 100;
    private h = 60;
    private readonly color: number;

    /** 中獎時的高亮動畫。換下一局前要收掉，否則會跟新的動畫疊在一起 */
    private glow: gsap.core.Tween | null = null;
    private won = false;

    constructor(opts: { label: string; odds: string; color: number; onTap: () => void }) {
        super();
        this.color = opts.color;

        this.addChild(this.bg);

        this.title = text(opts.label, 15, 0xffffff, '700', 0.5);
        this.odds = text(opts.odds, 11, 0xffffff, '500', 0.5);
        this.odds.alpha = 0.65;
        this.addChild(this.title);
        this.addChild(this.odds);

        // 總額靠左、我的靠右。**兩個數字不能同色**——它們的量級差很多
        // （總額動輒六位數，自己的可能只有三位），同色的話一眼掃過去會以為讀錯了
        this.totalText = text('', 11, MUTED, '500', 0);
        this.mineText = text('', 12, GOLD, '700', 1);
        this.addChild(this.totalText);
        this.addChild(this.mineText);

        // static 就夠了：這個區域不需要滑鼠移動事件，只要點得到。
        // 用 'dynamic' 會讓 Pixi 每幀對它做命中測試，一桌十幾個區加起來不划算
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', opts.onTap);
    }

    public setLabels(label: string, odds: string): void {
        this.title.text = label;
        this.odds.text = odds;
    }

    /**
     * 兩個金額。
     *
     * 總額**永遠顯示**（就算是 0），因為「這一區沒人押」本身也是資訊；
     * 自己的注**押了才顯示**，沒押時空著比寫個 0 乾淨。
     */
    public setAmounts(total: number, mine: number): void {
        this.totalText.text = total > 0 ? total.toLocaleString() : '—';
        this.mineText.text = mine > 0 ? mine.toLocaleString() : '';
    }

    public setBoxSize(w: number, h: number): void {
        this.w = w;
        this.h = h;
        this.layout();
    }

    /**
     * 籌碼可以落在哪裡——**這個函式就是「不擋到注區名稱」的實作**。
     *
     * 隨機落點聽起來只要 `random() * w` 就好，但那樣有一半的籌碼會蓋在標題與賠率上，
     * 而標題正是玩家在最後五秒搶著押的時候唯一需要看清楚的東西。前公司那套用的是
     * 一組叫 `bound_limit` 的邊界內縮（`{ top: 25, bottom: 5 }`），意思一模一樣：
     * **上緣讓開文字，下緣讓開金額，左右讓開一顆籌碼的半徑不要溢出去。**
     *
     * 內縮之後還要保證剩下的區域不會是負的——注區在手機橫放時只有 30px 高，
     * 硬扣完會變成反向的範圍，`random` 出來的點會落到框外面去。
     *
     * 回傳值除了絕對座標，還帶一組 **`u`／`v`（0~1 的相對位置）**。籌碼落定之後版面
     * 還會變（手機轉向、位址列收放、操作面板重新量高度），那時要靠這兩個數字把它搬到
     * 新的注區裡。只存絕對座標的話，注區移動之後桌上的籌碼會整批留在原地。
     *
     * @param chipSize 籌碼直徑。左右與下緣各讓開它的一半
     */
    public randomChipPoint(chipSize: number): ChipDrop {
        const r = chipSize / 2;
        const top = this.titleBottom() + r * 0.5;
        const bottom = this.h - AMOUNT_H - r * 0.3;
        const left = r * 0.7;
        const right = this.w - r * 0.7;

        // 空間不夠時退回「中線偏下」的一條窄帶，而不是讓範圍翻轉
        const y0 = Math.min(top, bottom);
        const y1 = Math.max(top, bottom);
        const band = y1 - y0 < 4 ? { lo: this.h * 0.55, hi: this.h * 0.75 } : { lo: y0, hi: y1 };

        const localX = left + Math.random() * Math.max(1, right - left);
        const localY = band.lo + Math.random() * Math.max(1, band.hi - band.lo);

        return {
            x: this.x + localX,
            y: this.y + localY,
            u: localX / Math.max(1, this.w),
            v: localY / Math.max(1, this.h),
        };
    }

    /** 這一區當下的框（跟 `randomChipPoint` 同一個座標系）。重排時拿來換算籌碼的新位置 */
    public rect(): { x: number; y: number; w: number; h: number } {
        return { x: this.x, y: this.y, w: this.w, h: this.h };
    }

    /** 這一區的中心（全域座標，跟 randomChipPoint 同一個座標系）。回收動畫用 */
    public centre(): { x: number; y: number } {
        return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
    }

    /**
     * 中獎高亮。
     *
     * 用**呼吸式的透明度**而不是換一個亮色底：換底色會讓人一時分不清是中獎還是被選中，
     * 而會動的東西在一桌靜止的區塊裡一眼就找得到。
     */
    public setWin(won: boolean): void {
        if (this.won === won) return;
        this.won = won;
        this.glow?.kill();
        this.glow = null;

        if (!won) {
            this.alpha = 1;
            this.redraw();
            return;
        }

        this.redraw();
        this.glow = gsap.to(this, { alpha: 0.55, duration: 0.42, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    /** 收掉動畫。玩法卸載時呼叫。 */
    public stop(): void {
        this.glow?.kill();
        this.glow = null;
    }

    /** 標題與賠率那一段的下緣。籌碼落點與版面都從這裡推 */
    private titleBottom(): number {
        return this.h * 0.16 + this.odds.style.fontSize * 2 + 4;
    }

    private layout(): void {
        this.redraw();
        this.title.position.set(this.w / 2, this.h * 0.16);
        this.odds.position.set(this.w / 2, this.h * 0.16 + 15);
        this.totalText.position.set(5, this.h - AMOUNT_H);
        this.mineText.position.set(this.w - 5, this.h - AMOUNT_H - 1);
    }

    private redraw(): void {
        const g = this.bg;
        g.clear();
        g.roundRect(0, 0, this.w, this.h, 10).fill({ color: this.color, alpha: this.won ? 0.3 : 0.13 });
        g.roundRect(0, 0, this.w, this.h, 10).stroke({
            color: this.color,
            width: this.won ? 2.5 : 1.5,
            alpha: this.won ? 1 : 0.55,
        });
        // 命中範圍跟著底一起換。不設的話 Pixi 會用 bounds，
        // 而 bounds 會被文字撐大，變成點在區域外面也算數
        this.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= this.w && y >= 0 && y <= this.h };
    }
}

function text(content: string, size: number, fill: number, weight: '500' | '700', anchorX: number): Text {
    const t = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    t.anchor.set(anchorX, 0);
    return t;
}
