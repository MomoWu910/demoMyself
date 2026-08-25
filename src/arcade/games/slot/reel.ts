import gsap from 'gsap';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { ROWS } from './rules';
import { Sym, SYMBOLS, WEIGHTS } from './rules';

/**
 * 一根轉軸。
 *
 * **這裡是整個 demo 最能看出「博弈前端跟一般動畫不一樣」的地方。**
 *
 * 直覺的寫法是「轉一轉、隨機停、看停到什麼算什麼」。真的機台不能這樣做——結果是伺服器
 * 算好的（見 net/protocol.ts），前端拿到的是**已經確定的三個符號**，任務是把轉動演到
 * 那裡剛好停住。所以轉軸的介面不是 `stop()` 而是 `stopAt(symbols)`。
 *
 * 於是產生一個真實專案裡必然要處理的問題：轉動中的帶子上是隨機內容，怎麼讓它「剛好」
 * 停在指定的三格？答案是**在停止前改寫帶子**——把即將滑進可視窗的那幾格直接寫成目標值。
 * 玩家看不出來，因為那幾格此刻還在窗外。這是老虎機的通行做法，不是取巧。
 *
 * 停軸不是一個緩動就結束，而是**三段接力**：等速 → 減速滑行 → 對齊回彈。中間任何一刻
 * 轉軸都在動，沒有靜止的空檔。這件事看起來瑣碎，但少了中間那段減速，停止會像被按了
 * 暫停鍵；而如果錯開停軸的延遲是用「先停住、等一下再演」做的，玩家會看到後面幾根軸
 * 站在原地排隊——那是最傷手感的一種寫法。
 *
 * 減速段是**距離驅動**而不是時間驅動：先算定落點，再讓速度隨「已走完的比例」線性衰減，
 * 走完該走的距離自然交棒。好處是落點在減速開始的當下就已經確定，帶子可以趁那幾格還在
 * 十格之外時就改寫完畢。
 *
 * 另外兩件事值得看：
 *   - 帶子有幾十格，但**只用 ROWS+2 個 sprite**循環復用（改 texture 與 y），
 *     不是每格一個 sprite。轉軸再長，場景樹上的物件數都是固定的。
 *   - 最後一格用 back.out 的回彈：過頭一點再彈回來。這是老虎機「重量感」的收尾。
 */

/**
 * 捲動方向：`-1` = 符號往下掉（真機幾乎都是這個方向），`+1` = 往上跑。
 *
 * 抽成常數而不是散在各處改正負號，是因為方向同時牽動三件事：sprite 往哪邊位移、
 * 帶子索引往哪邊長、以及停止時該改寫帶子的哪幾格。散著改很容易只改到其中兩個，
 * 症狀是「轉起來方向對了，但停下來差一格」——那種 bug 光看畫面找不出來。
 *
 * 實際做法是讓 `offset` 永遠是遞增的「已捲過的格數」，方向只在 `layout()` 換算成
 * 有號的捲動位置。這樣停止落點的計算（取整、往前推幾格、緩動到定點）完全不必管方向。
 */
const DIR = -1;

/** 帶子長度。夠長才不會在等速轉動時看出重複的規律。 */
const STRIP_LEN = 32;

/** 可視窗外多留幾個 sprite，捲動時上下邊界才不會出現「憑空冒出來」的一格。 */
const POOL = ROWS + 2;

/** 等速轉動的速度（格／秒）。 */
const SPIN_SPEED = 26;

/** 加速到等速要多久（秒）。 */
const SPIN_UP = 0.28;

/** 減速滑行的距離（格）。這段也決定了「按下去不會馬上停」的最短轉動量。 */
const COAST_CELLS = 10;

/** 滑行結束時的速度（格／秒）。要接近回彈段的初速，交棒才不會有頓點。 */
const COAST_END_SPEED = 10;

/** 回彈段走幾格。只走一格，因為此時已經慢到看得清符號了。 */
const SNAP_CELLS = 1;

/** 回彈段時長（秒）。 */
const SNAP_TIME = 0.42;

/**
 * 滑行距離的**下限**（格）。
 *
 * 落點的三格是在滑行開始的當下改寫的（見 beginCoast），所以那一刻它們必須還在可視窗外，
 * 不然玩家會當場看到符號憑空換掉。可視窗高 ROWS 格，再留半格的餘裕。
 * **快速模式與按停都會壓縮這段距離，這個下限就是它們壓不下去的那條線。**
 */
