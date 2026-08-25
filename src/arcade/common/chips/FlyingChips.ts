import gsap from 'gsap';
import { Container, Sprite } from 'pixi.js';
import { CHIP_SIZE, type ChipAtlas, type ChipValue } from './atlas';

/**
 * 桌面上所有飛來飛去的籌碼——**一整層，一個池子**。
 *
 * 為什麼需要它：多人桌在下注那十幾秒裡，每秒有十幾顆籌碼從各個方向飛進注區。
 * 一局下來上百顆，一小時幾千顆。如果每顆都 `new Sprite()` 再 `destroy()`，
 * 產生的垃圾足以讓 GC 在下注中途停頓——而那正好是畫面最忙的時候，一卡就很明顯。
 *
 * 所以走物件池：sprite 只在開場建一次，之後**永遠不銷毀，只換貼圖與位置**。
 * 前公司那套也是同一個手法（`BetChipManager.addChipsToPool`），這不是巧合——
 * 只要籌碼會一顆一顆飛，就都會走到這個結論。
 *
 * ---
 *
 * 這一層還負責**桌面上到底能有幾顆籌碼**。這件事看起來像效能調校，實際上是
 * 正確性問題：不設上限的話，一個掛在背景跑了十分鐘的分頁會累積上萬顆 sprite，
 * 然後在你切回來的那一刻整頁凍住。
 */

/**
 * 桌上最多同時存在幾顆籌碼。
 *
 * 前公司那套抓 200（`MAX_ALLCHIPS_COUNT`）。這裡取 160——我們的注區比較小，
 * 再多就只是把注區塗滿，看不出誰押得重。
 *
 * 超過上限時**回收最舊的那一顆**而不是拒絕新的。這個選擇有差：拒絕新的會讓
 * 「最後五秒大家搶著押」那一波完全看不到，而那正是一局裡最有戲的一段。
 */
const MAX_RESIDENT = 160;

/** 池子預先建好幾顆。開場一次付清，之後不再配置 */
const POOL_SIZE = MAX_RESIDENT + 40;

/** 一顆籌碼飛多久。太快看不到起點是誰，太慢會在畫面上塞車 */
const FLY_TIME = 0.42;
/** 回收時飛多快。比飛進來快——結算已經定案，沒必要讓人等 */
const RECYCLE_TIME = 0.3;

export interface ChipPoint {
    x: number;
    y: number;
}

/**
 * 一顆籌碼要落在哪：絕對座標，**外加它在注區裡的相對位置**。
 *
 * 為什麼要多帶 `u`／`v`：籌碼會在桌上待到這一局結算，而版面在這段期間會變
 * （手機轉向、位址列收放、操作面板重新量高度都會觸發重排）。只記絕對座標的話，
 * 注區搬走了，桌上的籌碼會整批留在原地——那正是「已經發到位的籌碼跑版」。
 */
export interface ChipDrop extends ChipPoint {
    /** 在注區裡的水平位置，0 = 左緣、1 = 右緣 */
    u: number;
    /** 在注區裡的垂直位置，0 = 上緣、1 = 下緣 */
    v: number;
}

/** 注區當下的框。重排時由呼叫端提供，用來把 `u`／`v` 換算回絕對座標 */
export interface SpotRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** 桌面上一顆已經落定（或正在飛）的籌碼。 */
interface LiveChip {
    sprite: Sprite;
    /** 押在哪一區。回收時要靠它判斷這顆是贏是輸，重排時要靠它找新的框 */
    spot: string;
    /** 誰押的。贏了要飛回這個人面前 */
    seat: number;
    /** 在注區裡的相對位置。版面變了就靠它重算 */
    u: number;
    v: number;
    tween: gsap.core.Tween | null;
}

export class FlyingChips extends Container {
    private readonly atlas: ChipAtlas;

    /** 沒在用的 sprite。取用從尾端 pop，O(1) */
    private readonly pool: Sprite[] = [];
    /** 桌上的籌碼，**依落桌順序**。超過上限時從頭砍，所以順序不能亂 */
    private live: LiveChip[] = [];

