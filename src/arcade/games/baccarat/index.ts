import gsap from 'gsap';
import { Container, Text, TextStyle, type Ticker } from 'pixi.js';
import { bakeCardAtlas, CARD_ASPECT, type CardAtlas } from '../../common/cards/atlas';
import { CardView } from '../../common/cards/CardView';
import { bakeChipAtlas, CHIP_VALUES, type ChipAtlas, type ChipValue } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { FlyingChips } from '../../common/chips/FlyingChips';
import { PhaseBanner } from '../../common/table/PhaseBanner';
import { ScrollableRoad } from '../../common/roadmap/ScrollableRoad';
import { topBarH, uiScale } from '../../core/layout';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import { ONLINE_SEAT, type BaccaratS2C, type OtherBet, type Phase, type SeatInfo } from '../../net/games/baccarat';
import { arcadeState, useArcadeStore } from '../../store';
import { onLangChange, t } from '../../../i18n';
import { buildBigRoad } from './roadmap';
import { beadMarks, bigRoadMarks, derivedMarks, ROAD_ROWS } from './roadView';
import { OnlineBadge, SeatView } from './seatView';
import { baccaratState, useBaccaratStore } from './store';
import { BET_SPOTS, handTotal, PAYOUTS, type BetSpot, type Card, type Round } from './rules';
import { BANKER, PLAYER, TIE } from '../../theme';

/**
 * 百家樂玩法——**一張多人桌，你只是路過的玩家**。
 *
 * 這支檔案沒有一行在決定輸贏（牌是 server 發的，賠付是 server 算的），也沒有一行在
 * 決定「什麼時候開牌」——**連節奏都是 server 的**。它只做四件事：把桌況演出來、
 * 把別人的籌碼飛進注區、把玩家的點擊送出去、把路圖接下去。
 *
 * 從單機回合制改成多人桌，前端真正變複雜的地方只有一個，而且不是動畫：
 * **畫面上的每一格都得能從「中途加入」的狀態長出來。** 單機版可以假設玩家從第一局
 * 開始看，多人版不行——他可能在開牌演到一半時才進桌，那時候該看到的是攤開的牌，
 * 不是從頭補演一次。所有 `snapshot` 相關的分支都是為了這件事存在的。
 */

/**
 * 路圖區佔畫面高度的比例與上限。
 *
 * 這兩個數字是量出來的：在 1512×716 的視窗裡，原本的 0.3／210 會讓路圖吃掉 29% 的高度，
 * 牌區只剩 18%，牌被壓到 42px 寬——點數根本看不清。路圖是**參考資訊**，牌才是主角，
 * 所以讓路圖先讓步。
 */
const ROAD_RATIO = 0.26;
const ROAD_MAX = 172;

/**
 * 路圖讓步的底線。
 *
 * 六列的格子在這個高度大約 6px 見方——還看得出紅藍與拖尾的走向。再低就只剩一片網格，
 * 那時它已經不是資訊了，留著只是在佔位置。
 */
const ROAD_MIN = 64;

/**
 * 牌「看得清點數」的寬度，也是路圖讓步的目標。
 *
 * 不是隨手抓的：牌角的點數字級跟著牌寬縮放，低於這個寬度時在手機上要湊近才讀得出來。
 * 排版反過來從它推算路圖能佔多高（見 layout 的 roadForComfort）。
 */
const CARD_COMFORT_W = 64;

/** 發牌的間隔。太快看不出是一張一張發的，太慢會拖 */
const DEAL_GAP = 0.16;

/**
 * 結算最多等開牌演出多久（秒）。
 *
 * 演完一局大約六秒，而 settle 封包是 server 在 dealing 段結束時才送的，所以正常情況下
 * 這條線根本碰不到。它存在是因為**結算後面掛著太多東西**——路圖、餘額、中獎高亮、
 * 籌碼回收全都在 showSettlement 裡。演出萬一沒走完，這些不能跟著卡住。
 */
const SETTLE_WAIT_MAX = 3;

/** 牌下方那行點數要留多高。字級固定，所以這是常數而不是比例（見 layout） */
const TOTAL_LABEL_H = 34;

/** 階段膠囊與座位列各要留多高。兩者都是固定字級，所以是常數 */
const BANNER_H = 32;
const SEAT_H = 54;
const SEAT_H_COMPACT = 38;

/**
 * 一批下注最多演幾顆籌碼——**多人桌最重要的那個上限**。
 *
 * server 每秒推來的注可能有十幾筆、每筆好幾顆，一局十五秒累積下來上百顆。全部照演的話
 * 前幾局還好，跑久了畫面會塞滿到看不出注區，低階手機直接掉幀。
 *
 * 前公司那套用的是三層上限（`MAX_BET_ANIMATE_AMOUNT` 每次 30~40、`MAX_COUNT` 每批 30、
 * `ONLINE_MAX_COUNT` 每區 2~3），這裡照同一個結構收斂成兩層加上 FlyingChips 自己的
 * 桌面總量上限。
 *
 * **被砍掉的只有動畫，不是帳。** 注區角落的金額永遠是 server 給的權威值，
 * 所以「畫面上只飛了 24 顆但總額跳了十萬」是正確的行為，不是 bug。
 */
const BATCH_ANIMATE_MAX = 24;
/** 同一批裡同一個注區最多飛幾顆。不設的話所有人押同一區時會疊成一坨 */
const PER_SPOT_PER_TICK = 5;

/** 中途進桌時，每個注區最多補幾顆「已經在桌上」的籌碼 */
const SNAPSHOT_CHIPS_PER_SPOT = 7;

// 紅莊藍閒是牌桌的通用語言，**不因為換配色而改**——改了路圖上的紅藍就跟全世界的
// 百家樂桌對不起來。能做的是壓飽和度，讓它們在黑金裡不刺眼（見 theme.ts）
const SPOT_COLOR: Record<BetSpot, number> = {
    player: PLAYER,
    banker: BANKER,
    tie: TIE,
    playerPair: PLAYER,
    bankerPair: BANKER,
};

/** 每個階段膠囊上要顯示的字，以及要不要倒數 */
const PHASE_LABEL: Record<Phase, { key: string; countdown: boolean }> = {
    betting: { key: 'arcade.bac.phase.betting', countdown: true },
    dealing: { key: 'arcade.bac.phase.dealing', countdown: false },
    result: { key: 'arcade.bac.phase.result', countdown: false },
    shuffle: { key: 'arcade.bac.phase.shuffle', countdown: false },
};

export class BaccaratModule implements GameModule {
    public readonly id = 'baccarat' as const;

    private ctx: ModuleContext | null = null;
    private socket: FakeSocket<'baccarat'> | null = null;

    private cards: CardAtlas | null = null;
    private chips: ChipAtlas | null = null;

    private readonly roadLayer = new Container();
    private readonly tableLayer = new Container();
    /** 散落的籌碼。夾在注區與牌之間——壓在注區上面，但不擋牌 */
    private chipLayer: FlyingChips | null = null;
    private readonly seatLayer = new Container();
    private readonly cardLayer = new Container();
    private readonly uiLayer = new Container();