const MIN_COAST_CELLS = ROWS + 0.5;

/**
 * 轉動快慢。玩法逐把傳進來，轉軸整把沿用同一檔——中途切換不會讓這一把改到一半。
 *
 * 時間與距離**兩個都要縮**：只縮時間、不縮滑行距離的話，同一段路要在更短的時間走完，
 * 速度會飆到看不出符號是什麼。那不是「快」，是「糊」。
 */
export type SpinTempo = 'normal' | 'turbo';

export const TEMPO: Record<SpinTempo, { time: number; coast: number }> = {
    normal: { time: 1, coast: 1 },
    turbo: { time: 0.33, coast: 0.33 },
};

/**
 * 玩家按停之後，剩下的滑行只走這麼多格。壓到不能再壓——就是上面那條線。
 */
const SLAM_COAST_CELLS = MIN_COAST_CELLS;

/** 按停之後的回彈時長。回彈仍要有：一格都不彈會像畫面凍住，而不是像停住。 */
const SLAM_SNAP_TIME = 0.12;

/** 按停時若已經在回彈，就把那段緩動加速幾倍播完，而不是硬切到終點。 */
const SLAM_SETTLE_SCALE = 3;

/**
 * 中獎格子脈動一趟多久、來回幾趟。
 *
 * 抽成常數是為了讓外面算得出**整段演出要播多久**——自動連轉要等它播完才排下一把，
 * 而那個等待時間寫死一個數字的話，改了這裡就會悄悄對不上（見 autoGap.ts）。
 */
const HIGHLIGHT_STEP = 0.32;
const HIGHLIGHT_REPEAT = 3;

/** 脈動整段的實際長度（秒）。yoyo 的 repeat n 表示總共播 n+1 趟。 */
export const HIGHLIGHT_SEC = HIGHLIGHT_STEP * (HIGHLIGHT_REPEAT + 1);

/**
 * 起轉的兩種演法。玩法可以逐把切換（面板上的開關），轉軸本身不記得上一把用哪種。
 *
 *   - `direct`：按下去就往主方向加速。乾淨俐落。
 *   - `windup`：先往**反方向**拉一小段再衝出去，像拉弓。多花約 0.2 秒換一個蓄力的預期感，
 *     這是很多真機的起轉演法。
 */
export type SpinStyle = 'direct' | 'windup';

/** 蓄力往回拉幾格。超過半格就會露出上一把的符號，看起來像轉軸打滑。 */
const WINDUP_CELLS = 0.34;

/** 蓄力的時長（秒）。 */
const WINDUP_TIME = 0.2;

/**
 * 轉軸的狀態。
 *
 * `spinning` 與 `coasting` 由 `update()` 每幀推進，`winding` 與 `settling` 交給 gsap，
 * `idle` 不動。用一個 enum 而不是幾個布林，是因為這些狀態互斥——布林組合會生出
 * 「又在滑行又在回彈」這種不存在的狀態，然後在某一把出現對不上的落點。
 */
type Phase = 'idle' | 'winding' | 'spinning' | 'coasting' | 'settling';

export interface ReelOptions {
    frames: Map<Sym, Texture>;
    /** 一格的寬高（像素） */
    cellW: number;
    cellH: number;
}

export class Reel extends Container {
    private frames: Map<Sym, Texture>;
    private cellW: number;
    private cellH: number;

    /** 帶子內容。停止前會被改寫（見 class 說明）。 */
    private strip: Sym[] = [];

    /** 捲動位置，單位是「格」，連續值。整數部分是帶子索引，小數部分是格內偏移。 */
    private offset = 0;

    private sprites: Sprite[] = [];
    private windowMask: Graphics;
    private spinTween: gsap.core.Tween | null = null;
    private settleTween: gsap.core.Tween | null = null;
    /** 錯開停軸用的排程。等待期間轉軸照常等速轉，不是停著等。 */
    private stopDelay: gsap.core.Tween | null = null;
    private highlights: gsap.core.Tween[] = [];

    /** 目前的捲動速度（格／秒）。加速與滑行都是改它，不是直接改 offset。 */
    private speed = 0;