    /** 一顆畫多大（直徑，畫面像素）。跟著版面縮放 */
    private size = 24;

    constructor(atlas: ChipAtlas) {
        super();
        this.atlas = atlas;

        // 一次建滿。分批建（用到才建）看起來比較聰明，但那樣第一次下注潮
        // 仍然會在最忙的時候配置記憶體——池子的意義就是把成本挪到沒人在看的時候
        for (let i = 0; i < POOL_SIZE; i++) {
            const sprite = new Sprite();
            sprite.anchor.set(0.5);
            sprite.visible = false;
            this.addChild(sprite);
            this.pool.push(sprite);
        }
    }

    public setChipSize(size: number): void {
        this.size = size;
        const scale = size / CHIP_SIZE;
        for (const chip of this.live) chip.sprite.scale.set(scale);
    }

    /**
     * 飛一顆籌碼：從 `from` 飛到 `to`。
     *
     * `delay` 讓同一批的籌碼錯開出發，看起來才像好幾個人各自丟出來的，
     * 而不是一次齊射。
     */
    public fly(value: ChipValue, spot: string, seat: number, from: ChipPoint, to: ChipDrop, delay = 0): void {
        const chip = this.take(value, spot, seat, to);
        if (!chip) return;

        chip.sprite.position.set(from.x, from.y);
        chip.sprite.alpha = 0;
        // 起飛時比落點大一點，落定縮回去——**這一點點縮放就是「往桌面深處飛」的錯覺**，
        // 沒有它的話籌碼看起來只是在平面上滑動
        chip.sprite.scale.set((this.size / CHIP_SIZE) * 1.25);

        chip.tween = gsap.to(chip.sprite, {
            x: to.x,
            y: to.y,
            alpha: 1,
            duration: FLY_TIME,
            delay,
            ease: 'power2.out',
            onStart: () => {
                chip.sprite.alpha = 1;
            },
        });
        gsap.to(chip.sprite.scale, {
            x: this.size / CHIP_SIZE,
            y: this.size / CHIP_SIZE,
            duration: FLY_TIME,
            delay,
            ease: 'power2.out',
        });
    }

    /**
     * 直接擺一顆在桌上，不飛。
     *
     * 中途進桌時用：快照裡的注是**已經發生過的事**，補演一次飛行動畫等於騙玩家
     * 說這些注是他坐下之後才押的。
     */
    public place(value: ChipValue, spot: string, seat: number, at: ChipDrop): void {
        const chip = this.take(value, spot, seat, at);
        if (!chip) return;
        chip.sprite.position.set(at.x, at.y);
        chip.sprite.alpha = 1;
        chip.sprite.scale.set(this.size / CHIP_SIZE);
    }

    /**
     * 結算回收：贏的注區飛回押注的人面前，輸的飛向莊家然後淡出。
     *
     * 這一段是多人桌**最值得做對的演出**。玩家在這幾秒裡讀的不是數字，是「錢往哪裡去」——
     * 看到自己那區的籌碼往自己飛，比餘額跳一個數字有感得多；看到別人的籌碼被莊家收走，
     * 也才知道剛才那些注是真的有人押的。
     *
     * @param won         哪些注區贏了
     * @param seatPoints  每個座位的頭像在哪。查不到的（已經離桌）就往 `house` 飛
     * @param house       莊家的位置，輸掉的籌碼往那裡收
     * @param onDone      全部收完之後（給下一局清場用）
     */
    public recycle(
        won: (spot: string) => boolean,
        seatPoints: (seat: number) => ChipPoint | null,
        house: ChipPoint,
        onDone: () => void
    ): void {
        const chips = this.live;
        this.live = [];

        if (chips.length === 0) {
            onDone();
            return;
        }

        let pending = chips.length;
        const finish = (chip: LiveChip): void => {
            this.release(chip);
            pending--;
            if (pending === 0) onDone();
        };

        for (let i = 0; i < chips.length; i++) {
            const chip = chips[i];
            chip.tween?.kill();
            gsap.killTweensOf(chip.sprite);
            gsap.killTweensOf(chip.sprite.scale);

            const target = won(chip.spot) ? (seatPoints(chip.seat) ?? house) : house;
            chip.tween = gsap.to(chip.sprite, {
                x: target.x,
                y: target.y,
                alpha: 0,
                duration: RECYCLE_TIME,
                // 錯開出發，看起來像被一把一把掃走而不是瞬間消失。
                // 用 i 的餘數而不是 i 本身——注區滿的時候 160 顆乘上任何間隔都太久
                delay: (i % 12) * 0.02,
                ease: 'power1.in',
                onComplete: () => finish(chip),
            });
        }
    }

