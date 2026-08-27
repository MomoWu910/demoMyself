import gsap from 'gsap';
import { Container, Text, TextStyle, type Ticker } from 'pixi.js';
import { bakeCardAtlas, CARD_ASPECT, type CardAtlas } from '../../common/cards/atlas';
import { CardView } from '../../common/cards/CardView';
import { bakeChipAtlas, CHIP_VALUES, type ChipAtlas, type ChipValue } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { FlyingChips } from '../../common/chips/FlyingChips';
import { DealSpots } from '../../common/table/DealSpots';
import { PhaseBanner } from '../../common/table/PhaseBanner';
import { computeTableLayout, type Rect, type TableLayout } from '../../common/table/tableLayout';
import { placeRoads } from '../../common/roadmap/placeRoads';
import { ScrollableRoad } from '../../common/roadmap/ScrollableRoad';
import { ChipRail } from '../../common/ui/ChipRail';
import { MoreMenu, type MenuSection } from '../../common/ui/MoreMenu';
import { MySeat } from '../../common/ui/MySeat';
import { StatStrip } from '../../common/ui/StatStrip';
import { TableButton } from '../../common/ui/TableButton';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import { ONLINE_SEAT, type BaccaratS2C, type OtherBet, type Phase, type SeatInfo } from '../../net/games/baccarat';
import { arcadeState, useArcadeStore } from '../../store';
import { getLang, onLangChange, setLang, t, type Lang } from '../../../i18n';
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
 * 牌能長到多寬。
 *
 * 上限是**貼圖的解析度**決定的：牌面烘在 96×134 的格子裡（見 cards/atlas.ts），
 * 在 DPR 2 的螢幕上剛好對應 192 實體像素，再放大就開始糊。改版後中央區拿到了
 * 上半部整片，這個上限第一次真的碰得到——改版前它是 76，因為路圖與注區把高度吃掉了。
 */
const CARD_MAX_W = 96;

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

/**
 * 桌面的疊法。
 *
 * 用具名層級而不是 addChild 的先後順序：順序是隱式的，加一層就得回去數一遍前面有幾個
 * addChild，而且看程式碼的人得自己在腦裡把那串呼叫翻譯成「誰在誰上面」。留 10 的間隔是
 * 為了之後插新層不必動既有的數字。
 *
 * **飛幣要壓過桌面上的每一樣東西，但壓不過操作介面。** 籌碼從座位飛向注區，路徑會橫越
 * 牌區與其他座位——被蓋住的話那顆籌碼會在半路消失再冒出來，看起來像掉幀。反過來，
 * 階段倒數與提示不能被籌碼蓋掉：下注最後五秒正好是籌碼最密的時候，而那也正是玩家最需要
 * 看清楚還剩幾秒的時候。
 */
const Z = {
    ROAD: 10,
    /** 桌面上印著的牌位框。壓在路圖之上、注區之下——它是檯面的一部分，不是介面 */
    FELT: 15,
    TABLE: 20,
    SEAT: 30,
    CARD: 40,
    CHIP: 50,
    UI: 60,
} as const;

/**
 * 一批下注最多演幾顆籌碼——**多人桌最重要的那個上限**。
 *
 * server 每秒推來的注可能有十幾筆、每筆好幾顆，一局十五秒累積下來上百顆。全部照演的話
 * 前幾局還好，跑久了畫面會塞滿到看不出注區，低階手機直接掉幀。
 *
 * 上限要分層才擋得住：一批最多演幾顆、同一批裡同一個注區最多演幾顆，再加上
 * FlyingChips 自己的桌面總量。只擋總量的話，一批猛灌進來還是會瞬間塞滿注區。
 *
 * **被砍掉的只有動畫，不是帳。** 注區角落的金額永遠是 server 給的權威值，
 * 所以「畫面上只飛了 24 顆但總額跳了十萬」是正確的行為，不是 bug。
 */
const BATCH_ANIMATE_MAX = 24;
/** 同一批裡同一個注區最多飛幾顆。不設的話所有人押同一區時會疊成一坨 */
const PER_SPOT_PER_TICK = 5;

/** 中途進桌時，每個注區最多補幾顆「已經在桌上」的籌碼 */
const SNAPSHOT_CHIPS_PER_SPOT = 7;