    private readonly roads = {
        bead: new ScrollableRoad({ rows: ROAD_ROWS }),
        big: new ScrollableRoad({ rows: ROAD_ROWS }),
        bigEye: new ScrollableRoad({ rows: ROAD_ROWS }),
        small: new ScrollableRoad({ rows: ROAD_ROWS }),
        cockroach: new ScrollableRoad({ rows: ROAD_ROWS }),
    };

    private spots = new Map<BetSpot, BetSpotView>();
    private seatViews: SeatView[] = [];
    private banner: PhaseBanner | null = null;
    private badge: OnlineBadge | null = null;

    private playerCards: CardView[] = [];
    private bankerCards: CardView[] = [];
    private playerTotal: Text | null = null;
    private bankerTotal: Text | null = null;

    /** 牌從哪裡飛出來。排版時算好，發牌動畫直接用 */
    private shoeAt = { x: 0, y: 0 };
    /** 我自己的籌碼從哪裡飛出來。我沒有座位（是路過的），所以從操作面板那一側上來 */
    private myOrigin = { x: 0, y: 0 };
    /** 輸掉的籌碼往哪裡收。桌面正中央＝莊家的位置 */
    private houseAt = { x: 0, y: 0 };
    /** 牌的寬度，跟著畫面縮放 */
    private cardW = 64;
    /** 桌面上一顆籌碼多大 */
    private chipPx = 22;

    /**
     * 目前這局的開牌演出。
     *
     * 結算封包要**等它演完**才能揭曉——`deal` 與 `settle` 是 server 隔了七秒送的兩則，
     * 但 client 這側的演出時間是自己的事，兩者不會剛好對齊。沒有這個把手的話，
     * 結算會在補牌還沒翻開時就把中獎區點亮。
     */
    private dealAnim: Promise<void> | null = null;

    /**
     * 開牌演出的世代編號。每開始演一局就 +1。
     *
     * 為什麼需要它：`playRound` 是一長串 `await`，中間**每一個 await 都是一個可以
     * 被插隊的縫**——換靴、中途重連、下一局的 deal 封包都可能在這些縫裡把畫面重置。
     * 沒有這個編號的話，被作廢的那一輪醒來之後會繼續往下發牌，把新一局的牌蓋掉。
     *
     * `dead` 只擋得住「模組整個卸載」，擋不住「同一張桌子換了一局」。
     */
    private dealSeq = 0;

    /** server 與本地的時差。見 store 的 applySnapshot */
    private skew = 0;
    /** 上一次寫進 store 的倒數整數秒。只有變了才寫，不然每幀都會觸發 React 重繪 */
    private lastSecond = -1;

    /**
     * 已卸載的旗標。
     *
     * i18n 只提供訂閱、沒有取消訂閱（見 i18n/useT.ts 的說明），所以語言變更的
     * callback 會活得比這個模組久。沒有這個旗標的話，離開百家樂之後切語言，
     * 那個 callback 會對著已經 destroy 的 Pixi 物件動手。
     */
    private dead = false;

    public async mount(ctx: ModuleContext): Promise<void> {
        this.ctx = ctx;

        // ---- 貼圖：進桌時各烘一次 ----
        // 只 track source，切出來的 frame 共用同一個 source，各自 destroy 會重複釋放。
        // 第二個參數是**連同底層 GPU 記憶體一起還**——不傳的話只丟掉 Texture 那層包裝，
        // 核對數字會漂亮地回報沒漏，但 renderer 握著的 texture source 每次進出就疊一階
        this.cards = bakeCardAtlas(ctx.app);
        ctx.track(this.cards.source, true);
        this.chips = bakeChipAtlas(ctx.app);
        ctx.track(this.chips.source, true);

        this.chipLayer = new FlyingChips(this.chips);

        // 疊放順序＝資訊的重要性：路圖在最底，注區、籌碼、座位往上疊，
        // 牌與階段膠囊在最上面——這兩樣任何時候都不該被蓋住
        ctx.root.addChild(this.roadLayer);
        ctx.root.addChild(this.tableLayer);
        ctx.root.addChild(this.chipLayer);
        ctx.root.addChild(this.seatLayer);
        ctx.root.addChild(this.cardLayer);
        ctx.root.addChild(this.uiLayer);

        for (const road of Object.values(this.roads)) this.roadLayer.addChild(road);

        this.buildSpots();
        this.buildTotals();
        this.buildSeats();

        // ---- 連線 ----
        // 進桌要的桌況在收到 welcome 之後才要（見 onPacket）——寫在 onOpen 裡的話
        // 這個 callback 會參照到還在初始化的 socket 自己
        const socket = new FakeSocket('baccarat', {
            onMessage: (p) => this.onPacket(p),
            onStateChange: (s) => useArcadeStore.getState().setConnection(s),
        });
        this.socket = socket;
        ctx.onDispose(() => socket.close());

        // ---- 接上 React 面板 ----
        // 面板按下去**不改任何狀態**，只是請這裡送封包——押注要 server 說了算
        useBaccaratStore.getState().setBetHandler((spot, amount) => this.sendBet(spot, amount));
        ctx.onDispose(() => useBaccaratStore.getState().reset());

        // ---- 倒數 ----
        // 每幀重算而不是每秒 setInterval：分頁被節流時 interval 會漂，而每幀重算是
        // 從 endsAt 反推的，切回來第一幀就對了（見 net/games/baccarat.ts 的 phase 封包）
        ctx.frame((ticker) => this.tickClock(ticker));

        // ---- 面板高度變了就重排 ----
        // 換語言、換玩法都可能讓面板長高或變矮，canvas 這側得跟著讓位（見 store 的 dockHeight）
        const unsubDock = useArcadeStore.subscribe((s, prev) => {
            if (s.dockInset !== prev.dockInset && !this.dead) {
                this.layout(ctx.screen.width, ctx.screen.height);
            }
        });
        ctx.onDispose(unsubDock);

        // ---- 語言切換時重畫珠盤路上的字 ----
        onLangChange(() => {
            if (this.dead) return;
            this.refreshLabels();
            this.updateRoads();
        });
        ctx.onDispose(() => {
            this.dead = true;
        });

        ctx.onResize((w, h) => this.layout(w, h));
        this.layout(ctx.screen.width, ctx.screen.height);

        ctx.onDispose(() => this.cleanupAnimations());
    }

    // ---- 建場 ----

    private buildSpots(): void {
        for (const spot of BET_SPOTS) {
            const view = new BetSpotView({
                label: t(`arcade.bac.${spot}`),
                odds: oddsLabel(spot),
                color: SPOT_COLOR[spot],
                onTap: () => this.tapSpot(spot),
            });
            this.spots.set(spot, view);
            this.tableLayer.addChild(view);
        }
    }

    private buildTotals(): void {
        this.playerTotal = totalText(SPOT_COLOR.player);
        this.bankerTotal = totalText(SPOT_COLOR.banker);
        this.cardLayer.addChild(this.playerTotal);
        this.cardLayer.addChild(this.bankerTotal);
    }