    /**
     * 距離「加速完成、進入等速」還剩幾秒。`spin()` 設定，`update()` 每幀扣掉。
     *
     * 存的是**剩餘時間**而不是「起轉的時刻」，是為了不引進第二個時基：轉軸的每幀邏輯
     * 走 Pixi 的 ticker，停軸的排程走 gsap 的 ticker，兩邊各有各的時間原點，用時刻去比
     * 遲早會對不上。剩餘時間只跟 delta 有關，兩邊都成立。
     */
    private spinUpLeft = 0;

    private phase: Phase = 'idle';

    /** 減速滑行的起訖（offset 座標）與起始速度。 */
    private coastFrom = 0;
    private coastTo = 0;
    private coastStartSpeed = SPIN_SPEED;

    /** 最終落點（offset 座標，整數格）。減速開始的當下就算定。 */
    private snapTarget = 0;

    /** 停穩時要 resolve 的那個 Promise。跨越好幾幀，只能存起來。 */
    private resolveStop: (() => void) | null = null;

    /** 這一把的快慢檔。spin() 時決定，整把不變。 */
    private tempo: SpinTempo = 'normal';

    /** 玩家這一把按過停沒有。滑行距離與回彈時長都看它。 */
    private slammed = false;

    /**
     * server 給的落點，`stopAt` 存下來的。
     *
     * `slam()` 需要它：玩家按停的那一刻若結果還沒回來，這裡是 null，**那就什麼都不能做**——
     * client 沒有落點就沒有停下來的權利，只能記著旗標等結果進來（見 stopAt）。
     */
    private pendingSymbols: Sym[] | null = null;

    constructor(opts: ReelOptions) {
        super();
        this.frames = opts.frames;
        this.cellW = opts.cellW;
        this.cellH = opts.cellH;

        for (let i = 0; i < STRIP_LEN; i++) this.strip.push(randomSymbol());

        for (let i = 0; i < POOL; i++) {
            const s = new Sprite();
            s.anchor.set(0.5);
            s.x = this.cellW / 2;
            s.width = this.cellW;
            s.height = this.cellH;
            this.sprites.push(s);
            this.addChild(s);
        }

        // 可視窗以外要裁掉，否則緩衝用的那兩格會露在轉軸上下
        this.windowMask = new Graphics();
        this.addChild(this.windowMask);
        this.mask = this.windowMask;

        this.resize(opts.cellW, opts.cellH);
    }

    /**
     * 換格子尺寸（畫布縮放時）。
     *
     * sprite 的寬高直接寫死而不是用 scale，是因為 atlas 的 frame 尺寸固定（見 symbols.ts 的 CELL），
     * 用 width/height 指定目標大小，Pixi 自己換算縮放比，之後改 atlas 解析度這裡不用跟著改。
     * 遮罩也要一起重畫——它是 Graphics，尺寸不會自己跟著走。
     */
    public resize(cellW: number, cellH: number): void {
        this.cellW = cellW;
        this.cellH = cellH;

        for (const s of this.sprites) {
            s.x = cellW / 2;
            s.width = cellW;
            s.height = cellH;
        }

        this.windowMask.clear().rect(0, 0, cellW, cellH * ROWS).fill(0xffffff);
        this.layout();
    }

    /** 目前的格子尺寸。中獎線要照它算座標，不能用 Container 的 bounds（會被遮罩與空隙影響）。 */
    public getCellSize(): { w: number; h: number } {
        return { w: this.cellW, h: this.cellH };
    }

    /** 目前是否還在轉（含滑行與回彈）。 */
    public isSpinning(): boolean {
        return this.phase !== 'idle';
    }

    /**
     * 起轉。加速到等速後就一直轉，等 stopAt 給結果。
     *
     * `windup` 會先往反方向拉一小段再衝。蓄力這段是**位置驅動**（直接 tween offset），
     * 不是靠 speed——這段要走的距離不到半格，用速度去湊反而難控制它停在哪。
     */
    public spin(style: SpinStyle = 'direct', tempo: SpinTempo = 'normal'): void {
        this.killTweens();
        this.speed = 0;
        this.tempo = tempo;
        this.slammed = false;
        this.pendingSymbols = null;

        const t = TEMPO[tempo].time;
        this.spinUpLeft = (style === 'windup' ? WINDUP_TIME * t : 0) + SPIN_UP * t;

        if (style !== 'windup') {
            this.accelerate();
            return;
        }

        this.phase = 'winding';
        // offset 是主方向的進度，所以「往回拉」就是讓它變小，不必管主方向朝上還朝下
        this.spinTween = gsap.to(this, {
            offset: this.offset - WINDUP_CELLS,
            duration: WINDUP_TIME * t,
            ease: 'power2.out',
            onUpdate: () => this.layout(),
            onComplete: () => this.accelerate(),
        });
    }