/**
 * 我自己的籌碼在飛幣層裡用哪個座位編號。
 *
 * 不能跟散客（`ONLINE_SEAT`）共用。飛幣層只認編號，結算時照編號把贏的籌碼送回押注的人
 * 面前（見 FlyingChips.recycle）——共用的話，我贏的那幾顆會飛去線上人數的膠囊上，
 * 而不是回到我自己的座位。改版前沒有這個問題，因為改版前桌上沒有我。
 *
 * 取負數是因為**真實座位的編號是 0..5**，負數不會跟任何一張椅子撞到。
 */
const MY_SEAT = -2;

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
    /** 桌面印刷：閒／莊兩個牌位。沒發牌的時候它讓那塊地方仍然看得出是一張桌子 */
    private readonly feltLayer = new DealSpots();
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

    // ---- 改版後搬進畫布的那一組介面 ----
    // 它們原本是 DOM 的操作面板（見 ui/BaccaratPanel.tsx）。搬進來的理由不是「Pixi 比較
    // 潮」，而是**版面**：面板貼在畫面底時，桌上每一塊都得先讓開它量出來的高度，
    // 於是路單只能擠在最上面。介面跟桌子在同一個座標系之後，位置才由桌子自己說了算
    /** 桌邊的籌碼架。手邊那五顆，可捲 */
    private chipRail: ChipRail | null = null;
    /** 我自己的座位（左偏下）。籌碼從這裡飛出去 */
    private readonly mySeat = new MySeat();
    /** 讀數（左偏上）：本局押注、上一局、牌靴 */
    private readonly stats = new StatStrip();
    /** 右上角的更多，收著籌碼設置與說明 */
    private more: MoreMenu | null = null;
    /** 重複下注。它是**動作**不是選項，所以用虛線邊框那種樣式 */
    private repeatBtn: TableButton | null = null;

    private playerCards: CardView[] = [];
    private bankerCards: CardView[] = [];
    private playerTotal: Text | null = null;
    private bankerTotal: Text | null = null;

    /** 牌從哪裡飛出來。排版時算好，發牌動畫直接用 */
    private shoeAt = { x: 0, y: 0 };
    /** 我自己的籌碼從哪裡飛出來。改版後這裡有我的座位了（見 mySeat） */
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

        // 疊放順序寫在 Z 裡，這裡只負責掛上去。開 sortableChildren 之後掛的順序就不重要了
        ctx.root.sortableChildren = true;
        this.roadLayer.zIndex = Z.ROAD;
        this.feltLayer.zIndex = Z.FELT;
        this.tableLayer.zIndex = Z.TABLE;
        this.seatLayer.zIndex = Z.SEAT;
        this.cardLayer.zIndex = Z.CARD;
        this.chipLayer.zIndex = Z.CHIP;
        this.uiLayer.zIndex = Z.UI;
        ctx.root.addChild(this.roadLayer, this.feltLayer, this.tableLayer, this.seatLayer, this.cardLayer, this.chipLayer, this.uiLayer);

        for (const road of Object.values(this.roads)) this.roadLayer.addChild(road);

        this.buildSpots();
        this.feltLayer.setLabels(t('arcade.bac.player'), t('arcade.bac.banker'));
        this.buildTotals();
        this.buildSeats();
        this.buildDeck();

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

        /**
         * 驗證用的狀態入口，跟 `__ARCADE__` 與 `__PIXI_APP__` 同一個用途
         * （見 core/stage.ts）。
         *
         * 這一版非有不可：桌台的介面整組搬進了畫布之後，**端對端腳本再也不能靠
         * `document.querySelector` 讀狀態**——倒數、延遲、本局押注全都是 Pixi 的 Text，
         * DOM 裡什麼都沒有。與其讓腳本去遍歷場景樹用文字比對（那會綁死在字串與語言上），
         * 不如把權威來源直接開一個口（見 live/tools/live-verify.mjs）。
         */
        (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__ = () => baccaratState();
        ctx.onDispose(() => {
            delete (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__;
        });

        // ---- 倒數與捲動 ----
        // 每幀重算而不是每秒 setInterval：分頁被節流時 interval 會漂，而每幀重算是
        // 從 endsAt 反推的，切回來第一幀就對了（見 net/games/baccarat.ts 的 phase 封包）。
        //
        // 籌碼架的慣性也在這裡推——**捲動器自己不碰 ticker**，那是模組契約的要求
        // （見 InertiaScroller 的說明）：元件自己抓 ticker 就等於多一條沒人回收的生命週期
        ctx.frame((ticker) => {
            this.tickClock(ticker);
            const dt = ticker.deltaMS / 1000;
            this.chipRail?.update(dt);
        });

        // ---- 桌況變了就更新讀數 ----
        // 比對的是**會顯示出來的那幾個欄位**，不是整份 state：倒數秒數每秒都在寫，
        // 跟著它重畫的話讀數一秒重建一次，而那三格數字一局才變兩三次
        const unsubTable = useBaccaratStore.subscribe((st, prev) => {
            if (this.dead) return;
            if (
                st.myTotal !== prev.myTotal ||
                st.lastNet !== prev.lastNet ||
                st.played !== prev.played ||
                st.shoe !== prev.shoe ||
                st.phase !== prev.phase ||
                st.chip !== prev.chip ||
                st.lastBets !== prev.lastBets
            ) {
                this.syncReadouts();
            }
        });
        ctx.onDispose(unsubTable);

        // ---- 餘額與籌碼設置 ----
        // 餘額寫在我自己的座位上（改版前它只在頂列與底部面板）。籌碼設置改了要換整排籌碼，
        // 而且**選中的那顆可能剛好被換掉**——alignChip 負責那件事
        const unsubShell = useArcadeStore.subscribe((st, prev) => {
            if (this.dead) return;
            if (st.balance !== prev.balance) this.mySeat.setBalance(st.balance);
            if (st.chipSet !== prev.chipSet) {
                this.chipRail?.setChips(st.chipSet);
                this.refreshMenu();
                this.alignChip();
            }
        });
        ctx.onDispose(unsubShell);

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

        ctx.onDispose(() => {
            this.cleanupAnimations();
            // gsap 的 tween 與捲動慣性都不在場景樹上，destroy 收不到它們
            this.chipRail?.stop();
            this.mySeat.stop();
        });
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

    /**
     * 桌邊那一組介面：我的座位、籌碼架、重複下注、讀數、更多。
     *
     * 全部掛在 `uiLayer`——它壓在飛幣之上（見 Z）。這件事在改版後變得重要：籌碼從
     * 我的座位飛出去，起點就在籌碼架旁邊，沒有壓過去的話那顆籌碼會從介面底下鑽出來。
     */
    private buildDeck(): void {
        const shell = arcadeState();
        this.mySeat.setPlayer(shell.player.name, shell.player.tint);
        this.mySeat.setBalance(shell.balance);
        this.uiLayer.addChild(this.mySeat, this.stats);

        if (this.chips) {
            this.chipRail = new ChipRail({
                atlas: this.chips,
                // 只寫玩法自己的 store。籌碼面額是**選中的偏好**，不是一個動作，
                // 所以這裡直接寫入，不像下注要繞一趟 server
                onPick: (value) => baccaratState().setChip(value),
            });
            this.chipRail.setChips(shell.chipSet);
            this.chipRail.setSelected(baccaratState().chip);
            this.uiLayer.addChild(this.chipRail);

            this.more = new MoreMenu({
                atlas: this.chips,
                onChipSetChange: (values) => arcadeState().setChipSet(values),
            });
            this.more.setChipSet(shell.chipSet);
            this.uiLayer.addChild(this.more);
        }

        this.repeatBtn = new TableButton({
            label: t('arcade.bac.repeat'),
            variant: 'ghost',
            onTap: () => this.repeatBets(),
        });
        this.uiLayer.addChild(this.repeatBtn);

        this.refreshDeckLabels();
        this.refreshMenu();
        this.alignChip();
        this.syncReadouts();
    }

    /**
     * 重複上一局的注——**一注一注重送**，不是送一包「重複」指令。
     *
     * server 那邊就只認得單筆下注，少一種封包就少一條要維護的路徑。這段邏輯原本住在
     * React 面板裡（見 ui/BaccaratPanel.tsx 的 BetControls），跟著按鈕一起搬過來。
     */
    private repeatBets(): void {
        const st = baccaratState();
        if (st.phase !== 'betting') {
            arcadeState().setNotice('arcade.bac.betClosed');
            return;
        }
        for (const spot of BET_SPOTS) {
            const amount = st.lastBets[spot] ?? 0;
            if (amount > 0) this.sendBet(spot, amount);
        }
    }

    /**
     * 讀數與更多選單的內容。
     *
     * 每次 store 動了就整組重寫。看起來很浪費，但這裡總共不到十個 `Text`，而
     * **省下的是一整套「哪一格該更新」的判斷**——那種判斷漏一格不會壞掉，只會顯示
     * 一個舊數字，是最難發現的一種錯。
     */
    private syncReadouts(): void {
        const st = baccaratState();
        this.stats.setStats([
            { label: t('arcade.bac.totalBet'), value: st.myTotal.toLocaleString() },
            {
                label: t('arcade.bac.net'),
                // 還沒押過任何一局時顯示破折號，而不是 0——0 會被誤讀成「這局平手」
                value: !st.played ? '—' : st.lastNet > 0 ? `+${st.lastNet.toLocaleString()}` : st.lastNet.toLocaleString(),
                hot: st.played && st.lastNet > 0,
            },
            { label: t('arcade.bac.shoe'), value: st.shoe ? String(st.shoe.remaining) : '—' },
        ]);

        const betting = st.phase === 'betting';
        this.chipRail?.setEnabled(betting);
        this.chipRail?.setSelected(st.chip);
        this.repeatBtn?.setEnabled(betting && Object.keys(st.lastBets).length > 0);
    }

    /**
     * 重畫更多選單。
     *
     * 跟讀數分開的理由是**更新頻率差三個數量級**：讀數每次下注都要跟著動，選單只有
     * 換語言或改籌碼設置時才變。混在一起的話，選單展開著的時候每押一注都會重建一次
     * 面板上的文字，看起來就是閃一下。
     */
    private refreshMenu(): void {
        this.more?.setSections(this.menuSections());
        this.more?.setChipSet(arcadeState().chipSet);
    }

    /** 更多選單裡有什麼。數位桌台只有籌碼設置與那段說明——它沒有串流可調 */
    private menuSections(): MenuSection[] {
        return [
            {
                kind: 'chips',
                title: t('arcade.bac.chipSet'),
                hint: t('arcade.bac.chipSetHint'),
            },
            {
                kind: 'segmented',
                title: t('arcade.language'),
                options: [
                    { key: 'en', label: 'EN' },
                    { key: 'zh', label: '中' },
                ],
                value: getLang(),
                // 換語言會觸發 onLangChange，那裡會把整組介面重畫一次（含這張選單），
                // 所以這裡不必自己重排
                onPick: (key) => setLang(key as Lang),
            },
            { kind: 'note', text: t('arcade.serverNote') },
        ];
    }

    private refreshDeckLabels(): void {
        this.more?.setLabel(t('arcade.moreOptions'));
        this.repeatBtn?.setLabel(t('arcade.bac.repeat'));
    }

    private refreshLabels(): void {
        for (const [spot, view] of this.spots) view.setLabels(t(`arcade.bac.${spot}`), oddsLabel(spot));
        this.feltLayer.setLabels(t('arcade.bac.player'), t('arcade.bac.banker'));
        this.applyPhaseLabel(baccaratState().phase);
        this.refreshDeckLabels();
        this.refreshMenu();
        this.alignChip();
        this.syncReadouts();
    }

    /**
     * 讓選中的面額對齊手邊那五顆。
     *
     * 進桌時與改籌碼設置後都要跑一次：`chip` 是上一次選的（存在玩法 store 裡），
     * 而手邊那五顆是外殼 store 的偏好，兩者各自存在。沒對齊的話籌碼架上不會有任何一顆
     * 是亮的，但點注區照樣押得出去——**畫面說我沒選面額，實際上有**，那比按不動更糟。
     */
    private alignChip(): void {
        const set = arcadeState().chipSet;
        if (set.length === 0) return;
        const st = baccaratState();
        if (!set.includes(st.chip)) st.setChip(set[set.length - 1]);
        this.chipRail?.setSelected(baccaratState().chip);
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

        this.flyChip(nearestChip(amount), spot, MY_SEAT, this.myOrigin, 0);
        this.socket?.send({ type: 'bet', spot, amount });
    }

    // ---- 倒數 ----

    /**
     * 每幀從 `endsAt` 反推還剩幾秒。
     *
     * 反推而不是每幀扣一：分頁被切到背景時 ticker 會被節流，累減的版本切回來會停在錯的數字。
     *
     * 算是每幀算，但**兩個消費端都只在整數變了才寫**——膠囊顯示的是整秒，
     * store 裡的 `secondsLeft` 又會觸發 React 重繪，每幀寫一次等於一秒重繪六十遍面板。
     */
    private tickClock(_ticker: Ticker): void {
        if (this.dead) return;
        const st = baccaratState();
        if (st.endsAt === 0) return;

        const left = Math.max(0, (st.endsAt - Date.now()) / 1000);
        const whole = Math.ceil(left);
        if (whole !== this.lastSecond) {
            this.lastSecond = whole;
            this.banner?.setLeft(whole);
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
        this.banner?.setPhase(t(spec.key), spec.countdown);
        // 換階段就讓下一幀無條件重寫一次秒數：現在只有整數變了才寫，不重置的話
        // 新階段的第一個數字剛好等於上一段最後一個時會沿用舊的字
        this.lastSecond = -1;
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
        if (seat === MY_SEAT) return this.myOrigin;
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
        // 我自己的輸贏也飄一個。改版前這個數字只出現在底部面板的「上一局」那一格，
        // 而視線在開牌的那幾秒是釘在桌上的——**結果揭曉的地方應該就是看牌的地方**
        this.mySeat.flashDelta(net);

        // 籌碼回收。贏的飛回押注的人面前，輸的往桌心收——**這一段是多人桌最有感的演出**，
        // 它讓「別人的注」從畫面裝飾變成真的有輸有贏的錢
        this.chipLayer?.recycle(
            (spot) => winners.has(spot),
            (seat) => {
                if (seat === MY_SEAT) return this.mySeat.originPoint();
                if (seat === ONLINE_SEAT) return this.badge?.originPoint() ?? null;
                return this.seatViews[seat]?.originPoint() ?? null;
            },
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
     * 整張桌子的排版。
     *
     * 位置全部由 `computeTableLayout` 算——**這支檔案不再有自己的一套比例**。改版前
     * 這裡有兩套版面（直式與橫放）各自寫死一組數字，而視訊桌台又各複製了一份，
     * 同一個「注區要多高」的決定散在四個地方。現在它只剩「把算好的座標套上去」。
     */
    private layout(w: number, h: number): void {
        // 中央區給到牌用得完的高度就好，多的轉給路單——牌最大就是 CARD_MAX_W，
        // 再高的中央區只是讓那四張牌浮在一片空地中間（見 tableLayout 的 stageMax）
        const L = computeTableLayout(w, h, { stageMax: CARD_MAX_W * 3 + TOTAL_LABEL_H });

        this.placeBets(L.bets);
        // 桌面上散落的籌碼跟著注區的大小走。注區放大之後這些也要跟著大，
        // 不然一疊籌碼會縮在角落像撒了一把沙
        this.chipPx = Math.max(15, Math.min(26, L.bets.smallH * 0.42));
        this.chipLayer?.setChipSize(this.chipPx);
        this.relayoutChips();

        this.banner?.setBoxSize(L.banner.w, L.banner.h);
        this.banner?.position.set(L.banner.x, L.banner.y);

        this.placeSeats(L);
        placeRoads(this.roads, L.roads, ROAD_ROWS);
        this.updateRoads();
        this.placeDeck(L);
        this.placeCards(L.stage);

        // 輸掉的籌碼往桌心收。桌心＝中央區的正中間，也就是荷官站的地方
        this.houseAt = { x: L.stage.x + L.stage.w / 2, y: L.stage.y + L.stage.h / 2 };
    }

    /**
     * 底下那一條與四個角落：我的座位、籌碼架、重複下注、線上人數、讀數、更多鈕。
     *
     * 這些東西改版前全都在 DOM 的操作面板裡。搬上桌之後它們跟著同一套版面計算走，
     * 於是**再也不會有「面板長高一行，盤面就少一行」這件事**——那是改版前每加一個
     * 讀數格都要重新權衡的代價（見 ui/Hud.tsx 的 useDockMeasure）。
     */
    private placeDeck(L: TableLayout): void {
        this.mySeat.position.set(L.mySeat.x, L.mySeat.y);
        this.mySeat.setBoxSize(L.mySeat.w, L.mySeat.h, L.seatCompact || L.variant === 'row');
        // 我的籌碼從自己的頭像飛出去。改版前它從畫面下緣冒出來，因為那時候桌上沒有我
        this.myOrigin = this.mySeat.originPoint();

        this.chipRail?.position.set(L.chipRail.x, L.chipRail.y);
        this.chipRail?.setViewport(L.chipRail.w, L.chipRail.h);

        this.repeatBtn?.position.set(L.repeat.x, L.repeat.y);
        this.repeatBtn?.setBoxSize(L.repeat.w, L.repeat.h);

        this.badge?.position.set(L.online.x, L.online.y);

        this.stats.visible = L.showStats;
        this.stats.position.set(L.stats.x, L.stats.y);
        this.stats.setScale$(L.scale);

        this.more?.place(L.more.x, L.more.y, this.ctx?.screen.width ?? 0, this.ctx?.screen.height ?? 0, L.scale);
    }

    /** 五個注區：三個小的一排、莊閒兩個大的一排。 */
    private placeBets(bets: TableLayout['bets']): void {
        const { x, width, gap } = bets;
        const third = (width - gap * 2) / 3;
        this.place('playerPair', x, bets.smallY, third, bets.smallH);
        this.place('tie', x + third + gap, bets.smallY, third, bets.smallH);
        this.place('bankerPair', x + (third + gap) * 2, bets.smallY, third, bets.smallH);

        const half = (width - gap) / 2;
        this.place('player', x, bets.bigY, half, bets.bigH);
        this.place('banker', x + half + gap, bets.bigY, half, bets.bigH);
    }

    /** 六張椅子照版面給的座標擺。左三右三或一列橫排的決定在 tableLayout 裡 */
    private placeSeats(L: TableLayout): void {
        for (let i = 0; i < this.seatViews.length; i++) {
            const at = L.seats[i];
            if (!at) continue;
            // 手機橫放整列不畫——**藏的是頭像不是座位**，籌碼照樣從這個座標飛出來
            this.seatViews[i].visible = L.showSeats;
            this.seatViews[i].setSeatSize(L.seatSize, L.seatCompact);
            this.seatViews[i].position.set(at.x, at.y);
        }
    }

    /**
     * 牌區：算牌多大、莊閒兩堆擺哪、點數標在哪。
     *
     * 牌寬取三個上限裡最小的：
     *
     * 1. `CARD_MAX_W` —— 牌面是烘出來的貼圖，再放大只會糊。
     * 2. 垂直：要塞得下三段——上方的橫放補牌（1.1 倍牌寬）、原牌本身（1.4 倍牌寬）、
     *    底下的點數。點數的字級是固定的，所以先扣掉再除；按比例算的話，牌一小就會
     *    替一行固定高度的字保留過多空間，牌又更小。
     * 3. 橫向：莊閒兩堆各偏離中線 1.85 倍牌寬，一堆本身寬 1.12 倍，合計 4.82 倍，
     *    留一成的邊 → 約 stage.w * 0.19。
     */
    private placeCards(stage: Rect): void {
        this.cardW = Math.max(40, Math.min(CARD_MAX_W, (stage.h - TOTAL_LABEL_H) / 2.5, stage.w * 0.19));

        // 牌組（補牌 + 原牌）總高 2.5 倍牌寬，剩下的空間上下平分；
        // 牌的中心在補牌那段之下 1.8 倍處。不能直接取牌區正中間——
        // 上方要放補牌、下方只放一行點數，兩邊需求不對稱
        const slack = Math.max(0, stage.h - TOTAL_LABEL_H - this.cardW * 2.5);
        const centreX = stage.x + stage.w / 2;
        const centreY = stage.y + slack / 2 + this.cardW * 1.8;
        this.sideAt = {
            player: { x: centreX - this.cardW * 1.85, y: centreY },
            banker: { x: centreX + this.cardW * 1.85, y: centreY },
        };

        this.feltLayer.place(this.sideAt.player, this.sideAt.banker, this.cardW);

        // 牌靴在中央區右上角，牌從那裡發出來
        this.shoeAt = { x: stage.x + stage.w - 40, y: stage.y + 10 };

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