    /**
     * 六張椅子加一個線上人數膠囊。
     *
     * 椅子**一次建滿六張**而不是有人才建：座位是位置不是身分（見協定裡的 SeatInfo），
     * 有人來就換張臉，沒人就畫成空位。動態增刪的版本會讓剩下的人擠過來重排，
     * 看起來像所有人同時換了座位。
     */
    private buildSeats(): void {
        for (let i = 0; i < 6; i++) {
            const view = new SeatView();
            this.seatViews.push(view);
            this.seatLayer.addChild(view);
        }

        // 線上人數是**假的**，但要假得穩定：每局小幅浮動，不要每秒亂跳
        this.badge = new OnlineBadge(2400 + Math.floor(Math.random() * 900));
        this.uiLayer.addChild(this.badge);

        this.banner = new PhaseBanner();
        this.uiLayer.addChild(this.banner);
    }

    private refreshLabels(): void {
        for (const [spot, view] of this.spots) view.setLabels(t(`arcade.bac.${spot}`), oddsLabel(spot));
        this.applyPhaseLabel(baccaratState().phase);
    }

    // ---- 互動 ----

    /**
     * 點注區＝押一顆目前面額的籌碼。
     *
     * 餘額在這裡先擋一次，省掉一趟 RTT——**這不是在替代 server 的檢查**，
     * server 那邊仍然會擋（見 baccaratServer.bet），這裡只是讓回饋即時。
     */
    private tapSpot(spot: BetSpot): void {
        const st = baccaratState();
        if (st.phase !== 'betting') {
            arcadeState().setNotice('arcade.bac.betClosed');
            return;
        }
        this.sendBet(spot, st.chip);
    }

    /**
     * 送出一注，同時**立刻把籌碼飛出去**。
     *
     * 這是刻意的不對稱：**動畫先走，數字等 server**。
     *
     * 押注要走一趟 RTT（這裡模擬 180~320ms）。等回應才開始飛籌碼的話，手指離開螢幕
     * 到畫面有反應之間會有三分之一秒的空白，那在下注只剩五秒的時候是不能忍的。
     * 但注區角落的金額**絕不能**同步樂觀更新——那是帳，帳只有 server 說了算。
     *
     * 所以：籌碼是「我按了」的回饋，數字是「server 收了」的事實。萬一 server 打回來
     * （餘額不足），數字不會動，而那顆已經飛出去的籌碼會在這一局結束時跟其他人的一起
     * 被收走——代價可以接受，換來的是整個下注階段的手感。
     */
    private sendBet(spot: BetSpot, amount: number): void {
        const st = baccaratState();
        const shell = arcadeState();
        if (st.phase !== 'betting' || shell.connection !== 'open') return;
        if (amount > shell.balance) {
            shell.setError('insufficient_balance');
            return;
        }

        this.flyChip(nearestChip(amount), spot, ONLINE_SEAT, this.myOrigin, 0);
        this.socket?.send({ type: 'bet', spot, amount });
    }

    // ---- 倒數 ----

    /**
     * 每幀從 `endsAt` 反推還剩幾秒。
     *
     * 兩個消費端的更新頻率**刻意不同**：
     *
     * - 膠囊上的進度條吃**浮點秒**，每幀更新，所以它是連續地縮。
     * - store 裡的 `secondsLeft` 只在**整數變了**才寫。它會觸發 React 重繪，
     *   每幀寫一次等於一秒重繪六十遍面板，而面板上顯示的只是一個整數。
     */
    private tickClock(_ticker: Ticker): void {
        if (this.dead) return;
        const st = baccaratState();
        if (st.endsAt === 0) return;

        const left = Math.max(0, (st.endsAt - Date.now()) / 1000);
        this.banner?.setLeft(left);

        const whole = Math.ceil(left);
        if (whole !== this.lastSecond) {
            this.lastSecond = whole;
            st.setSecondsLeft(whole);
        }
    }

    // ---- 封包 ----

    private onPacket(p: BaccaratS2C): void {
        switch (p.type) {
            case 'welcome':
                arcadeState().setBalance(p.balance);
                // 握手完成才要桌況。這一款的 sit 拿回來的不是「歷史」而是**當下的桌況**——
                // 這張桌子沒有開頭，玩家是走過來的
                this.socket?.send({ type: 'sit' });
                break;

            case 'balance':
                arcadeState().setBalance(p.balance);
                break;

            case 'table':
                this.applySnapshot(p.snapshot);
                break;

            case 'phase':
                this.skew = p.serverNow - Date.now();
                baccaratState().setPhase(p.phase, p.endsAt - this.skew, p.round);
                this.applyPhase(p.phase);
                break;

            case 'bets':
                baccaratState().setTotals(p.totals);
                this.syncAmounts();
                this.flyBatch(p.bets);
                break;

            case 'betOk':
                arcadeState().setBalance(p.balance);
                baccaratState().setMyBets(p.myBets, p.totals);
                this.syncAmounts();
                break;

            case 'deal':
                this.dealAnim = this.playRound(p.round);
                break;

            case 'settle': {
                const st = baccaratState();
                // 淨輸贏在這裡就算得出來，但**不能現在寫進 store**——面板上的「上一局」
                // 會立刻跳出數字，牌都還沒翻完就先告訴玩家結果了
                const net = p.totalReturn - st.myTotal;
                const settle = p;
                // 演出**最多**擋結算這麼久。正常情況下 settle 封包到達時牌早就翻完了，
                // 這條上限純粹是保險：結算後面掛著路圖、餘額、中獎高亮與籌碼回收，
                // 演出萬一因為任何理由沒有走完，這些都不能跟著陪葬
                void Promise.race([this.dealAnim ?? Promise.resolve(), wait(SETTLE_WAIT_MAX)]).then(() => {
                    if (this.dead) return;
                    this.showSettlement(settle, net);
                });
                break;
            }

            case 'seats':
                baccaratState().setSeats(p.seats);
                this.syncSeats(p.seats);
                break;

            case 'error':
                arcadeState().setError(p.reason);
                break;
        }
    }

    /**
     * 中途進桌：一次把桌況對齊。
     *
     * 這裡是整支檔案最不像單機版的一段。三件事都得在「不知道之前發生過什麼」的
     * 前提下做對：
     *
     * 1. **牌**：如果進來時正在開牌或結算，牌要**直接攤開**，不補演發牌動畫。
     *    真實桌台也是這樣——你走過去坐下，荷官不會為你重發一次。
     * 2. **籌碼**：只知道各區的**總額**，不知道是誰押的幾顆。所以桌面上的籌碼是
     *    「照總額比例撒出來的視覺化」而不是逐筆重建（見 scatterSnapshotChips）。
     * 3. **倒數**：照快照裡的 `endsAt` 對齊，不從現在開始重數。
     */
    private applySnapshot(snap: Parameters<ReturnType<typeof baccaratState>['applySnapshot']>[0]): void {
        this.skew = snap.serverNow - Date.now();
        baccaratState().applySnapshot(snap, this.skew);

        this.syncSeats(snap.seats);
        this.syncAmounts();
        this.updateRoads();
        this.applyPhaseLabel(snap.phase);

        this.chipLayer?.clearAll();
        this.scatterSnapshotChips();

        // 進桌時桌上已經有牌就直接攤開
        this.clearCards();
        if (snap.openRound && snap.phase !== 'betting') this.showRoundInstantly(snap.openRound);
    }