    /** 加速到等速。蓄力結束後也走這裡。 */
    private accelerate(): void {
        this.phase = 'spinning';
        this.spinTween = gsap.to(this, { speed: SPIN_SPEED, duration: SPIN_UP * TEMPO[this.tempo].time, ease: 'power1.in' });
    }

    /**
     * 收到結果，停到指定的三個符號上。回傳一個在完全停住時 resolve 的 Promise。
     *
     * `delay` 讓呼叫端把五根轉軸錯開停——一起停會像畫面卡住，逐根停才有節奏。
     *
     * 注意這個延遲**不能**用 gsap tween 自己的 `delay`：那只是延後緩動開始，等待期間
     * 轉軸是不動的，玩家會看到後面幾根軸停住排隊。這裡改用 delayedCall 排程，等待期間
     * 維持等速轉動，時間到了才切進減速段。
     *
     * 另外，`delay` 是**從等速那一刻起算**，不是從收到結果起算。這件事不直覺，但少了它
     * 停軸順序會亂掉，原因在滑行段是距離驅動的（見 beginCoast）：距離固定，所以起始速度
     * 越慢、滑行反而拖越久。滿速進滑行約 0.63 秒走完，龜速進去要 1.05 秒——差距比
     * STOP_STAGGER 還大。而 RTT 通常短於「蓄力 + 加速」的總時長，於是第一根軸幾乎必然
     * 在還沒加速完就收到結果，用最慢的速度進滑行，被後面滿速的軸反超。等大家都到等速
     * 再起算，五根軸的滑行時間才一致，順序與間隔就完全由 STOP_STAGGER 決定。
     *
     * 順帶一提這樣**整體反而更快**：多等的那點加速時間，比龜速滑行多花的時間少。
     */
    public stopAt(symbols: Sym[], delay = 0): Promise<void> {
        return new Promise((resolve) => {
            this.resolveStop?.(); // 上一把若還懸著（理論上不會），先放掉免得呼叫端等不到
            this.resolveStop = resolve;
            this.pendingSymbols = symbols;

            // 玩家在結果回來之前就按了停。那一刻 slam() 無事可做（沒有落點），
            // 旗標就留到這裡兌現：不等錯開、也不等加速完，落點一到直接進滑行
            if (this.slammed) {
                this.beginCoast(symbols);
                return;
            }

            const wait = Math.max(0, this.spinUpLeft) + delay;
            if (wait > 0) {
                this.stopDelay = gsap.delayedCall(wait, () => {
                    this.stopDelay = null;
                    this.beginCoast(symbols);
                });
            } else {
                this.beginCoast(symbols);
            }
        });
    }

    /**
     * 玩家按了停：把還沒走完的段落全部壓到最短。已經停穩的軸不受影響。
     *
     * **這裡不會挑符號。** 落點永遠來自 server：還沒收到結果時，這個方法只留下一個旗標，
     * 等 `stopAt` 帶著落點進來才兌現。反過來做——client 先挑一組符號停住、等結果到了再修正
     * ——會讓畫面出現一組不是 server 給的盤面，那正好推翻這一頁在證明的事。
     * 代價是按下停之後偶爾還要等一下下，而那個等待就是網路延遲本身。
     */
    public slam(): void {
        if (this.phase === 'idle') return;
        this.slammed = true;

        // 還在等錯開的排程就不必等了
        this.stopDelay?.kill();
        this.stopDelay = null;

        switch (this.phase) {
            case 'winding':
            case 'spinning':
                if (this.pendingSymbols) this.beginCoast(this.pendingSymbols);
                break;
            case 'coasting':
                this.beginSnap();
                break;
            case 'settling':
                // 已經在回彈了，硬切到終點會少掉那個「壓下去又彈起來」的收尾，加速播完就好
                this.settleTween?.timeScale(SLAM_SETTLE_SCALE);
                break;
        }
    }

