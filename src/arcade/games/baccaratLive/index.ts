import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { bakeChipAtlas, largestChipUnder, nearestChipTo, type ChipAtlas, type ChipValue } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { FlyingChips } from '../../common/chips/FlyingChips';
import { placeRoads } from '../../common/roadmap/placeRoads';
import { ScrollableRoad } from '../../common/roadmap/ScrollableRoad';
import { PhaseBanner } from '../../common/table/PhaseBanner';
import { computeTableLayout, type Rect, type TableLayout } from '../../common/table/tableLayout';
import { ChipRail } from '../../common/ui/ChipRail';
import { MoreMenu, type MenuSection } from '../../common/ui/MoreMenu';
import { MySeat } from '../../common/ui/MySeat';
import { StatStrip } from '../../common/ui/StatStrip';
import { TableButton } from '../../common/ui/TableButton';
import { createVideoLayer, type VideoLayer } from '../../common/video/VideoLayer';
import { createSource, type SourceKind } from '../../common/video/sources';
import type { VideoSource } from '../../common/video/types';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import { ONLINE_SEAT, type OtherBet, type SeatInfo } from '../../net/games/baccarat';
import type { BaccaratLiveS2C, LiveDealt } from '../../net/games/baccaratLive';
import { arcadeState, useArcadeStore } from '../../store';
import { BANKER, IVORY, PLAYER, TIE } from '../../theme';
import { getLang, onLangChange, setLang, t, type Lang } from '../../../i18n';
import { buildBigRoad } from '../baccarat/roadmap';
import { beadMarks, bigRoadMarks, derivedMarks, ROAD_ROWS } from '../baccarat/roadView';
import { OnlineBadge, SeatView } from '../baccarat/seatView';
import { BET_SPOTS, PAYOUTS, type BetSpot } from '../baccarat/rules';
import { liveState, sumBets, useLiveStore, zeroTotals } from './store';

/**
 * 視訊百家樂——**同一張桌子，牌從攝影機來。**
 *
 * 版面、座位、注區、路圖、籌碼全部跟數位那一款一樣，因為**它們本來就該一樣**：
 * 玩家坐的是同一種桌子，規則、賠率、路圖的畫法一個字都沒變。真正換掉的只有中間
 * 那一塊——原本是 Pixi 畫的牌，現在是一塊會播放的矩形。
 *
 * 這個差別看起來只在呈現，實際上改變的是整個因果方向：
 *
 * - 數位桌台：server 決定節奏 → client 照著演
 * - 視訊桌台：**畫面決定節奏** → server 轉述 → client 只能跟上
 *
 * 所以這支模組不排發牌動畫、不決定什麼時候翻牌。**演出的權力交出去了**，
 * 剩下的是對齊與呈現——而那正好讓「同一套元件庫換一種媒介」這件事成立：
 * 注區、飛幣、座位、路圖全是 `common/` 與 `games/baccarat/` 已經寫好的東西。
 *
 * ## 這一頁真正的主題：延遲會吃掉下注時間
 *
 * **玩家做決定的依據是畫面，而畫面是過去式。** server 說還剩三秒，玩家看到的卻是
 * 三秒前拍到的荷官——如果那條線路落後九秒，他畫面上的倒數還有十二秒可以慢慢想，
 * 但實際上早就截止了。這不是 bug，是這個媒介的物理性質，商用平台的做法是**把下注期
 * 設得比畫面短**，用產品規格吃掉延遲。
 *
 * 這件事在畫面上由兩樣東西講：LIVE 徽章的延遲讀數（超過四秒轉紅），以及截止之後
 * 畫面還在演下注期時跳出來的那行 `lagText`。切到公開 HLS 那條線路時延遲會直接跳到
 * 十幾秒——同一顆按鈕、同一個讀數，把「為什麼視訊博弈不用 HLS」從一個規格變成
 * 一件看得見的事。
 *
 * ## 疊層要疊什麼
 *
 * 影片裡已經燒了一份倒數與階段字（那是攝影機拍到的桌邊牌子）。注區上方的階段膠囊
 * 是另一份——**兩份的來源不同**：影片那份是荷官端的時間，膠囊那份是 server 送來、
 * 經過時差校正的時間。網路一差兩個數字就會不一樣，而那正是視訊桌台的日常，
 * 也是玩家真正該信的那一份（下注截止看的是 server，不是畫面）。
 */

/** 多久把串流讀數寫進 store（毫秒）。每幀寫會讓整個 React 面板每幀重繪 */
const STAT_INTERVAL = 250;

/** 視訊面板的最大寬度。再寬下去 640×360 的素材就開始糊了 */
const PANEL_MAX_W = 880;

/** 視訊的長寬比 */
const PANEL_RATIO = 9 / 16;

/**
 * 我自己的籌碼在飛幣層裡用哪個座位編號。
 *
 * 跟數位桌台同一個道理與同一個數字（見 games/baccarat/index.ts 的 MY_SEAT）：不能跟
 * 散客共用 `ONLINE_SEAT`，否則我贏的籌碼會飛去線上人數的膠囊上，而不是回到我的座位。
 */
const MY_SEAT = -2;

/**
 * 桌面的疊法。視訊不在其中——**它沉在畫布底下**（見 common/video/VideoLayer.ts），
 * 所以這幾層全部落在視訊之上，順序只需要決定它們彼此的關係。
 *
 * **飛幣要壓過桌面上的每一樣東西，但壓不過操作介面。** 籌碼從座位飛向注區，路徑會
 * 橫越視訊與其他座位——被蓋住的話那顆籌碼會在半路消失再冒出來，看起來像掉幀。
 * 反過來，階段倒數與提示不能被籌碼蓋掉：下注最後五秒正好是籌碼最密的時候。
 */