    /** 階段換了要做的事。**每一段都要能從任何一段跳過來**，因為中途進桌什麼都可能 */
    private applyPhase(phase: Phase): void {
        this.applyPhaseLabel(phase);

        switch (phase) {
            case 'betting':
                // 新的一局：桌面清空。籌碼在結算時已經飛走了，這裡是保險——
                // 中途進桌或漏接結算封包時，這是唯一會把殘留籌碼掃掉的地方
                this.chipLayer?.clearAll();
                this.clearCards();
                for (const view of this.spots.values()) view.setWin(false);
                this.syncAmounts();
                this.badge?.setCount(2400 + Math.floor(Math.random() * 900));
                break;

            case 'dealing':
                // 封盤。注區不再接受點擊——**視覺上也要關掉游標**，
                // 只擋事件不改游標的話，滑鼠移過去還是手指，看起來像壞了
                this.setSpotsEnabled(false);
                break;

            case 'result':
                break;

            case 'shuffle':
                // 換靴：路圖已經被 pushHistory 清空，這裡把它重畫成空的
                this.updateRoads();
                this.clearCards();
                break;
        }

        if (phase === 'betting') this.setSpotsEnabled(true);
    }

    private applyPhaseLabel(phase: Phase): void {
        const spec = PHASE_LABEL[phase];
        const st = baccaratState();
        const span = Math.max(0.001, (st.endsAt - Date.now()) / 1000);
        this.banner?.setPhase(t(spec.key), span, spec.countdown);
    }

    private setSpotsEnabled(on: boolean): void {
        for (const view of this.spots.values()) {
            view.eventMode = on ? 'static' : 'none';
            view.cursor = on ? 'pointer' : 'default';
        }
    }

    /** 注區角落的兩個數字。總額與自己的注都只從 store 讀——那裡的值是 server 給的 */
    private syncAmounts(): void {
        const st = baccaratState();
        for (const [spot, view] of this.spots) view.setAmounts(st.totals[spot] ?? 0, st.myBets[spot] ?? 0);
    }

    private syncSeats(seats: SeatInfo[]): void {
        const bySeat = new Map(seats.map((s) => [s.seat, s]));
        for (let i = 0; i < this.seatViews.length; i++) this.seatViews[i].setInfo(bySeat.get(i) ?? null);
    }

    // ---- 籌碼 ----

    /**
     * 把一批別人的注飛進注區。
     *
     * 三層上限一起作用（見 BATCH_ANIMATE_MAX 的說明）：整批的總數、單一注區的數量、
     * 以及 FlyingChips 自己的桌面總量。砍掉的只有動畫，注區角落的金額照樣是全額。
     *
     * `delay` 讓同一批錯開出發。全部同時飛的話會看起來像一次爆炸，而不是十幾個人
     * 各自丟出籌碼。
     */
    private flyBatch(bets: OtherBet[]): void {
        let budget = BATCH_ANIMATE_MAX;
        const perSpot = new Map<BetSpot, number>();
        let index = 0;
        let sawCrowd = false;

        for (const bet of bets) {
            if (budget <= 0) break;
            const used = perSpot.get(bet.spot) ?? 0;
            if (used >= PER_SPOT_PER_TICK) continue;

            const count = Math.min(bet.count, PER_SPOT_PER_TICK - used, budget);
            perSpot.set(bet.spot, used + count);
            budget -= count;
            if (bet.seat === ONLINE_SEAT) sawCrowd = true;

            const from = this.originOf(bet.seat);
            for (let k = 0; k < count; k++) {
                this.flyChip(bet.chip, bet.spot, bet.seat, from, index * 0.045);
                index++;
            }
        }

        if (sawCrowd) this.badge?.ping();
    }

    private flyChip(value: ChipValue, spot: BetSpot, seat: number, from: { x: number; y: number }, delay: number): void {
        const view = this.spots.get(spot);
        if (!view || !this.chipLayer) return;
        this.chipLayer.fly(value, spot, seat, from, view.randomChipPoint(this.chipPx), delay);
    }

    /** 某個座位的籌碼從哪裡飛出來。沒有座位的散客走線上人數膠囊（見 seatView.ts） */
    private originOf(seat: number): { x: number; y: number } {
        if (seat === ONLINE_SEAT) return this.badge?.originPoint() ?? this.houseAt;
        return this.seatViews[seat]?.originPoint() ?? this.houseAt;
    }

    /**
     * 中途進桌時，照各注區的總額撒一些籌碼上去。
     *
     * **這是視覺化，不是重建。** server 的快照只給總額，給不出「誰押了幾顆什麼面額」——
     * 要給就得記下整局每一筆下注，那份資料除了補這個畫面之外沒有別的用途。
     *
     * 所以這裡做的是：金額越大撒越多顆、面額挑一個看起來合理的。玩家看到的是
     * 「這區很熱」這個正確的資訊，只是每一顆籌碼不對應到某個真實的人。
     */
    private scatterSnapshotChips(): void {
        const st = baccaratState();
        for (const spot of BET_SPOTS) {
            const total = st.totals[spot] ?? 0;
            if (total <= 0) continue;

            const count = Math.min(SNAPSHOT_CHIPS_PER_SPOT, Math.max(1, Math.round(Math.log10(total) * 2)));
            const value = nearestChip(total / count);
            const view = this.spots.get(spot);
            if (!view) continue;
            for (let i = 0; i < count; i++) {
                this.chipLayer?.place(value, spot, ONLINE_SEAT, view.randomChipPoint(this.chipPx));
            }
        }
    }

    // ---- 演出 ----

    /**
     * 把一局演出來：發四張 → 翻閒家 → 翻莊家 → 有補牌就補。
     *
     * 跟單機版最大的差別：**這裡不再負責結算。** 單機版的 playRound 演完就順手把餘額、
     * 中獎高亮、下一局的排程全做了；多人版的結算是另一則封包，而且是 server 排的時間。
     * 演出只管演出，這樣「開牌演到一半玩家離桌」才不會留下一個排在未來的狀態變更。
     */
    private async playRound(round: Round): Promise<void> {
        // 順序不能反：clearCards 會把上一輪演出作廢（dealSeq++），要先讓它做完，
        // 本輪才拿得到一個不會被自己作廢掉的編號
        this.clearCards();
        const seq = this.dealSeq;

        // 發牌順序是閒、莊、閒、莊——這是真實桌台的順序，不是為了好看
        const order: Array<{ side: 'player' | 'banker'; index: number }> = [
            { side: 'player', index: 0 },
            { side: 'banker', index: 0 },
            { side: 'player', index: 1 },
            { side: 'banker', index: 1 },
        ];

        for (const step of order) {
            const card = step.side === 'player' ? round.player[step.index] : round.banker[step.index];
            await this.dealCard(step.side, step.index, card);
            if (this.stale(seq)) return;
        }

        // 閒家先翻，莊家後翻。中間的停頓是刻意的——那一拍就是百家樂的張力所在。
        //
        // 顯示的是**這兩張自己的點數**，不是 `round.playerTotal`。後者是 settleRound
        // 算完的最終點數，補牌都還沒發就先寫在畫面上，等於自己把答案先講了——
        // 而補牌那一段本來是這個遊戲最有張力的地方
        await this.flipSide('player', handTotal(round.player.slice(0, 2)));
        if (this.stale(seq)) return;
        await this.flipSide('banker', handTotal(round.banker.slice(0, 2)));
        if (this.stale(seq)) return;

        // 補牌：settleRound 已經算好誰補了幾張，這裡照著演就好。
        // 翻開之後才把點數改成最終值——這是上面那個「不要先講答案」的另一半
        if (round.player.length > 2) {
            await this.dealCard('player', 2, round.player[2]);
            if (this.stale(seq)) return;
            await this.playerCards[2]?.flip();
            if (this.stale(seq)) return;
            this.setTotal('player', round.playerTotal);
        }
        if (round.banker.length > 2) {
            await this.dealCard('banker', 2, round.banker[2]);
            if (this.stale(seq)) return;
            await this.bankerCards[2]?.flip();
            if (this.stale(seq)) return;
            this.setTotal('banker', round.bankerTotal);
        }
    }