    /**
     * 進入減速滑行段：算定落點、改寫帶子，之後交給 `update()` 一幀一幀推。
     *
     * 落點在這一刻就能算死，是因為滑行距離是固定的 `COAST_CELLS`——速度怎麼衰減只影響
     * 花多久走完，不影響走多遠。這正好給了改寫帶子的安全窗口：目標那三格此刻還在十格
     * 之外，等它們滑進可視窗時內容早就換好了。
     */
    private beginCoast(symbols: Sym[]): void {
        // 加速中就收到結果的話，加速 tween 還在寫 speed，得先收掉
        this.spinTween?.kill();
        this.spinTween = null;
        this.spinUpLeft = 0;

        // 用當下速度接續，而不是假設已經到等速；下限擋住「才剛起轉就要停」的情況
        this.coastStartSpeed = Math.max(this.speed, COAST_END_SPEED);

        // 按停最短、快速模式次之，但誰都不能低於 MIN_COAST_CELLS——低於它，
        // 待會要改寫的那三格此刻已經在可視窗裡，玩家會看到符號當場換掉
        const coastCells = this.slammed
            ? SLAM_COAST_CELLS
            : Math.max(MIN_COAST_CELLS, COAST_CELLS * TEMPO[this.tempo].coast);

        this.snapTarget = Math.ceil(this.offset + coastCells + SNAP_CELLS);
        this.coastFrom = this.offset;
        this.coastTo = this.snapTarget - SNAP_CELLS;

        // 落點換算成帶子座標才知道要改寫哪幾格——方向朝下時索引是往回長的
        const landing = Math.round(this.snapTarget * DIR);
        for (let row = 0; row < ROWS; row++) {
            this.strip[mod(landing + row, STRIP_LEN)] = symbols[row];
        }

        this.phase = 'coasting';
    }

    /**
     * 最後一格：對齊落點並回彈。
     *
     * 取整數格是必要的——停在半格上，可視窗會卡在兩個符號中間。back.out 會衝過頭一點再
     * 彈回來，轉軸「壓下去又彈起來」的重量感全靠這個。
     */
    private beginSnap(): void {
        this.speed = 0; // 之後由緩動推進 offset，不再靠速度
        this.phase = 'settling';
        this.settleTween = gsap.to(this, {
            offset: this.snapTarget,
            duration: this.slammed ? SLAM_SNAP_TIME : SNAP_TIME * TEMPO[this.tempo].time,
            ease: 'back.out(1.6)',
            onUpdate: () => this.layout(),
            onComplete: () => {
                this.offset = this.snapTarget;
                this.layout();
                this.phase = 'idle';
                this.settleTween = null;
                const done = this.resolveStop;
                this.resolveStop = null;
                done?.();
            },
        });
    }

    /** 每幀推進。等速段與滑行段靠它走，回彈段由 gsap 接管（此時 speed 已歸零）。 */
    public update(deltaSec: number): void {
        // 在 switch 之前扣：蓄力段走的是 default 分支，漏掉的話那 0.2 秒不會被算進去
        if (this.spinUpLeft > 0) this.spinUpLeft = Math.max(0, this.spinUpLeft - deltaSec);

        switch (this.phase) {
            case 'spinning': {
                if (this.speed <= 0) return;
                this.offset += this.speed * deltaSec;
                // offset 會一直長大，久了浮點精度會掉——繞回帶子長度的整數倍，視覺上完全等價。
                // 只能在這一段做：滑行與回彈的落點是絕對座標，中途繞回會讓它們對不上。
                if (this.offset > STRIP_LEN * 1000) this.offset = mod(this.offset, STRIP_LEN);
                this.layout();
                return;
            }

            case 'coasting': {
                /*
                 * 距離驅動：速度由「已走完的比例」決定，而不是由經過的時間決定。
                 * 掉幀時每幀走得多一點、幀數少一點，
                 * 走完的距離與落點完全不受影響——時間驅動就會在卡頓的機器上停歪。
                 */
                const span = this.coastTo - this.coastFrom;
                const progress = span > 0 ? clamp01((this.offset - this.coastFrom) / span) : 1;
                this.speed = this.coastStartSpeed + (COAST_END_SPEED - this.coastStartSpeed) * progress;

                this.offset += this.speed * deltaSec;
                if (this.offset >= this.coastTo) {
                    this.offset = this.coastTo;
                    this.beginSnap();
                }
                this.layout();
                return;
            }

            default:
                return; // settling 由 gsap 推進，idle 不用動
        }
    }