const Z = { ROAD: 10, BET: 20, SEAT: 30, CHIP: 50, UI: 60 } as const;

/** 一批別人的注最多演幾顆籌碼。上限只砍動畫，注區角落的金額照樣是 server 給的全額 */
const BATCH_ANIMATE_MAX = 10;
/** 同一批裡單一注區最多演幾顆。只擋總數的話，一批猛灌進來還是會瞬間塞滿某一區 */
const PER_SPOT_PER_TICK = 3;

/** 中途進桌時，單一注區最多撒幾顆代表性的籌碼 */
const SNAPSHOT_CHIPS_PER_SPOT = 6;

/**
 * 延遲大到什麼程度才值得警告（秒）。
 *
 * 0.4~2 秒是自製流的正常範圍，那個落差玩家察覺不到也不必知道。跨過這條線就不一樣了：
 * 畫面上還在下注但注區已經鎖上，不講的話看起來就只是「按不動」。
 */
const LAG_WARN = 1.2;

/** 六張椅子。跟數位桌台同一個數字——同一種桌子該有同樣多的位置 */
const SEAT_COUNT = 6;

export class BaccaratLiveModule implements GameModule {
    readonly id = 'baccaratLive' as const;

    private ctx!: ModuleContext;
    private size = { w: 0, h: 0 };

    private video: VideoLayer | null = null;
    private disposed = false;
    private socket: FakeSocket<'baccaratLive'> | null = null;

    private chips: ChipAtlas | null = null;
    private chipLayer: FlyingChips | null = null;
    private chipPx = 20;

    private readonly roadLayer = new Container();
    private readonly betLayer = new Container();
    private readonly seatLayer = new Container();
    private readonly uiLayer = new Container();

    private readonly spots = new Map<BetSpot, BetSpotView>();
    private readonly seatViews: SeatView[] = [];

    /** 五張路，跟數位桌台一模一樣。路是這一靴的歷史，跟牌是畫的還是拍的無關 */
    private readonly roads = {
        bead: new ScrollableRoad({ rows: ROAD_ROWS }),
        big: new ScrollableRoad({ rows: ROAD_ROWS }),
        bigEye: new ScrollableRoad({ rows: ROAD_ROWS }),
        small: new ScrollableRoad({ rows: ROAD_ROWS }),
        cockroach: new ScrollableRoad({ rows: ROAD_ROWS }),
    };

    private phaseBanner!: PhaseBanner;
    private onlineBadge!: OnlineBadge;

    // ---- 改版後搬進畫布的那一組介面 ----
    // 原本是 DOM 的操作面板（見 ui/LivePanel.tsx）。這一頁比數位桌台更需要搬：
    // 它的面板多了四格串流讀數與一列線路切換，在 760px 寬會堆成三列、吃掉一百多 px，
    // 而畫布那側正好是整站最缺高度的一頁
    private chipRail: ChipRail | null = null;
    private readonly mySeat = new MySeat();
    private readonly stats = new StatStrip();
    private more: MoreMenu | null = null;
    private repeatBtn: TableButton | null = null;

    // ---- 疊在視訊上的那幾樣 ----
    private liveTag!: Text;
    private liveDot!: Graphics;
    private lagText!: Text;

    /** 視訊佔的那塊矩形。疊層照它定位 */
    private rect = { x: 0, y: 0, w: 0, h: 0 };

    /** 我自己的籌碼從哪裡飛出來。改版後這裡有我的座位了（見 mySeat） */
    private myOrigin = { x: 0, y: 0 };
    /** 輸掉的籌碼往這裡收 */
    private houseAt = { x: 0, y: 0 };

    /** 這一局桌上的牌。畫面不畫牌（牌在影片裡），留著是為了讓面板知道發到第幾張 */
    private dealt: LiveDealt[] = [];

    /** 「停止下注」發生在什麼時候（本地時間戳）。延遲警告要靠它算還該顯示多久 */
    private lockedAt = 0;

    private statAt = 0;
    private lastSeconds = -1;