    /**
     * 這一輪演出還算不算數。
     *
     * 兩種作廢：模組卸載（`dead`），或是這張桌子已經開始演下一局（`dealSeq` 變了）。
     * 每個 `await` 之後都要問一次——中間隔著的那幾百毫秒，什麼都可能發生過。
     */
    private stale(seq: number): boolean {
        return this.dead || seq !== this.dealSeq;
    }

    /**
     * 結算：標中獎區、飄出各家的輸贏、把籌碼收回去。
     *
     * 順序是有意義的：**先讓玩家看到哪一區贏了，再讓錢動。** 反過來的話，籌碼已經
     * 飛走了才點亮中獎區，玩家會來不及把「那些錢」跟「那一區」連起來。
     */
    private showSettlement(
        settle: Extract<BaccaratS2C, { type: 'settle' }>,
        net: number
    ): void {
        const st = baccaratState();

        arcadeState().setBalance(settle.balance);
        st.setResult(st.lastRound ?? ({} as Round), settle.payouts, net);
        st.pushHistory(settle.road, settle.shoe, settle.shoeChanged);
        this.updateRoads();

        const winners = new Set<string>();
        for (const spot of BET_SPOTS) {
            // 「這一區有沒有贏」不能看 payouts——那是**我**的賠付，我沒押的區永遠是 0。
            // 要看的是規則：這一局的結果讓哪些注區中了
            const won = spotWon(spot, settle.road);
            if (won) winners.add(spot);
            this.spots.get(spot)?.setWin(won);
        }

        for (const result of settle.seats) {
            if (result.seat === ONLINE_SEAT) continue;
            this.seatViews[result.seat]?.flashDelta(result.delta);
        }

        // 籌碼回收。贏的飛回押注的人面前，輸的往桌心收——**這一段是多人桌最有感的演出**，
        // 它讓「別人的注」從畫面裝飾變成真的有輸有贏的錢
        this.chipLayer?.recycle(
            (spot) => winners.has(spot),
            (seat) => (seat === ONLINE_SEAT ? (this.badge?.originPoint() ?? null) : (this.seatViews[seat]?.originPoint() ?? null)),
            this.houseAt,
            () => {
                /* 收完就沒事了。下一局的清場在 phase betting 那裡 */
            }
        );
    }

    /** 中途進桌時把牌直接攤開，不演。 */
    private showRoundInstantly(round: Round): void {
        if (!this.cards) return;

        const put = (side: 'player' | 'banker', list: Card[]): void => {
            for (let i = 0; i < list.length; i++) {
                const view = new CardView(this.cards as CardAtlas, this.cardW);
                view.setFace(list[i].suit, list[i].rank);
                const slot = this.cardSlot(side, i);
                view.position.set(slot.x, slot.y);
                view.rotation = slot.rotation;
                // 直接顯示正面。`flip()` 會播翻牌動畫，那正是這裡要避免的
                view.setFaceUp(true);
                this.cardLayer.addChild(view);
                (side === 'player' ? this.playerCards : this.bankerCards)[i] = view;
            }
        };

        put('player', round.player);
        put('banker', round.banker);
        this.setTotal('player', round.playerTotal);
        this.setTotal('banker', round.bankerTotal);
    }

    /** 一張牌從牌靴飛到定位，背面朝上。 */
    private async dealCard(side: 'player' | 'banker', index: number, card: Card): Promise<void> {
        if (!this.cards || this.dead) return;

        const view = new CardView(this.cards, this.cardW);
        view.setFace(card.suit, card.rank);
        view.position.set(this.shoeAt.x, this.shoeAt.y);
        this.cardLayer.addChild(view);

        const list = side === 'player' ? this.playerCards : this.bankerCards;
        list[index] = view;

        const target = this.cardSlot(side, index);
        await new Promise<void>((resolve) => {
            gsap.to(view, {
                x: target.x,
                y: target.y,
                // 補牌在飛行途中就轉成橫的，落定才轉會多出一個沒必要的動作
                rotation: target.rotation,
                duration: 0.26,
                ease: 'power2.out',
                onComplete: () => resolve(),
                // **這一行是整局演出的保險絲。** resize 會把飛行中的牌直接擺到定位
                // （見 settleCard），那是 `kill`，而 kill 不會觸發 onComplete——
                // 少了這行，手機上一次位址列收放就足以讓 playRound 永遠停在這裡：
                // 畫面上留一張沒翻開的牌，後面的結算、路圖、餘額全部不會發生
                onInterrupt: () => resolve(),
            });
        });
        await wait(DEAL_GAP);
    }

    /** 翻開一邊的前兩張，翻完顯示點數。 */
    private async flipSide(side: 'player' | 'banker', total: number): Promise<void> {
        const list = side === 'player' ? this.playerCards : this.bankerCards;
        await Promise.all(list.slice(0, 2).map((c) => c.flip()));
        if (this.dead) return;
        this.setTotal(side, total);
        await wait(0.22);
    }

    private setTotal(side: 'player' | 'banker', total: number): void {
        const label = side === 'player' ? this.playerTotal : this.bankerTotal;
        if (label) label.text = String(total);
    }

    private clearCards(): void {
        // 桌面被清掉，任何還在跑的演出從這一刻起都不算數了。**中途重連走的也是這裡**——
        // 快照把牌直接攤開之後，上一輪還沒跑完的 playRound 不能再回來補發牌
        this.dealSeq++;

        for (const card of [...this.playerCards, ...this.bankerCards]) {
            card.stop();
            gsap.killTweensOf(card);
            card.destroy({ children: true });
        }
        this.playerCards = [];
        this.bankerCards = [];
        if (this.playerTotal) this.playerTotal.text = '';
        if (this.bankerTotal) this.bankerTotal.text = '';
    }

    private cleanupAnimations(): void {
        for (const card of [...this.playerCards, ...this.bankerCards]) {
            card.stop();
            gsap.killTweensOf(card);
        }
        for (const view of this.spots.values()) view.stop();
        for (const seat of this.seatViews) seat.stop();
        this.chipLayer?.stop();
        this.banner?.stop();
        this.badge?.stop();
    }

    // ---- 路圖 ----