    /**
     * 讓可視窗第 row 格脈動——中獎時用。
     *
     * 由轉軸自己封裝而不是把 sprite 交出去，是因為**這裡的 scale 不是 1**：
     * sprite 的顯示尺寸是用 `width/height` 指定的，Pixi 內部換算成
     * `目標尺寸 ÷ atlas frame 尺寸` 存進 scale。外部若照直覺 tween 到 1，
     * 符號會瞬間縮成 atlas 的原始大小。脈動必須以現值為基準做相對縮放。
     */
    public highlightCell(row: number): void {
        if (this.phase !== 'idle') return;
        const s = this.sprites[row];
        if (!s) return;

        const base = s.scale.x;
        this.highlights.push(
            gsap.fromTo(
                s.scale,
                { x: base, y: base },
                {
                    x: base * 1.14,
                    y: base * 1.14,
                    duration: HIGHLIGHT_STEP,
                    yoyo: true,
                    repeat: HIGHLIGHT_REPEAT,
                    ease: 'sine.inOut',
                    onComplete: () => {
                        s.scale.set(base);
                    },
                }
            )
        );
    }

    /** 收掉高亮並還原尺寸。重跑一次 resize 就會把 scale 算回正確值，不必自己記基準。 */
    public clearHighlights(): void {
        for (const t of this.highlights) t.kill();
        this.highlights = [];
        this.resize(this.cellW, this.cellH);
    }

    /** 把 sprite 池按目前 offset 重新對位。這是唯一改動場景樹的地方。 */
    private layout(): void {
        // 這是全檔唯一把「進度」換算成「方向」的地方（見 DIR 的說明）
        const scroll = this.offset * DIR;
        const first = Math.floor(scroll);
        const frac = scroll - first;

        for (let i = 0; i < POOL; i++) {
            const s = this.sprites[i];
            const sym = this.strip[mod(first + i, STRIP_LEN)];
            const tex = this.frames.get(sym);
            if (tex && s.texture !== tex) s.texture = tex;
            s.y = (i - frac + 0.5) * this.cellH;
        }
    }

    private killTweens(): void {
        this.spinTween?.kill();
        this.settleTween?.kill();
        this.stopDelay?.kill();
        this.spinTween = null;
        this.settleTween = null;
        this.stopDelay = null;
        for (const t of this.highlights) t.kill();
        this.highlights = [];

        // 停軸被打斷時要放掉 Promise，否則呼叫端的 Promise.all 會永遠等下去
        const pending = this.resolveStop;
        this.resolveStop = null;
        pending?.();
    }

    /**
     * 轉軸被回收時，**一定要 kill 掉 tween**。
     *
     * gsap 的 tween 活在自己的全域 ticker 上，不會因為目標物件被 destroy 就停下來——
     * 它會繼續對著已經死掉的 Pixi 物件寫值，然後在某一幀丟出看不懂的錯。
     * 玩法切換頻繁的頁面，這是最常見的當機原因之一。
     */
    public override destroy(options?: Parameters<Container['destroy']>[0]): void {
        this.killTweens();
        this.phase = 'idle';
        this.mask = null;
        super.destroy(options);
    }
}

/** 依權重抽一個符號。帶子的初始內容用它填，讓轉動中的畫面密度接近真實盤面。 */
function randomSymbol(): Sym {
    let total = 0;
    for (const s of SYMBOLS) total += WEIGHTS[s];
    let r = Math.random() * total;
    for (const s of SYMBOLS) {
        r -= WEIGHTS[s];
        if (r <= 0) return s;
    }
    return Sym.Cherry;
}

/** 永遠回非負的取餘。JS 的 % 對負數會回負值，帶子索引會直接爆掉。 */
function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

function clamp01(n: number): number {
    return n < 0 ? 0 : n > 1 ? 1 : n;
}
