import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { SeatInfo } from '../../net/games/baccarat';
import { GOLD, GOLD_DEEP, GOOD, HOT, INK, MUTED, TEXT } from '../../theme';

/**
 * 桌邊的一張椅子。
 *
 * 它存在的理由不是裝飾——**籌碼要從某個地方飛出來**。沒有座位的話，別人的注只能
 * 從畫面邊緣冒出來，玩家就讀不出「這一注是誰押的」，滿桌籌碼會退化成一團動態噪音。
 * 有了頭像之後，「那個押很重的人又押莊了」這件事才看得出來。
 *
 * 空位也要畫。真實桌台的空椅子是有意義的資訊（這桌人多不多），而且**位置要固定**：
 * 空位不畫的話，剩下的人會擠過來重排，看起來像所有人同時換了座位。
 */

/**
 * 頭像圓的直徑相對於整個座位寬度。
 *
 * 這個數字直接決定座位看起來多大——座位框本身不小，小的是圓。0.52 的時候 78px 寬的
 * 位置只畫得出 40px 的圓，六張椅子散在桌邊像六顆小鈕扣，讀不出「那裡坐著人」。
 * 剩下的寬度是留給名字的，名字比圓窄不要緊（它可以疊在鄰座的留白上），圓不能。
 */
const AVATAR_RATIO = 0.62;

/**
 * 窄畫面維持原本的比例。那裡的座位只分到 38px 高的一條，圓跟著長大就會壓到底下的注區——
 * **放大是為了「看得清楚坐著誰」，在一條 38px 的帶子上本來就做不到**，硬放大只是換一種糊。
 */
const AVATAR_RATIO_COMPACT = 0.52;

/** 名字離頭像圓下緣多遠。文字改成頂端對齊之後，這個數字就是真的間距 */
const NAME_GAP = 4;
/** 餘額接在名字底下的距離 */
const BALANCE_GAP = 2;

export class SeatView extends Container {
    private readonly ring = new Graphics();
    private readonly initial: Text;
    /** 玩家名字。不能叫 `name`——那是 Pixi Container 自己的欄位，會撞型別 */
    private readonly nameText: Text;
    private readonly balance: Text;
    /** 結算時往上飄的輸贏數字 */
    private readonly delta: Text;

    private info: SeatInfo | null = null;
    private w = 64;
    private compact = false;

    private deltaTween: gsap.core.Tween | null = null;

    constructor() {
        super();
        this.addChild(this.ring);

        this.initial = label('', 15, TEXT, '700');
        this.nameText = label('', 10, MUTED, '500');
        this.balance = label('', 10, GOLD_DEEP, '700');
        this.delta = label('', 13, GOOD, '700');
        this.delta.alpha = 0;

        // label() 統一給置中錨點，這裡把圓外面的三行改掉：y 一旦是文字的中心，
        // 「離圓下緣 3px」實際上是「文字上緣壓進圓裡 3px」，字級一改重疊程度還會跟著變。
        // 改成貼著圓的那一側對齊，y 就是肉眼看到的間距，跟字級無關
        this.nameText.anchor.set(0.5, 0);
        this.balance.anchor.set(0.5, 0);
        this.delta.anchor.set(0.5, 1);

        this.addChild(this.initial);
        this.addChild(this.nameText);
        this.addChild(this.balance);
        this.addChild(this.delta);
    }

    /** 傳 null＝這張椅子空著。 */
    public setInfo(info: SeatInfo | null): void {
        this.info = info;
        this.redraw();
    }

    public getInfo(): SeatInfo | null {
        return this.info;
    }

    /**
     * `compact` 是給窄畫面用的：只留頭像與名字，餘額藏起來。
     *
     * 藏餘額而不是整個縮小，是因為**縮小之後三行字都變得讀不出來，等於三樣都沒了**；
     * 砍掉一行則是「少一個資訊，其餘照樣清楚」。窄畫面的取捨要一次砍到底，不要平均分攤。
     */
    public setSeatSize(w: number, compact: boolean): void {
        this.w = w;
        this.compact = compact;
        this.redraw();
    }

    /**
     * 籌碼從這個座位的哪一點飛出來（相對於父層）。
     *
     * 取頭像圓心而不是整個座位的中心：名字與餘額在下方，用整體中心的話籌碼會從
     * 文字裡飛出來，看起來像字在噴東西。
     */
    public originPoint(): { x: number; y: number } {
        return { x: this.x, y: this.y };
    }

    /**
     * 結算後飄一個輸贏數字。
     *
     * 只在**贏**的時候飄綠色、輸的時候飄紅色，沒押的座位什麼都不飄——每局每個座位都
     * 飄一個 0 的話，畫面上會有六個數字同時往上跑，真正重要的那個反而被淹掉。
     */
    public flashDelta(amount: number): void {
        if (amount === 0) return;

        this.deltaTween?.kill();
        this.delta.text = amount > 0 ? `+${amount.toLocaleString()}` : amount.toLocaleString();
        this.delta.style.fill = amount > 0 ? GOOD : HOT;
        this.delta.alpha = 1;
        this.delta.y = -this.avatarR() - 4;

        this.deltaTween = gsap.to(this.delta, {
            y: -this.avatarR() - 22,
            alpha: 0,
            duration: 1.1,
            ease: 'power1.out',
        });
    }