    /**
     * 五張路全部從同一份歷史重推。
     *
     * 不做增量更新是刻意的：路圖的增量規則比重推複雜得多（新的一顆可能讓拖尾轉向、
     * 讓後面所有衍生路的判定改變），而一靴最多八十局，全部重算是幾十微秒的事。
     * **能重算就不要維護狀態**——這裡省下來的不是效能，是一整類對不上的 bug。
     *
     * 多人桌之後這件事變得更重要：路圖現在會**自己一直長**，玩家不動它也在變。
     * 增量規則寫錯的話，錯的那一格會一路留在畫面上到換靴為止。
     */
    private updateRoads(): void {
        if (this.dead) return;
        const history = baccaratState().history;
        const road = buildBigRoad(history);

        const labels = {
            player: t('arcade.bac.short.player'),
            banker: t('arcade.bac.short.banker'),
            tie: t('arcade.bac.short.tie'),
        };

        // 餵的是**整靴的完整資料**，不再按可用寬度裁切——看得到幾欄由捲動視窗決定
        // （見 common/roadmap/ScrollableRoad 與 roadView 開頭的說明）。
        // 新的一局會自動貼齊最右邊，除非玩家自己捲開去看前面（見 ScrollableRoad 的 atEnd）
        this.roads.bead.setMarks(beadMarks(history, labels));
        this.roads.big.setMarks(bigRoadMarks(road));
        this.roads.bigEye.setMarks(derivedMarks(road, 'bigEye'));
        this.roads.small.setMarks(derivedMarks(road, 'small'));
        this.roads.cockroach.setMarks(derivedMarks(road, 'cockroach'));
    }

    // ---- 排版 ----

    /**
     * 兩套版面，依畫面形狀分派。
     *
     * 手機橫放（矮且寬）**不能只是把直式的比例調小**：那裡扣掉頂列與一條橫躺的操作面板
     * 只剩 173px，要塞牌、五個注區、五張路單，三段疊著放在數學上就是不夠。
     * 所以那個尺寸整個換一套——面板直立到右側（見 style.css 的橫版區塊），
     * 路單橫躺到最底，中間留給注區，上方整片留給發牌。
     *
     * 判準跟 CSS 與 ui/useIsCompact.ts 的 LANDSCAPE_DOCK_QUERY 是同一組數字。
     * 用畫面比例判斷而不是等面板回報 inset，第一次排版就會走對分支。
     */
    private layout(w: number, h: number): void {
        if (h <= 560 && w >= h) this.layoutLandscape(w, h);
        else this.layoutStacked(w, h);
    }

    /**
     * 直式與桌面：路圖在上、牌在中、座位與階段膠囊夾在中間、注區在下、操作面板貼底。
     */
    private layoutStacked(w: number, h: number): void {
        // 「窄」與「矮」是**兩件不同的事**，各自要縮的東西也不同：窄要縮字與注區寬度，
        // 矮要縮注區高度。原本只有一個 `narrow` 同時管兩者，於是手機直式（窄但一點都不矮）
        // 被套上了為橫放設計的矮版注區，白白把垂直空間讓掉
        const narrow = w < 760;
        const short = h < 560;
        const portrait = h > w * 1.15;

        // ---- 下注區 ----
        // **先算它**，因為它是唯一位置固定的一段：從畫面底往上長，只跟操作面板的高度有關，
        // 不受上面兩段影響。有了它的上緣，才知道路圖與牌區總共能分多少（見下面的 roadH）
        const betW = Math.min(w * 0.94, 720);
        const betX = (w - betW) / 2;
        const gap = 8;
        // 縮高度看的是**矮**不是窄：手機直式再窄，垂直方向也有的是空間，
        // 把注區壓矮只會讓最常被點的兩區變得難點
        const smallH = short ? 44 : 54;
        const bigH = short ? 58 : 72;
        // 讓開畫面下緣的操作面板。高度是 HUD 那側**實測**回報的（見 store 的 dockHeight）——
        // 面板高度會隨語言、玩法、視窗寬度變，寫死的話總有一種組合會讓莊閒兩個大注區
        // 被蓋掉一半，而它們正是最常被點的兩區。store 還沒回報時退回一個保守值
        const dock = arcadeState().dockInset.bottom || (narrow ? 250 : 180);
        const betBottom = h - dock - 10;
        const bigY = betBottom - bigH;
        const smallY = bigY - smallH - gap;

        this.placeBets(betX, betW, smallY, bigY, smallH, bigH, gap);
        this.chipPx = Math.max(15, Math.min(24, smallH * 0.42));
        this.chipLayer?.setChipSize(this.chipPx);
        this.relayoutChips();

        // 我沒有座位（是路過的），籌碼從操作面板那一側上來
        this.myOrigin = { x: w / 2, y: betBottom + 34 };
        this.houseAt = { x: w / 2, y: smallY - 40 };

        // ---- 階段膠囊 ----
        // 貼在注區正上方。它是玩家**每一秒都要瞄一眼**的東西，放在注區旁邊才不必來回移動視線
        const bannerY = smallY - BANNER_H - 8;
        const bannerW = Math.min(210, betW * 0.46);
        this.banner?.setBoxSize(bannerW, BANNER_H);
        this.banner?.position.set(betX + (betW - bannerW) / 2, bannerY);
        this.badge?.position.set(betX + 2, bannerY + (BANNER_H - 22) / 2);

        // ---- 路圖區 ----
        // 豎屏時右上角有語言鈕，路圖得整個往下讓——不讓的話被壓住的正好是最右邊那幾欄，
        // 而那是最新的幾局，也就是最常被看的部分
        const roadY = portrait ? topBarH(uiScale(w, h)) + 24 : 12;

        // 「路圖是參考資訊，牌才是主角，所以路圖先讓步」——這句話原本只寫在 ROAD_RATIO 的
        // 註解裡，實際的程式卻是路圖照比例吃滿、牌撿剩下的。豎屏就是這個落差爆出來的地方：
        // 垂直空間要分給三段，路圖照橫屏的比例吃完，牌只剩 47px，點數根本讀不出來。
        //
        // 所以改成**先問牌**：算出「要讓牌長到看得清點數，路圖最多能佔多高」，路圖就縮到那裡。
        const roadIdeal = Math.min((h - roadY) * ROAD_RATIO, ROAD_MAX);
        // 由牌區的高度公式反解，再扣掉階段膠囊那一條
        const roadForComfort = bannerY - roadY - 28 - TOTAL_LABEL_H - CARD_COMFORT_W * 2.5;
        // 讓步有底線：格子小到看不出顏色與拖尾，路圖就不再是資訊而只是一片網格
        const roadH = Math.max(ROAD_MIN, Math.min(roadIdeal, roadForComfort));
        const roadW = Math.min(w - 24, 900);
        const roadX = (w - roadW) / 2;

        // 上排（珠盤路 + 大路）拿六成高度，下排三張衍生路分剩下的
        const topH = roadH * 0.58;
        const botH = roadH - topH - 6;
        const beadW = Math.min(roadW * 0.3, (topH / ROAD_ROWS) * 12);

        this.roads.bead.setViewport(topH / ROAD_ROWS, beadW, topH);
        this.roads.bead.position.set(roadX, roadY);
        this.roads.big.setViewport(topH / ROAD_ROWS, roadW - beadW - 8, topH);
        this.roads.big.position.set(roadX + beadW + 8, roadY);

        const derivedW = (roadW - 12) / 3;
        const derivedY = roadY + topH + 6;
        this.roads.bigEye.setViewport(botH / ROAD_ROWS, derivedW, botH);
        this.roads.bigEye.position.set(roadX, derivedY);
        this.roads.small.setViewport(botH / ROAD_ROWS, derivedW, botH);
        this.roads.small.position.set(roadX + derivedW + 6, derivedY);
        this.roads.cockroach.setViewport(botH / ROAD_ROWS, derivedW, botH);
        this.roads.cockroach.position.set(roadX + (derivedW + 6) * 2, derivedY);

        this.updateRoads();

        // ---- 牌區與座位 ----
        const cardTop = roadY + roadH + 14;
        const cardSpace = bannerY - cardTop - 10;

        // 寬且高的畫面才排得下「環繞」：三張椅子在左、三張在右，牌夾在中間。
        // 窄畫面退回一列橫排——**這是「六席環繞」這個選擇要付的 RWD 代價**，
        // 硬要在 390px 寬的手機上塞側邊座位，只會讓牌被擠到 40px
        const canFlank = w >= 880 && cardSpace >= 210;
        if (canFlank) {
            this.placeCards(cardTop, cardSpace, w, 92);
            this.placeSeatsFlanking(w, cardTop, cardSpace);
        } else {
            const seatH = short || narrow ? SEAT_H_COMPACT : SEAT_H;
            this.placeSeatsRow(betX, betW, bannerY - seatH - 6, seatH, short || narrow);
            this.placeCards(cardTop, cardSpace - seatH - 6, w, 0);
        }
    }