    /**
     * 版面變了：把桌上的籌碼搬到注區的新位置。
     *
     * 這是 `u`／`v` 存在的唯一理由。注意**正在飛的那幾顆也要處理**——它們的 tween
     * 目標是舊座標，放著不管會飛到注區已經不在的地方去。飛到一半的直接讓它就位：
     * 重排的當下整個畫面都在動，少一段飛行沒人看得出來，而籌碼落在錯的地方很明顯。
     *
     * @param rectOf 查某一區當下的框。查不到（那一區還沒排版）就跳過那顆
     */
    public relayout(rectOf: (spot: string) => SpotRect | null): void {
        const scale = this.size / CHIP_SIZE;

        for (const chip of this.live) {
            const rect = rectOf(chip.spot);
            if (!rect) continue;

            if (chip.tween) {
                chip.tween.kill();
                chip.tween = null;
                gsap.killTweensOf(chip.sprite);
                gsap.killTweensOf(chip.sprite.scale);
                chip.sprite.alpha = 1;
                chip.sprite.scale.set(scale);
            }

            chip.sprite.position.set(rect.x + chip.u * rect.w, rect.y + chip.v * rect.h);
        }
    }

    /** 立刻清光（換靴、離桌、重排版面）。不做動畫 */
    public clearAll(): void {
        for (const chip of this.live) this.release(chip);
        this.live = [];
    }

    /** 收掉所有動畫。玩法卸載時呼叫 */
    public stop(): void {
        for (const chip of this.live) {
            chip.tween?.kill();
            gsap.killTweensOf(chip.sprite);
            gsap.killTweensOf(chip.sprite.scale);
        }
    }

    /**
     * 從池子拿一顆出來。池子空了就**回收最舊的那一顆**。
     *
     * 回 null 只可能發生在池子本身是空的（POOL_SIZE 設成 0），留著這條路徑是為了
     * 讓呼叫端不必假設它永遠成功。
     */
    private take(value: ChipValue, spot: string, seat: number, at: ChipDrop): LiveChip | null {
        if (this.live.length >= MAX_RESIDENT) {
            const oldest = this.live.shift();
            if (oldest) this.release(oldest);
        }

        const sprite = this.pool.pop();
        if (!sprite) return null;

        const texture = this.atlas.frames.get(value);
        if (!texture) {
            this.pool.push(sprite);
            return null;
        }

        sprite.texture = texture;
        sprite.visible = true;
        // **z 序要跟著落桌順序走**：新的壓在舊的上面，才像一疊一疊堆起來的。
        // 不重排的話新籌碼會鑽到早就落定的那些下面，看起來像穿模
        this.setChildIndex(sprite, this.children.length - 1);

        const chip: LiveChip = { sprite, spot, seat, u: at.u, v: at.v, tween: null };
        this.live.push(chip);
        return chip;
    }

    /** 還回池子。**不 destroy**——那正是池子存在的理由 */
    private release(chip: LiveChip): void {
        chip.tween?.kill();
        chip.tween = null;
        gsap.killTweensOf(chip.sprite);
        gsap.killTweensOf(chip.sprite.scale);
        chip.sprite.visible = false;
        chip.sprite.alpha = 1;
        this.pool.push(chip.sprite);
    }
}