    async mount(ctx: ModuleContext): Promise<void> {
        this.ctx = ctx;
        this.disposed = false;
        liveState.reset();
        this.size = { w: ctx.screen.width, h: ctx.screen.height };

        /**
         * 這一頁自己帶背景——**背景就是那塊視訊。**
         *
         * 舞台平常會墊一層全螢幕的漸層（見 core/stage.ts 的 drawBg），那層是不透明的，
         * 畫在畫布上就等於一張蓋在視訊上的黑紙。症狀騙人：`<video>` 的位置、尺寸、
         * z-index、畫布的 context alpha 全都對，畫面上就是一片底色——連 CSS 給的那圈
         * 金色外框都看不到，因為擋住它的東西**畫在畫布裡**，不在 DOM 的層級關係裡。
         *
         * 卸載時舞台會自己把它開回來。
         */
        ctx.setBackdrop(false);

        /**
         * 建場**必須排在所有 `await` 之前**。
         *
         * 視訊的 `onMetadata` 是在 `await source.start()` 期間觸發的，而它會呼叫
         * `layout()`——那時候 mount 還停在 await 上，後面每一行都還沒執行。任何會被
         * layout 讀到的東西（注區、座位、路圖、疊層 Text）若建在 await 之後，
         * 第一次排版就會踩到一個還是 undefined 的欄位，症狀是 console 裡一句
         * `Cannot read properties of undefined`，而版面靜靜地少算一次。
         */
        this.buildScene();

        // 語言換了要重寫注區名稱，珠盤路上的莊／閒／和也要跟著翻。
        // `onLangChange` 沒有退訂（它是整頁層級的），所以用旗標擋——離桌之後這個
        // callback 還會被呼叫，那時候 spots 裡的東西已經被 destroy 了
        onLangChange(() => {
            if (this.disposed) return;
            this.syncLabels();
            this.syncRoads();
        });

        // ---- 視訊 ----
        const handlers = {
            onStatus: (status: ReturnType<() => VideoSource['status']>) => liveState.set({ status }),
            onError: (err: Error) => liveState.set({ error: err.message }),
            onMetadata: () => this.layout(this.size.w, this.size.h),
        };

        const source = await createSource('dealer', handlers);
        if (this.disposed) {
            source.destroy();
            return;
        }
        this.video = createVideoLayer(source, { parent: ctx.app.canvas.parentElement as HTMLElement });
        await source.start();

        // ---- 連線 ----
        // 進桌要的桌況在收到 welcome 之後才要——寫在 onOpen 裡的話這個 callback
        // 會參照到還在初始化的 socket 自己（數位百家樂踩過同一個坑）
        const socket = new FakeSocket('baccaratLive', {
            onMessage: (packet) => this.handle(packet),
            onStateChange: (state) => arcadeState().setConnection(state),
        });
        this.socket = socket;
        ctx.onDispose(() => socket.close());

        // 面板按下去時只是請這裡送封包出去——只有 server 說了算
        liveState.set({ betHandler: (spot, amount) => this.sendBet(spot, amount) });
        ctx.onDispose(() => liveState.set({ betHandler: null }));

        /**
         * 驗證用的狀態入口，跟 `__ARCADE__` 與 `__PIXI_APP__` 同一個用途
         * （見 core/stage.ts）。
         *
         * 這一版非有不可：桌台的介面整組搬進了畫布之後，**端對端腳本再也不能靠
         * `document.querySelector` 讀狀態**——倒數、延遲、本局押注全都是 Pixi 的 Text，
         * DOM 裡什麼都沒有。與其讓腳本去遍歷場景樹用文字比對（那會綁死在字串與語言上），
         * 不如把權威來源直接開一個口（見 live/tools/live-verify.mjs）。
         */
        (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__ = () => liveState.get();
        ctx.onDispose(() => {
            delete (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__;
        });

        this.watchSource(handlers);

        // ---- 桌況變了就更新讀數 ----
        // 比對的是**會顯示出來的那幾個欄位**：`stats` 每 250ms 就寫一次，跟著整份 state
        // 重畫的話讀數一秒重建四次；而延遲那一格本來就是要跟著它動的，所以它在名單裡
        const unwatchTable = useLiveStore.subscribe((now, prev) => {
            if (this.disposed) return;
            if (
                now.stats !== prev.stats ||
                now.myTotal !== prev.myTotal ||
                now.lastNet !== prev.lastNet ||
                now.played !== prev.played ||
                now.phase !== prev.phase ||
                now.chip !== prev.chip ||
                now.lastBets !== prev.lastBets
            ) {
                this.syncReadouts();
            }
            // 線路切換是選單裡的分段控制項，按下去要立刻換掉高亮的那一段
            if (now.source !== prev.source) this.refreshMenu();
        });
        ctx.onDispose(unwatchTable);

        // ---- 餘額與籌碼設置 ----
        const unwatchShell = useArcadeStore.subscribe((now, prev) => {
            if (this.disposed) return;
            if (now.balance !== prev.balance) this.mySeat.setBalance(now.balance);
            if (now.chipSet !== prev.chipSet) {
                this.chipRail?.setChips(now.chipSet);
                this.refreshMenu();
                this.alignChip();
            }
        });
        ctx.onDispose(unwatchShell);

        // 籌碼架的慣性也在這裡推——捲動器自己不碰 ticker，那是模組契約的要求
        // （見 common/scroll/InertiaScroller.ts）
        ctx.frame((ticker) => {
            this.tick();
            const dt = ticker.deltaMS / 1000;
            this.chipRail?.update(dt);
        });
        ctx.onResize((w, h) => {
            this.size = { w, h };
            this.layout(w, h);
        });
        this.layout(this.size.w, this.size.h);

        ctx.onDispose(() => {
            this.disposed = true;
            this.chipLayer?.stop();
            this.phaseBanner.stop();
            this.onlineBadge.stop();
            for (const view of this.spots.values()) view.stop();
            for (const seat of this.seatViews) seat.stop();
            // gsap 的 tween 與捲動慣性都不在場景樹上，destroy 收不到它們
            this.chipRail?.stop();
            this.mySeat.stop();
            gsap.killTweensOf(this.liveDot);
            this.video?.destroy();
            this.video = null;
        });
    }

    // ---- 建場 -------------------------------------------------------------

    private buildScene(): void {
        const ctx = this.ctx;

        this.chips = bakeChipAtlas(ctx.app);
        // `true` 是「連同底層的 TextureSource 一起還」。不傳的話資源核對會漂亮地回報 0，
        // 而 GPU 上那塊記憶體每進出一次就疊一階（見 core/module.ts 的 DestroyOptions）
        ctx.track(this.chips.source, true);
        this.chipLayer = new FlyingChips(this.chips);

        this.roadLayer.zIndex = Z.ROAD;
        this.betLayer.zIndex = Z.BET;
        this.seatLayer.zIndex = Z.SEAT;
        this.chipLayer.zIndex = Z.CHIP;
        this.uiLayer.zIndex = Z.UI;
        ctx.root.sortableChildren = true;
        ctx.root.addChild(this.roadLayer, this.betLayer, this.seatLayer, this.chipLayer, this.uiLayer);

        for (const road of Object.values(this.roads)) this.roadLayer.addChild(road);

        for (const spot of BET_SPOTS) {
            const view = new BetSpotView({
                label: t(`arcade.bac.${spot}`),
                odds: oddsLabel(spot),
                color: spotColor(spot),
                onTap: () => this.sendBet(spot, liveState.get().chip),
            });
            this.spots.set(spot, view);
            this.betLayer.addChild(view);
        }

        for (let i = 0; i < SEAT_COUNT; i++) {
            const view = new SeatView();
            this.seatViews.push(view);
            this.seatLayer.addChild(view);
        }

        this.phaseBanner = new PhaseBanner();
        this.onlineBadge = new OnlineBadge(2400 + Math.floor(Math.random() * 900));
        this.uiLayer.addChild(this.phaseBanner, this.onlineBadge);

        this.buildVideoOverlay();
        this.buildDeck();
    }

    /**
     * 桌邊那一組介面：我的座位、籌碼架、重複下注、讀數、更多。
     *
     * 跟數位桌台同一套元件、同一個位置——**同一種桌子的介面不該因為牌是拍的就換一個
     * 排法**。唯一不同的是更多選單裡多了兩區：串流讀數與線路切換。
     */
    private buildDeck(): void {
        const shell = arcadeState();
        this.mySeat.setPlayer(shell.player.name, shell.player.tint);
        this.mySeat.setBalance(shell.balance);
        this.uiLayer.addChild(this.mySeat, this.stats);

        if (this.chips) {
            this.chipRail = new ChipRail({
                atlas: this.chips,
                onPick: (value) => liveState.set({ chip: value }),
            });
            this.chipRail.setChips(shell.chipSet);
            this.chipRail.setSelected(liveState.get().chip);
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

    /** 重複上一局的注——一注一注重送，server 那邊就只認得單筆下注 */
    private repeatBets(): void {
        const st = liveState.get();
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
     * 讓選中的面額對齊手邊那五顆（見 games/baccarat/index.ts 的同名方法）。
     */
    private alignChip(): void {
        const set = arcadeState().chipSet;
        if (set.length === 0) return;
        if (!set.includes(liveState.get().chip)) liveState.set({ chip: set[set.length - 1] });
        this.chipRail?.setSelected(liveState.get().chip);
    }

    /**
     * 左上那疊讀數。
     *
     * 只留三格：**延遲**、本局押注、上一局。延遲留在桌上而其餘三個串流讀數收進選單，
     * 判準是「會不會影響下一手怎麼押」——延遲會（它決定畫面比實際慢多少），
     * 緩衝與倍速是實作細節，倍速在追趕時才有意義，而那時候延遲那一格已經先變色了。
     */
    private syncReadouts(): void {
        const st = liveState.get();
        // 四秒是視訊桌台開始不能接受的線——下注只剩幾秒時，畫面慢四秒等於閉著眼睛押
        const hot = st.stats.latency > 4;

        this.stats.setStats([
            { label: t('arcade.live.latency'), value: `${st.stats.latency.toFixed(2)}s`, hot },
            { label: t('arcade.bac.totalBet'), value: st.myTotal.toLocaleString() },
            {
                label: t('arcade.bac.net'),
                value: !st.played ? '—' : st.lastNet > 0 ? `+${st.lastNet.toLocaleString()}` : st.lastNet.toLocaleString(),
                hot: st.played && st.lastNet > 0,
            },
        ]);

        const betting = st.phase === 'betting';
        this.chipRail?.setEnabled(betting);
        this.chipRail?.setSelected(st.chip);
        this.repeatBtn?.setEnabled(betting && Object.keys(st.lastBets).length > 0);
    }

    /** 重畫更多選單。跟讀數分開，因為兩者的更新頻率差三個數量級 */
    private refreshMenu(): void {
        this.more?.setSections(this.menuSections());
        this.more?.setChipSet(arcadeState().chipSet);
    }

    /**
     * 更多選單裡有什麼。
     *
     * 線路切換是這一頁最值得按的一顆按鈕——同一個儀表下，自己寫的那條是零點幾秒，
     * 接真實 CDN 的 HLS 是好幾秒，而**那個差距就是視訊博弈不用 HLS 的全部理由**。
     * 收進選單而不是留在桌上，是因為它一場只會按一兩次，而桌面上每一格都在跟
     * 「這一手要押多少」競爭。
     */
    private menuSections(): MenuSection[] {
        const st = liveState.get();
        return [
            {
                kind: 'stats',
                title: t('arcade.live.stream'),
                stats: [
                    { label: t('arcade.live.buffered'), value: `${st.stats.buffered.toFixed(1)}s` },
                    { label: t('arcade.live.rate'), value: `${st.stats.playbackRate.toFixed(2)}×` },
                    { label: t('arcade.live.stalls'), value: `${st.stats.stalls} / ${st.stats.jumps}` },
                ],
            },
            {
                kind: 'segmented',
                title: t('arcade.live.source'),
                options: [
                    { key: 'dealer', label: t('arcade.live.sourceDealer') },
                    { key: 'public', label: t('arcade.live.sourcePublic') },
                ],
                value: st.source,
                // 只寫 store，不碰播放層。換來源要卸掉舊的那一條，那是資源生命週期的事
                // （見 watchSource）
                onPick: (key) => liveState.set({ source: key as SourceKind }),
            },
            { kind: 'chips', title: t('arcade.bac.chipSet'), hint: t('arcade.bac.chipSetHint') },
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
            { kind: 'note', title: t('arcade.howToPlay'), text: t('arcade.live.help') },
        ];
    }

    private refreshDeckLabels(): void {
        this.more?.setLabel(t('arcade.moreOptions'));
        this.repeatBtn?.setLabel(t('arcade.bac.repeat'));
    }

    /** 把桌上的籌碼搬到注區的新位置。**每次重排都要叫**，不然它們會留在舊座標 */
    private relayoutChips(): void {
        this.chipLayer?.relayout((spot) => this.spots.get(spot as BetSpot)?.rect() ?? null);
    }

    /**
     * 疊在視訊上的那幾樣東西。
     *
     * 全部畫在 Pixi 而不是 DOM——第一版是 DOM 的，視訊沉底之後那條路就斷了
     * （會被畫布蓋住，見 VideoLayer.ts）。
     *
     * **這裡不放倒數，也不放結果。** 兩者影片裡都已經燒好了，而且那一份跟畫面是同步的
     * ——它就是拍到的東西。疊第二份不只是重複，還會蓋住剛翻開的牌，也就是這一局
     * 最值得看的那一秒。
     *
     * 倒數還多一層：注區上方的階段膠囊已經有一份 **server 校正過的**時間，而它就在
     * 要按的地方旁邊。玩家該信的是那一份，視訊上再放第三份只會讓人不知道該看哪個。
     *
     * 留在這裡的只有影片**給不出來**的東西：這條線路現在落後幾秒（LIVE 徽章），
     * 以及截止之後畫面還在演的那幾秒要不要出聲提醒（lagText）。
     *
     * 視訊下緣本來還有一條把延遲畫成紅色區間的倒數條，拿掉了——它是講給讀規格的人聽的，
     * 坐下來玩的人只想知道「現在還能不能押」，而那件事 lagText 一句話就說完了。
     */
    private buildVideoOverlay(): void {
        this.liveDot = new Graphics();
        this.liveDot.circle(0, 0, 4).fill(0xe05a5a);
        // 呼吸的紅點是「畫面活著」最直接的證據——畫面若凍住，第一個看得出來的就是它
        gsap.to(this.liveDot, { alpha: 0.3, duration: 0.7, repeat: -1, yoyo: true, ease: 'sine.inOut' });

        // 靠右：影片裡桌邊那塊 LIVE 牌子在左上角，兩個疊在一起分不出哪個是哪個。
        // 而它們刻意是兩份不同的東西——影片那份是荷官端的，這份是 server 校正過的
        this.liveTag = overlayText('', 12, IVORY, 1);
        this.lagText = overlayText('', 12, 0xe6a15c, 0.5);
        this.lagText.visible = false;

        this.uiLayer.addChild(this.liveDot, this.liveTag, this.lagText);
    }

    /** 換線路。放在這裡而不是讓 React 直接碰播放層——那是資源生命週期的事 */
    private watchSource(handlers: Parameters<typeof createSource>[1]): void {
        let wanted: SourceKind = 'dealer';
        const unsubscribe = useLiveStore.subscribe((s) => {
            if (s.source === wanted || !this.video) return;
            wanted = s.source;
            liveState.set({ error: null, status: 'loading' });
            void createSource(wanted, handlers).then((next) => {
                if (this.disposed) {
                    next.destroy();
                    return;
                }
                void this.video?.swap(next).then(() => this.layout(this.size.w, this.size.h));
            });
        });
        this.ctx.onDispose(unsubscribe);
    }

    // ---- 收封包 -----------------------------------------------------------

    private handle(packet: BaccaratLiveS2C): void {
        switch (packet.type) {
            case 'welcome':
                arcadeState().setBalance(packet.balance);
                this.socket?.send({ type: 'sit' });
                break;

            case 'table': {
                const s = packet.snapshot;
                // 時差校正。我們的 server 就住在同一個分頁裡，這個差值必定是 0——
                // 留著它是因為換成真後端時這裡是唯一要改的地方
                const skew = s.serverNow - Date.now();
                this.dealt = s.dealt;
                liveState.set({
                    phase: s.phase,
                    endsAt: s.endsAt - skew,
                    roundNo: s.round,
                    history: s.history,
                    result: s.openRound ?? null,
                    seats: s.seats,
                    totals: s.totals,
                    myBets: s.myBets,
                    myTotal: sumBets(s.myBets),
                });
                arcadeState().setBalance(s.balance);
                this.syncRoads();
                this.syncSeats(s.seats);
                this.syncAmounts();
                this.scatterSnapshotChips();
                this.setSpotsEnabled(s.phase === 'betting');
                this.syncPhase();
                break;
            }

            case 'phase': {
                const skew = packet.serverNow - Date.now();
                if (packet.phase === 'betting') {
                    // 換局了才清。留到下一局開始才清，玩家才來得及看完上一局的結果與自己押了多少
                    this.dealt = [];
                    this.chipLayer?.clearAll();
                    for (const view of this.spots.values()) view.setWin(false);
                    liveState.set({ result: null, myBets: {}, myTotal: 0, totals: zeroTotals(), lastPayouts: null });
                    this.syncAmounts();
                    // 線上人數每局抖一下。固定的數字看久了會發現它是假的
                    this.onlineBadge.setCount(2400 + Math.floor(Math.random() * 900));
                } else if (packet.phase === 'dealing') {
                    // 從下注期跨出去的那一刻。延遲警告要從這裡起算——玩家的畫面還會
                    // 再演 latency 秒的下注期，那段時間注區已經鎖上了
                    this.lockedAt = Date.now();
                }
                liveState.set({ phase: packet.phase, endsAt: packet.endsAt - skew, roundNo: packet.round });
                this.setSpotsEnabled(packet.phase === 'betting');
                this.syncPhase();
                break;
            }

            case 'deal':
                this.dealt = [...this.dealt, packet.card];
                break;

            case 'reveal':
                this.dealt = this.dealt.map((d) => (d.index < 2 ? { ...d, faceUp: true } : d));
                break;

            case 'seats':
                liveState.set({ seats: packet.seats });
                this.syncSeats(packet.seats);
                break;

            case 'bets':
                liveState.set({ totals: packet.totals });
                this.syncAmounts();
                this.flyBatch(packet.bets);
                break;

            case 'betOk':
                liveState.set({ myBets: packet.myBets, myTotal: sumBets(packet.myBets), totals: packet.totals });
                arcadeState().setBalance(packet.balance);
                this.syncAmounts();
                break;

            case 'settle':
                this.showSettlement(packet);
                break;

            case 'error':
                arcadeState().setError(packet.reason);
                break;
        }
    }

    /**
     * 結算。
     *
     * 數位桌台的同名函式要先等開牌演完才能跑，這裡不必——**演出在影片裡已經播完了**，
     * server 說結算的那一刻，畫面上的牌就是攤開的。少掉的那段等待不是省事，
     * 是把演出權交出去換來的。
     */
    private showSettlement(settle: Extract<BaccaratLiveS2C, { type: 'settle' }>): void {
        const st = liveState.get();
        const net = settle.totalReturn - st.myTotal;

        liveState.set({
            result: settle.round,
            history: [...st.history, settle.road],
            lastPayouts: settle.payouts,
            lastNet: st.myTotal > 0 ? net : st.lastNet,
            played: st.myTotal > 0 || st.played,
            lastBets: st.myTotal > 0 ? { ...st.myBets } : st.lastBets,
        });
        arcadeState().setBalance(settle.balance);
        this.syncRoads();

        for (const spot of BET_SPOTS) {
            this.spots.get(spot)?.setWin(spotWon(spot, settle.road));
        }

        // 誰贏了多少，在他頭像上飄一下
        for (const r of settle.seats) {
            if (r.seat !== ONLINE_SEAT) this.seatViews[r.seat]?.flashDelta(r.delta);
        }
        // 我自己的那一份飄在我的座位上。改版前它只出現在底部面板的「上一局」，
        // 而開牌那幾秒視線是釘在畫面上的
        if (st.myTotal > 0) this.mySeat.flashDelta(net);

        // 籌碼回收：贏的飛回押注的人面前，輸的往上收給莊家
        this.chipLayer?.recycle(
            (spot) => spotWon(spot as BetSpot, settle.road),
            (seat) => this.originOf(seat),
            this.houseAt,
            () => undefined
        );
    }

    // ---- 下注 -------------------------------------------------------------

    /**
     * 送出一注，同時**立刻把籌碼飛出去**。
     *
     * 這是刻意的不對稱：**動畫先走，數字等 server**。
     *
     * 押注要走一趟 RTT（這裡模擬 180~320ms）。等回應才開始飛籌碼的話，手指離開螢幕
     * 到畫面有反應之間會有三分之一秒的空白——在視訊桌台那個空白特別難忍，因為玩家
     * 本來就已經在跟延遲賽跑了（見檔案開頭）。但注區角落的金額**絕不能**同步樂觀更新，
     * 那是帳，帳只有 server 說了算。
     *
     * 所以：**籌碼是「我按了」的回饋，數字是「server 收了」的事實。** 萬一 server
     * 打回來（餘額不足、或截止了），數字不會動，而那顆已經飛出去的籌碼會在這一局結束時
     * 跟其他人的一起被收走——代價可以接受，換來的是整個下注階段的手感。
     *
     * 餘額在這裡先擋一次是為了省一趟往返，不是為了判斷——真正說了算的還是 server。
     */
    private sendBet(spot: BetSpot, amount: number): void {
        const shell = arcadeState();
        if (liveState.get().phase !== 'betting') {
            shell.setNotice('arcade.bac.betClosed');
            return;
        }
        if (shell.connection !== 'open') return;
        if (amount > shell.balance) {
            shell.setError('insufficient_balance');
            return;
        }

        this.flyChip(largestChipUnder(amount), spot, MY_SEAT, this.myOrigin, 0);
        this.socket?.send({ type: 'bet', spot, amount });
    }

    private setSpotsEnabled(on: boolean): void {
        for (const view of this.spots.values()) {
            view.eventMode = on ? 'static' : 'none';
            view.cursor = on ? 'pointer' : 'default';
        }
    }

    /** 注區角落的兩個數字。總額與自己的注都只從 store 讀——那裡的值是 server 給的 */
    private syncAmounts(): void {
        const st = liveState.get();
        for (const [spot, view] of this.spots) view.setAmounts(st.totals[spot] ?? 0, st.myBets[spot] ?? 0);
    }

    private syncLabels(): void {
        for (const [spot, view] of this.spots) view.setLabels(t(`arcade.bac.${spot}`), oddsLabel(spot));
        this.syncPhase();
        this.refreshDeckLabels();
        this.refreshMenu();
        this.syncReadouts();
    }

    private syncSeats(seats: SeatInfo[]): void {
        const bySeat = new Map(seats.map((s) => [s.seat, s]));
        for (let i = 0; i < this.seatViews.length; i++) this.seatViews[i].setInfo(bySeat.get(i) ?? null);
    }

    /**
     * 階段膠囊。
     *
     * 它顯示的是 **server 的時間**，不是畫面的時間——影片裡那份倒數是荷官端的，
     * 延遲多少就差多少。玩家該信的是這一份，所以它擺在注區正上方：
     * **視線在要按的地方，不必為了看倒數抬頭。**
     */
    private syncPhase(): void {
        const st = liveState.get();
        const countdown = st.phase === 'betting';
        this.phaseBanner.setPhase(t(`arcade.live.phase.${st.phase}`), countdown);
    }

    // ---- 籌碼 -------------------------------------------------------------

    /**
     * 把一批別人的注飛進注區。
     *
     * 兩層上限一起作用：整批的總數與單一注區的數量（再加上 FlyingChips 自己的桌面總量）。
     * **被砍掉的只有動畫，不是帳**——注區角落的金額永遠是 server 給的權威值。
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

            const from = this.originOf(bet.seat) ?? this.houseAt;
            for (let k = 0; k < count; k++) {
                this.flyChip(bet.chip, bet.spot, bet.seat, from, index * 0.045);
                index++;
            }
        }

        if (sawCrowd) this.onlineBadge.ping();
    }

    private flyChip(value: ChipValue, spot: BetSpot, seat: number, from: { x: number; y: number }, delay: number): void {
        const view = this.spots.get(spot);
        if (!view || !this.chipLayer) return;
        this.chipLayer.fly(value, spot, seat, from, view.randomChipPoint(this.chipPx), delay);
    }

    /** 某個座位的籌碼從哪裡飛出來。沒有座位的散客走線上人數膠囊（見 seatView.ts） */
    private originOf(seat: number): { x: number; y: number } | null {
        if (seat === MY_SEAT) return this.myOrigin;
        if (seat === ONLINE_SEAT) return this.onlineBadge.originPoint();
        return this.seatViews[seat]?.originPoint() ?? null;
    }

    /**
     * 中途進桌時，照各注區的總額撒一些籌碼上去。
     *
     * **這是視覺化，不是重建。** server 的快照只給總額，給不出「誰押了幾顆什麼面額」。
     * 玩家看到的是「這區很熱」這個正確的資訊，只是每一顆籌碼不對應到某一筆真實的注。
     */
    private scatterSnapshotChips(): void {
        const st = liveState.get();
        for (const spot of BET_SPOTS) {
            const total = st.totals[spot] ?? 0;
            if (total <= 0) continue;

            const count = Math.min(SNAPSHOT_CHIPS_PER_SPOT, Math.max(1, Math.round(Math.log10(total) * 2)));
            const value = nearestChipTo(total / count);
            const view = this.spots.get(spot);
            if (!view) continue;
            for (let i = 0; i < count; i++) {
                this.chipLayer?.place(value, spot, ONLINE_SEAT, view.randomChipPoint(this.chipPx));
            }
        }
    }

    // ---- 路圖 -------------------------------------------------------------

    private syncRoads(): void {
        const history = liveState.get().history;
        const road = buildBigRoad(history);
        const labels = {
            player: t('arcade.bac.short.player'),
            banker: t('arcade.bac.short.banker'),
            tie: t('arcade.bac.short.tie'),
        };
        // 新的一局會自動貼齊最右邊，除非玩家自己捲開去看前面（見 ScrollableRoad 的 atEnd）
        this.roads.bead.setMarks(beadMarks(history, labels));
        this.roads.big.setMarks(bigRoadMarks(road));
        this.roads.bigEye.setMarks(derivedMarks(road, 'bigEye'));
        this.roads.small.setMarks(derivedMarks(road, 'small'));
        this.roads.cockroach.setMarks(derivedMarks(road, 'cockroach'));
    }

    // ---- 版面 -------------------------------------------------------------

    /**
     * 整張桌子的排版。
     *
     * 跟數位桌台走**同一支** `computeTableLayout`——這是改版順手還掉的一筆債：兩張桌子
     * 的版面本來就只差中間那一塊是什麼，卻各自維護了一份幾乎相同的排版程式，
     * 改一個數字要改兩遍。現在這裡只剩「把算好的座標套上去」與「中間那塊是視訊」。
     */
    private layout(w: number, h: number): void {
        const L = computeTableLayout(w, h);

        this.placeBets(L.bets);
        this.chipPx = Math.max(15, Math.min(26, L.bets.smallH * 0.42));
        this.chipLayer?.setChipSize(this.chipPx);
        this.relayoutChips();

        this.phaseBanner.setBoxSize(L.banner.w, L.banner.h);
        this.phaseBanner.position.set(L.banner.x, L.banner.y);

        this.placeSeats(L);
        placeRoads(this.roads, L.roads, ROAD_ROWS);
        this.syncRoads();
        this.placeDeck(L);
        this.placeVideo(L.stage);

        this.houseAt = { x: L.stage.x + L.stage.w / 2, y: L.stage.y + L.stage.h / 2 };
    }

    /** 底下那一條與四個角落。跟數位桌台同一套（見 games/baccarat/index.ts 的 placeDeck） */
    private placeDeck(L: TableLayout): void {
        this.mySeat.position.set(L.mySeat.x, L.mySeat.y);
        this.mySeat.setBoxSize(L.mySeat.w, L.mySeat.h, L.seatCompact || L.variant === 'row');
        this.myOrigin = this.mySeat.originPoint();

        this.chipRail?.position.set(L.chipRail.x, L.chipRail.y);
        this.chipRail?.setViewport(L.chipRail.w, L.chipRail.h);

        this.repeatBtn?.position.set(L.repeat.x, L.repeat.y);
        this.repeatBtn?.setBoxSize(L.repeat.w, L.repeat.h);

        this.onlineBadge.position.set(L.online.x, L.online.y);

        this.stats.visible = L.showStats;
        this.stats.position.set(L.stats.x, L.stats.y);
        this.stats.setScale$(L.scale);

        this.more?.place(L.more.x, L.more.y, this.size.w, this.size.h, L.scale);
    }

    /** 六張椅子照版面給的座標擺 */
    private placeSeats(L: TableLayout): void {
        for (let i = 0; i < this.seatViews.length; i++) {
            const at = L.seats[i];
            if (!at) continue;
            // 手機橫放整列不畫（見 tableLayout 的 showSeats）。視訊桌台更需要這一刀：
            // 中央那塊少 40px 高，等於少 71px 寬
            this.seatViews[i].visible = L.showSeats;
            this.seatViews[i].setSeatSize(L.seatSize, L.seatCompact);
            this.seatViews[i].position.set(at.x, at.y);
        }
    }

    /**
     * 視訊擺在中央那一塊裡。
     *
     * 高度與寬度**同時**受限：16:9 放不進去時由高度決定寬度，否則由寬度決定高度。
     * 素材本身是 `object-fit: cover`（見 style.css），所以框比 16:9 扁或高都不會有黑邊——
     * 但那會裁掉桌面邊緣，所以這裡仍然照原始比例算，讓裁切只發生在四捨五入的那幾 px。
     *
     * **沒有寬度下限。** 一度寫成 `max(200, …)`，想的是「太小就不要再縮了」，但那讓視訊
     * 在空間不足時直接撐破分配給它的那一塊，往下壓到座位上——而重疊比小更難看，
     * 也更難查（看起來像座位排錯位置）。
     */
    private placeVideo(stage: Rect): void {
        const maxW = Math.min(stage.w - 16, PANEL_MAX_W);
        const w = Math.min(maxW, Math.max(1, stage.h) / PANEL_RATIO);
        const h = w * PANEL_RATIO;
        const x = stage.x + (stage.w - w) / 2;
        const y = stage.y + Math.max(0, (stage.h - h) / 2);

        this.rect = { x, y, w, h };
        this.video?.setRect(x, y, w, h);
        this.placeVideoOverlay();
    }

    /** 疊在視訊上的東西全部照 `rect` 定位。字級跟著面板寬度收，不是只跟 uiScale */
    private placeVideoOverlay(): void {
        const { x, y, w, h } = this.rect;
        const k = Math.max(0.6, Math.min(1.2, w / PANEL_MAX_W));

        this.liveTag.style.fontSize = 12 * k;
        this.liveTag.position.set(x + w - 10 * k, y + 9 * k);
        this.liveDot.position.set(x + w - 10 * k - this.liveTag.width - 8 * k, y + 9 * k + this.liveTag.height / 2);
        this.liveDot.scale.set(k);

        // 0.24 而不是正中央：素材的牌區從畫面 37% 開始（見 live/dealerScene.ts 的 SPOTS），
        // 擺中間會**正好蓋住剛翻開的牌**。24% 那條線落在桌號與閒／莊標籤之間，
        // 是畫面上唯一一條橫向的空帶
        this.lagText.style.fontSize = Math.min(13 * k, w * 0.023);
        this.lagText.position.set(x + w / 2, y + h * 0.24);
    }

    /** 五個注區：三個小的一排、莊閒兩個大的一排。 */
    private placeBets(bets: TableLayout['bets']): void {
        const { x, width, gap } = bets;
        const third = (width - gap * 2) / 3;
        this.put('playerPair', x, bets.smallY, third, bets.smallH);
        this.put('tie', x + third + gap, bets.smallY, third, bets.smallH);
        this.put('bankerPair', x + (third + gap) * 2, bets.smallY, third, bets.smallH);

        const half = (width - gap) / 2;
        this.put('player', x, bets.bigY, half, bets.bigH);
        this.put('banker', x + half + gap, bets.bigY, half, bets.bigH);
    }

    private put(spot: BetSpot, x: number, y: number, w: number, h: number): void {
        const view = this.spots.get(spot);
        if (!view) return;
        view.position.set(x, y);
        view.setBoxSize(w, h);
    }

    // ---- 每幀 -------------------------------------------------------------

    private tick(): void {
        if (!this.video) return;

        const stats = this.video.tick();
        const st = liveState.get();

        const now = performance.now();
        if (now - this.statAt >= STAT_INTERVAL) {
            this.statAt = now;
            liveState.set({ stats });
        }

        // 倒數：**由 endsAt 反推**而不是每幀扣一。分頁被切到背景時計時器會被節流，
        // 累減的版本切回來就停在錯的數字
        const left = Math.max(0, (st.endsAt - Date.now()) / 1000);
        const secs = Math.ceil(left);
        if (secs !== this.lastSeconds) {
            this.lastSeconds = secs;
            liveState.set({ secondsLeft: secs });
            this.phaseBanner.setLeft(secs);
        }

        const betting = st.phase === 'betting';

        this.liveTag.text = `LIVE  ${stats.latency.toFixed(1)}s`;
        // 四秒是視訊桌台開始不能接受的線：下注只剩幾秒時，畫面慢四秒等於閉著眼睛押
        this.liveTag.style.fill = stats.latency > 4 ? BANKER : IVORY;

        this.syncLag(betting, stats.latency);
    }

    /**
     * 「你的畫面落後 N 秒，已經停止下注」。
     *
     * 只在**畫面還在演下注期、但實際已經截止**的那段時間顯示，長度正好是延遲。
     * 沒有這行字的話，玩家看到的是倒數還有十秒但注區按不動——那看起來就只是壞了。
     */
    private syncLag(betting: boolean, latency: number): void {
        const within = Date.now() - this.lockedAt < latency * 1000;
        const show = !betting && latency >= LAG_WARN && within;
        this.lagText.visible = show;
        if (show) this.lagText.text = t('arcade.live.lagLocked').replace('{s}', latency.toFixed(1));
    }
}

/** 一個疊在視訊上的文字。`anchorX` 決定它靠左、置中還是靠右 */
function overlayText(content: string, size: number, fill: number, anchorX: number): Text {
    const node = new Text({
        text: content,
        style: new TextStyle({ fontFamily: 'Menlo, monospace', fontSize: size, fill, letterSpacing: 1.5 }),
    });
    node.anchor.set(anchorX, 0);
    // 疊在視訊上的字一律帶陰影：底下是會動的畫面，沒有陰影的話字會在淺色的呢面上消失
    node.style.dropShadow = { color: 0x000000, alpha: 0.75, blur: 6, distance: 2, angle: Math.PI / 2 };
    return node;
}

function spotColor(spot: BetSpot): number {
    if (spot === 'player' || spot === 'playerPair') return PLAYER;
    if (spot === 'banker' || spot === 'bankerPair') return BANKER;
    return TIE;
}

function oddsLabel(spot: BetSpot): string {
    return spot === 'banker' ? '1 : 0.95' : `1 : ${PAYOUTS[spot]}`;
}

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