    /**
     * 手機橫放：面板直立在右側，所以底部整條空了出來給路單。
     *
     * 由下往上疊：路單 → 注區 → 座位列 → 牌。牌拿到最上面那一整塊，因為它是這一局
     * 唯一會動、也最需要被看清楚的東西；路單與注區各自壓到還能用的最小高度。
     */
    private layoutLandscape(w: number, h: number): void {
        const availW = w - arcadeState().dockInset.right;
        // 橫版的頂列只有一列——核對數字在這個尺寸下藏起來、語言鈕移到左上（見 style.css），
        // 所以不必像直式那樣讓開兩列
        const top = 50;
        const bottom = h - 12;

        // ---- 路單：貼底橫躺，五張並列 ----
        // 高度給到能讓格子有 12px 上下就夠——它現在可以往旁邊捲，不必靠變寬來裝下整靴
        const roadH = Math.max(ROAD_MIN, Math.min(76, (bottom - top) * 0.24));
        const roadY = bottom - roadH;
        this.placeRoadStrip(availW, roadY, roadH);
        this.updateRoads();

        // ---- 注區 ----
        // 比直式的矮版再矮一階：這裡連「矮版」都還是太高。40px 仍然點得到，
        // 而每省 10px 牌就大 4px
        const gap = 6;
        const smallH = 30;
        const bigH = 40;
        const betW = Math.min(availW * 0.96, 720);
        const betX = (availW - betW) / 2;
        const bigY = roadY - 8 - bigH;
        const smallY = bigY - smallH - gap;
        this.placeBets(betX, betW, smallY, bigY, smallH, bigH, gap);
        this.chipPx = 15;
        this.chipLayer?.setChipSize(this.chipPx);
        this.relayoutChips();

        this.myOrigin = { x: availW, y: (smallY + bigY) / 2 };
        this.houseAt = { x: availW / 2, y: smallY - 24 };

        // ---- 階段膠囊：橫躺在注區左上，跟座位共用一列 ----
        const stripY = smallY - SEAT_H_COMPACT - 4;
        const bannerW = 150;
        this.banner?.setBoxSize(bannerW, 26);
        this.banner?.position.set(betX, stripY + 6);
        this.badge?.position.set(betX + bannerW + 8, stripY + 8);

        // 座位擠在膠囊右邊那一段
        const seatsX = betX + bannerW + 100;
        this.placeSeatsRow(seatsX, betX + betW - seatsX, stripY, SEAT_H_COMPACT, true);

        // ---- 牌區：頂列到座位列之間整片 ----
        this.placeCards(top, stripY - top - 6, availW, 0);
    }

    /** 五張路並排成一條，各自是一個獨立的捲動視窗。 */
    private placeRoadStrip(availW: number, y: number, roadH: number): void {
        const cell = roadH / ROAD_ROWS;
        const gapX = 6;
        const pad = 6;
        // 珠盤與衍生路給固定的可視欄數，剩下的寬度全給大路——它是看的人最常盯著的那張，
        // 也是唯一會長到幾十欄的。看不到的部分往旁邊捲
        const beadW = 6 * cell;
        const derivedW = 7 * cell;
        // 兩側的留白要**先扣掉再分**。只在定位時用 `max(pad, …)` 補左邊距的話，
        // 這一排的總寬仍然是整個 availW，右緣就會頂出去壓到面板
        const bigW = Math.max(8 * cell, availW - pad * 2 - beadW - derivedW * 3 - gapX * 4);

        let x = Math.max(pad, (availW - (beadW + bigW + derivedW * 3 + gapX * 4)) / 2);
        const put = (road: ScrollableRoad, width: number): void => {
            road.setViewport(cell, width, roadH);
            road.position.set(x, y);
            x += width + gapX;
        };
        put(this.roads.bead, beadW);
        put(this.roads.big, bigW);
        put(this.roads.bigEye, derivedW);
        put(this.roads.small, derivedW);
        put(this.roads.cockroach, derivedW);
    }

    /** 五個注區：三個小的一排、莊閒兩個大的一排。兩套版面共用。 */
    private placeBets(x: number, betW: number, smallY: number, bigY: number, smallH: number, bigH: number, gap: number): void {
        const third = (betW - gap * 2) / 3;
        this.place('playerPair', x, smallY, third, smallH);
        this.place('tie', x + third + gap, smallY, third, smallH);
        this.place('bankerPair', x + (third + gap) * 2, smallY, third, smallH);

        const half = (betW - gap) / 2;
        this.place('player', x, bigY, half, bigH);
        this.place('banker', x + half + gap, bigY, half, bigH);
    }

    /**
     * 座位排成一列。窄畫面與橫放走這條。
     *
     * 六張椅子**平均分佈在整條寬度上**而不是靠攏在中間：靠攏的話它們會跟正中央的牌
     * 疊在一起，而分開之後左右兩端的椅子剛好落在牌的兩側，還是有一點「圍著桌子」的感覺。
     */
    private placeSeatsRow(x: number, width: number, y: number, seatH: number, compact: boolean): void {
        const count = this.seatViews.length;
        const slot = width / count;
        for (let i = 0; i < count; i++) {
            const view = this.seatViews[i];
            view.setSeatSize(Math.min(slot * 0.86, 72), compact);
            view.position.set(x + slot * (i + 0.5), y + seatH * 0.42);
        }
    }

    /**
     * 座位分左右兩排夾住牌區——**真正的「環繞」只在寬螢幕上成立**。
     *
     * 左三右三、上下錯開，中間留給牌。錯開是為了讓三張椅子看起來像沿著桌沿排列，
     * 而不是釘在一條直線上。
     */
    private placeSeatsFlanking(w: number, top: number, space: number): void {
        const seatW = 78;
        const step = Math.min(84, space / 3);
        const startY = top + (space - step * 2) / 2;

        for (let i = 0; i < this.seatViews.length; i++) {
            const view = this.seatViews[i];
            const left = i < 3;
            const row = left ? i : i - 3;
            view.setSeatSize(seatW, false);
            // 中間那張往外推一點，三張連起來是一條弧而不是一條線
            const bulge = row === 1 ? 14 : 0;
            const x = left ? 54 - bulge : w - 54 + bulge;
            view.position.set(x, startY + step * row);
        }
    }