    /** 收掉動畫。玩法卸載時呼叫 */
    public stop(): void {
        this.deltaTween?.kill();
        this.deltaTween = null;
        gsap.killTweensOf(this.delta);
    }

    private avatarR(): number {
        return (this.w * (this.compact ? AVATAR_RATIO_COMPACT : AVATAR_RATIO)) / 2;
    }

    private redraw(): void {
        const r = this.avatarR();
        const g = this.ring;
        g.clear();

        if (!this.info) {
            // 空位：只有一圈很淡的框。用實線而不是虛線——12px 的圓上畫虛線只會變成一串雜點
            g.circle(0, 0, r).fill({ color: INK, alpha: 0.5 });
            g.circle(0, 0, r).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.3 });
            this.initial.text = '';
            this.nameText.text = '';
            this.balance.text = '';
            return;
        }

        g.circle(0, 0, r).fill({ color: this.info.tint, alpha: 0.9 });
        g.circle(0, 0, r).stroke({ color: GOLD, width: 1.5, alpha: 0.7 });

        this.initial.text = this.info.name.slice(0, 1).toUpperCase();
        this.initial.style.fontSize = Math.max(10, r * 0.9);
        this.initial.position.set(0, 0);

        // 名字砍掉尾巴的數字，只留前綴——`Dragon4821` 在 60px 寬的位置裡放不下，
        // 而數字部分對玩家沒有意義（它只是為了讓名字不重複）
        this.nameText.text = this.info.name.replace(/\d+$/, '');
        this.nameText.style.fontSize = this.compact ? 9 : 10;
        this.nameText.position.set(0, r + NAME_GAP);

        if (this.compact) {
            this.balance.text = '';
        } else {
            this.balance.text = shortMoney(this.info.balance);
            // 接在名字實際佔掉的高度之後，而不是又一個從圓心量的固定值——
            // 名字在 compact 下會換字級，兩行的間距得跟著它走
            this.balance.position.set(0, r + NAME_GAP + this.nameText.height + BALANCE_GAP);
        }
    }
}

/**
 * 「線上 N,NNN 人」的膠囊。**散客的籌碼從這裡飛出來。**
 *
 * 把散客下注的起點接到「顯示線上人數」的這顆膠囊上，解決的是一個真的問題：
 * 桌上大部分的籌碼來自沒有座位的人，
 * 如果讓它們從畫面邊緣隨機冒出來，玩家會覺得是特效；讓它們從一個**寫著人數的地方**
 * 飛出來，那些籌碼就變成了那個數字的具體化——「喔，那三千人在押莊」。
 */
export class OnlineBadge extends Container {
    private readonly bg = new Graphics();
    private readonly dot = new Graphics();
    private readonly text: Text;
    private pulse: gsap.core.Tween | null = null;

    private w = 96;
    private h = 22;

    constructor(count: number) {
        super();
        this.addChild(this.bg);
        this.addChild(this.dot);

        this.text = label('', 11, GOLD, '700');
        this.text.anchor.set(0, 0.5);
        this.addChild(this.text);

        this.setCount(count);
    }

    public setCount(count: number): void {
        this.text.text = count.toLocaleString();
        this.redraw();
    }

    /** 籌碼從這裡飛出來（相對於父層）。 */
    public originPoint(): { x: number; y: number } {
        return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
    }

    /** 有一批散客的注飛出去時閃一下，把「數字」與「籌碼」連起來 */
    public ping(): void {
        this.pulse?.kill();
        this.dot.alpha = 1;
        this.pulse = gsap.to(this.dot, { alpha: 0.35, duration: 0.5, ease: 'power1.out' });
    }

    public stop(): void {
        this.pulse?.kill();
        this.pulse = null;
        gsap.killTweensOf(this.dot);
    }

    private redraw(): void {
        this.w = Math.max(72, this.text.width + 34);

        this.bg.clear();
        this.bg.roundRect(0, 0, this.w, this.h, this.h / 2).fill({ color: INK, alpha: 0.85 });
        this.bg.roundRect(0, 0, this.w, this.h, this.h / 2).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.6 });

        this.dot.clear();
        this.dot.circle(this.h / 2 + 2, this.h / 2, 3.5).fill({ color: GOOD });
        this.dot.alpha = 0.35;

        this.text.position.set(this.h / 2 + 12, this.h / 2);
    }
}

/** 餘額縮寫。桌邊的位置只有六十幾 px，六位數字硬塞會溢出去 */
function shortMoney(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return String(n);
}

function label(content: string, size: number, fill: number, weight: '500' | '700'): Text {
    const t = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    t.anchor.set(0.5);
    return t;
}