    /**
     * 牌區：算牌多大、莊閒兩堆擺哪、點數標在哪。兩套版面共用。
     *
     * `space` 是這塊區域的高度，`availW` 是扣掉右側面板之後的可用寬度，
     * `sideInset` 是左右各要讓開多少（有側邊座位時才不是 0）。
     */
    private placeCards(top: number, space: number, availW: number, sideInset: number): void {
        const usableW = availW - sideInset * 2;

        // 牌寬取三個上限裡最小的：
        //
        // 1. 76 —— 牌面是烘出來的貼圖，再放大只會糊。
        // 2. 垂直：要塞得下三段——上方的橫放補牌（1.1 倍牌寬）、原牌本身（1.4 倍牌寬）、
        //    底下的點數。點數的字級是固定的，所以先扣掉再除；按比例算的話，牌一小就會
        //    替一行固定高度的字保留過多空間，牌又更小。
        // 3. 橫向：莊閒兩堆各偏離中線 1.85 倍牌寬，一堆本身寬 1.12 倍，合計 4.82 倍，
        //    留一成的邊 → 約 usableW * 0.19。
        this.cardW = Math.max(40, Math.min(76, (space - TOTAL_LABEL_H) / 2.5, usableW * 0.19));

        // 牌組（補牌 + 原牌）總高 2.5 倍牌寬，剩下的空間上下平分；
        // 牌的中心在補牌那段之下 1.8 倍處。不能直接取牌區正中間——
        // 上方要放補牌、下方只放一行點數，兩邊需求不對稱
        const slack = Math.max(0, space - TOTAL_LABEL_H - this.cardW * 2.5);
        const centreY = top + slack / 2 + this.cardW * 1.8;
        this.sideAt = {
            player: { x: availW / 2 - this.cardW * 1.85, y: centreY },
            banker: { x: availW / 2 + this.cardW * 1.85, y: centreY },
        };

        // 牌靴在右上角，牌從那裡發出來
        this.shoeAt = { x: availW - 40, y: top + 10 };

        if (this.playerTotal) this.playerTotal.position.set(this.sideAt.player.x, centreY + this.cardW * 0.95);
        if (this.bankerTotal) this.bankerTotal.position.set(this.sideAt.banker.x, centreY + this.cardW * 0.95);

        // 已經在桌上的牌要跟著新版面走位
        for (let i = 0; i < this.playerCards.length; i++) this.settleCard(this.playerCards[i], 'player', i);
        for (let i = 0; i < this.bankerCards.length; i++) this.settleCard(this.bankerCards[i], 'banker', i);
    }

    private sideAt = {
        player: { x: 0, y: 0 },
        banker: { x: 0, y: 0 },
    };

    /**
     * 把桌上的籌碼搬到注區的新位置。**每次重排都要叫**。
     *
     * 少了這一步，注區移動之後籌碼會整批留在舊座標——手機上位址列一收一放就看得到，
     * 而那些籌碼是玩家判斷「哪一區熱」的依據，飄在注區外面等於在講假話。
     */
    private relayoutChips(): void {
        this.chipLayer?.relayout((spot) => this.spots.get(spot as BetSpot)?.rect() ?? null);
    }

    private place(spot: BetSpot, x: number, y: number, w: number, h: number): void {
        const view = this.spots.get(spot);
        if (!view) return;
        view.position.set(x, y);
        view.setBoxSize(w, h);
    }

    /**
     * 某一邊第 index 張牌該在哪。
     *
     * 前兩張並排**不重疊**——牌面本來就要一眼讀得出點數，疊著就得靠腦補。
     * 第三張（補牌）**橫放在上方**，這是真實桌台的擺法：橫著就一眼看得出「這是補的」，
     * 不必數牌有幾張。
     */
    private cardSlot(side: 'player' | 'banker', index: number): { x: number; y: number; rotation: number } {
        const base = this.sideAt[side];

        if (index < 2) {
            // 1.12 倍牌寬 = 兩張之間留一條窄縫，既不重疊也不會散開像兩堆
            const offset = (index - 0.5) * this.cardW * 1.12;
            return { x: base.x + offset, y: base.y, rotation: 0 };
        }

        // 橫放：轉 90 度之後它佔的高度是「牌寬」，所以往上讓開自己的一半加原牌的一半
        const upright = this.cardW * CARD_ASPECT;
        return {
            x: base.x,
            y: base.y - upright / 2 - this.cardW / 2 - this.cardW * 0.1,
            rotation: Math.PI / 2,
        };
    }

    private settleCard(card: CardView | undefined, side: 'player' | 'banker', index: number): void {
        if (!card) return;
        const slot = this.cardSlot(side, index);
        // resize 期間不做動畫：視窗正在被拖動時，每一幀都補一個 tween 會打架
        gsap.killTweensOf(card);
        card.position.set(slot.x, slot.y);
        card.rotation = slot.rotation;
        card.resize(this.cardW);
    }
}

/**
 * 這一區在這一局中了沒有。
 *
 * 為什麼不能直接看 `payouts`：那是**我的**賠付，我沒押的區永遠是 0，於是「莊贏」那局
 * 只要我押的是閒，莊那一區就不會亮起來。中獎高亮講的是**牌局的結果**，跟我押了什麼無關。
 */
function spotWon(spot: BetSpot, road: { outcome: string; playerPair: boolean; bankerPair: boolean }): boolean {
    switch (spot) {
        case 'player':
        case 'banker':
            return road.outcome === spot;
        case 'tie':
            return road.outcome === 'tie';
        case 'playerPair':
            return road.playerPair;
        case 'bankerPair':
            return road.bankerPair;
    }
}

/** 找一個最接近這個金額的籌碼面額。畫面上要飛的是籌碼，而籌碼只有五種面額 */
function nearestChip(amount: number): ChipValue {
    let best: ChipValue = CHIP_VALUES[0];
    for (const value of CHIP_VALUES) {
        if (value <= amount) best = value;
    }
    return best;
}

/** 賠率標籤。從 PAYOUTS 讀而不是寫死，改賠率時面板會自己跟上 */
function oddsLabel(spot: BetSpot): string {
    const rate = PAYOUTS[spot];
    return rate === 0.95 ? '1 : 0.95' : `1 : ${rate}`;
}

function totalText(color: number): Text {
    const label = new Text({
        text: '',
        style: new TextStyle({
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 26,
            fontWeight: '700',
            fill: color,
            dropShadow: { color: 0x000000, alpha: 0.6, blur: 5, distance: 0, angle: 0 },
        }),
    });
    label.anchor.set(0.5);
    return label;
}

/** gsap 的受控等待。用 delayedCall 而不是 setTimeout，玩法卸載時 gsap 會一起收掉 */
function wait(seconds: number): Promise<void> {
    return new Promise((resolve) => {
        gsap.delayedCall(seconds, resolve);
    });
}
