import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { bakeChipAtlas, type ChipAtlas, type ChipValue } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { FlyingChips } from '../../common/chips/FlyingChips';
import { ScrollableRoad } from '../../common/roadmap/ScrollableRoad';
import { createVideoLayer, type VideoLayer } from '../../common/video/VideoLayer';
import { createSource, type SourceKind } from '../../common/video/sources';
import type { VideoSource } from '../../common/video/types';
import { topBarH, uiScale } from '../../core/layout';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import type { BaccaratLiveS2C, LiveBet, LiveDealt } from '../../net/games/baccaratLive';
import { BETTING_DURATION } from '../../live/schedule';
import { arcadeState, useArcadeStore } from '../../store';
import { BANKER, GOLD, IVORY, PLAYER, TIE } from '../../theme';
import { onLangChange, t } from '../../../i18n';
import { buildBigRoad } from '../baccarat/roadmap';
import { bigRoadMarks, ROAD_ROWS } from '../baccarat/roadView';
import { BET_SPOTS, PAYOUTS, type BetSpot } from '../baccarat/rules';
import { liveState, sumBets, useLiveStore, zeroTotals } from './store';

/**
 * 視訊百家樂——**同一份規則，換一種媒介。**
 *
 * 規則、路圖、賠率全部沿用數位那一款（`games/baccarat`）一行沒動。真正換掉的只有
 * 一件事：**牌不是這裡畫的，是攝影機拍到的。** 這個差別看起來只在呈現，實際上
 * 改變的是整個因果方向——
 *
 * - 數位桌台：server 決定節奏 → client 照著演
 * - 視訊桌台：**畫面決定節奏** → server 轉述 → client 只能跟上
 *
 * 所以這支模組做的事比數位那款少得多：它不排發牌動畫、不決定什麼時候翻牌，
 * 只把 server 說的事情疊在畫面上。**演出的權力交出去了**，剩下的是對齊與呈現。
 *
 * ## 疊層要疊什麼、不要疊什麼
 *
 * 影片裡已經燒了一份倒數與階段字（那是攝影機拍到的桌邊牌子）。這裡再疊一份不是
 * 重複——**兩份的來源不同**：影片裡那份是荷官端的時間，疊層這份是 server 送來、
 * 經過時差校正的時間。網路一差，兩個數字就會不一樣，而那正是視訊桌台的日常，
 * 也是玩家真正該信的那一份（下注截止看的是 server，不是畫面）。
 *
 * ## 這一頁真正的主題：延遲會吃掉下注時間
 *
 * 把籌碼疊上去只是把數位桌台那一套搬過來，那部分幾乎是免費的（用的是同一組
 * `common/chips` 元件）。視訊桌台獨有的問題在別的地方：
 *
 * **玩家做決定的依據是畫面，而畫面是過去式。** server 說還剩三秒，玩家看到的卻是
 * 三秒前拍到的荷官——如果那條線路落後九秒，他畫面上的倒數還有十二秒可以慢慢想，
 * 但實際上早就截止了。這不是 bug，是這個媒介的物理性質，商用平台的做法是**把下注期
 * 設得比畫面短**，用產品規格吃掉延遲。
 *
 * 所以倒數條上畫了兩段（見 drawBar）：金色是真的還剩多少，紅色是**畫面上還會再演、
 * 但已經押不進去的那一段**。切到公開 HLS 那條線路時紅色會佔滿整條——同一顆按鈕，
 * 同一個儀表，把「為什麼視訊博弈不用 HLS」從一個數字變成一件看得見的事。
 */

/** 多久把串流讀數寫進 store（毫秒）。每幀寫會讓整個 React 面板每幀重繪 */
const STAT_INTERVAL = 250;

/** 視訊面板的最大寬度。再寬下去 640×360 的素材就開始糊了 */
const PANEL_MAX_W = 880;

/** 視訊的長寬比 */
const PANEL_RATIO = 9 / 16;

/**
 * HUD 還沒量到高度時的保底值。
 *
 * HUD 是 React 那側的面板，Pixi 這邊不知道它多高——而它**會變高**：換個語言、
 * 多一段說明，底邊就往上長。正解是讀 `dockInset`（React 那側量好回報的，
 * 見 ui/Hud.tsx 的 useDockMeasure），這個常數只在第一幀還沒回報時用一次。
 *
 * 原本這裡是自己 `querySelector('.dock')` 去量。那在只有視訊的版本剛好能用，
 * 接上注區之後就露餡了：**mount 當下量到的是還沒長到最終高度的面板**，
 * 算出來的可用高度多了一百多 px，注區整排落在面板底下——而視訊還在，
 * 所以看起來只像「注區沒畫出來」。量一次不夠，要跟著它變。
 */
const HUD_FALLBACK = 300;

/**
 * 桌面的疊法。視訊不在其中——**它沉在畫布底下**（見 common/video/VideoLayer.ts），
 * 所以這幾層全部落在視訊之上，順序只需要決定它們彼此的關係。
 *
 * 飛幣壓過路圖與注區，但壓不過倒數與結果：下注最後幾秒正是籌碼最密的時候，
 * 而那也正是玩家最需要看清楚還剩幾秒的時候。
 */
const Z = { BET: 10, ROAD: 20, CHIP: 30, UI: 40 } as const;

/** 一批散客的注最多演幾顆籌碼。上限只砍動畫，注區角落的金額照樣是 server 給的全額 */
const BATCH_ANIMATE_MAX = 10;
/** 同一批裡單一注區最多演幾顆。只擋總數的話，一批猛灌進來還是會瞬間塞滿某一區 */
const PER_SPOT_PER_TICK = 3;

/** 中途進桌時，單一注區最多撒幾顆代表性的籌碼 */
const SNAPSHOT_CHIPS_PER_SPOT = 6;

/**
 * 一列五格所需的最小格寬（未縮放）。窄於它就改回兩列。
 *
 * 這個數字是量出來的：注區的名稱字級是固定的（見 common/chips/BetSpotView），
 * 「B Pair」在 62px 以下就會跟隔壁那格的字撞在一起。
 */
const MIN_SPOT_W = 62;

/** 我自己 vs 散客。視訊桌台看不到別人是誰（見協定裡 LiveBet 的說明），所以只有這兩種 */
const ME = 0;
const CROWD = -1;

/**
 * 延遲大到什麼程度才值得警告（秒）。
 *
 * 0.4~2 秒是自製流的正常範圍，那個落差玩家察覺不到也不必知道。跨過這條線就不一樣了：
 * 畫面上還在下注但注區已經鎖上，不講的話看起來就只是「按不動」。
 */
const LAG_WARN = 1.2;

export class BaccaratLiveModule implements GameModule {
    readonly id = 'baccaratLive' as const;

    private ctx!: ModuleContext;
    private layout = { w: 0, h: 0 };

    private video: VideoLayer | null = null;
    private disposed = false;
    private socket: FakeSocket<'baccaratLive'> | null = null;

    private chips: ChipAtlas | null = null;
    private chipLayer: FlyingChips | null = null;
    private chipPx = 24;

    private readonly betLayer = new Container();
    private readonly roadLayer = new Container();
    private readonly uiLayer = new Container();

    private readonly spots = new Map<BetSpot, BetSpotView>();

    /**
     * **只放大路一張。**
     *
     * 數位桌台那邊有五張（珠盤、大路、三張衍生路），那是因為它有一整片畫面可以用。
     * 疊在視訊上不一樣：這條帶子最多只能吃掉畫面下緣兩成，再多就開始蓋到牌。
     * 五張擠進 60px 的結果實測過——珠盤那格的莊／閒字糊成一團，那時它已經不是資訊了。
     *
     * 留大路而不是珠盤，是因為大路把和局（斜線）與對子（角點）都疊在同一格裡，
     * 一張抵兩張；而真實桌台的玩家看路也是先看大路。
     */
    private readonly roads = {
        big: new ScrollableRoad({ rows: ROAD_ROWS }),
    };

    /**
     * 路圖底下那塊半透明的襯板。
     *
     * 沒有它路圖是讀不出來的：影片裡的桌面本身就印著一片綠色網格，路圖的空心圈疊上去
     * 會跟那些格線混成同一種紋理——**兩種都是「格子裡的線」，眼睛分不開。**
     * 壓一層暗底把影片那半推遠，路圖才會浮起來成為一層資訊。
     */
    private readonly roadPlate = new Graphics();

    // ---- 疊層 ----
    private badge!: Text;
    private badgeDot!: Graphics;
    private countText!: Text;
    private bar!: Graphics;
    private banner!: Text;
    private lagText!: Text;

    /** 視訊面板佔的那塊矩形。籌碼從它的邊緣飛進來，疊層照它定位 */
    private rect = { x: 0, y: 0, w: 0, h: 0 };
    /** 路圖疊在視訊下緣的那一條的高度。倒數條要排在它上面 */
    private roadH = 0;

    /** 下一顆散客籌碼從左邊還是右邊進來。交替是為了讓籌碼流看起來從兩側匯入 */
    private crowdSide = 0;

    /** 這一局桌上的牌。畫面不畫牌（牌在影片裡），留著是為了讓面板知道發到第幾張 */
    private dealt: LiveDealt[] = [];

    /** 「停止下注」發生在什麼時候（本地時間戳）。延遲警告要靠它算還該顯示多久 */
    private lockedAt = 0;

    async mount(ctx: ModuleContext): Promise<void> {
        this.ctx = ctx;
        this.disposed = false;
        liveState.reset();

        this.layout = { w: ctx.screen.width, h: ctx.screen.height };

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

        // ---- Pixi 疊層 ----
        //
        // **這一段必須排在所有 `await` 之前。** 視訊的 `onMetadata` 是在
        // `await source.start()` 期間觸發的，而它會呼叫 `place()`——那時候 mount 還停在
        // await 上，後面每一行都還沒執行。疊層若建在 await 之後，第一次 place 會踩到
        // 一個還是 undefined 的 Text，症狀是 console 裡一句 `Cannot read properties of
        // undefined (reading 'style')`，而版面靜靜地少算一次。
        //
        // 這跟上一版 `panelW` 那個 TDZ 是同一個坑的第二次發作。**判準是：
        // 任何會被 place 讀到的東西，都得在第一個 await 之前就位。**
        this.chips = bakeChipAtlas(ctx.app);
        // `true` 是「連同底層的 TextureSource 一起還」。不傳的話資源核對會漂亮地回報 0，
        // 而 GPU 上那塊記憶體每進出一次就疊一階（見 core/module.ts 的 DestroyOptions）
        ctx.track(this.chips.source, true);
        this.chipLayer = new FlyingChips(this.chips);

        this.betLayer.zIndex = Z.BET;
        this.roadLayer.zIndex = Z.ROAD;
        this.chipLayer.zIndex = Z.CHIP;
        this.uiLayer.zIndex = Z.UI;
        ctx.root.sortableChildren = true;
        ctx.root.addChild(this.betLayer, this.roadLayer, this.chipLayer, this.uiLayer);

        this.roadLayer.addChild(this.roadPlate);
        for (const road of Object.values(this.roads)) this.roadLayer.addChild(road);
        this.buildSpots();
        this.buildOverlay();

        // ---- 視訊 ----
        const handlers = {
            onStatus: (status: ReturnType<() => VideoSource['status']>) => liveState.set({ status }),
            onError: (err: Error) => liveState.set({ error: err.message }),
            onMetadata: () => this.place(),
        };

        const source = await createSource('dealer', handlers);
        if (this.disposed) {
            source.destroy();
            return;
        }
        this.video = createVideoLayer(source, { parent: ctx.app.canvas.parentElement as HTMLElement });
        await source.start();

        // 語言換了要重寫注區名稱，珠盤路上的莊／閒／和也要跟著翻。
        // `onLangChange` 沒有退訂（它是整頁層級的），所以用旗標擋——離桌之後這個
        // callback 還會被呼叫，那時候 spots 裡的東西已經被 destroy 了
        onLangChange(() => {
            if (this.disposed) return;
            this.syncLabels();
            this.syncRoads();
        });

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

        this.watchSource(handlers);

        // 面板長高／改貼右側就要重排。**它比第一次 place 晚定案**——換語言、
        // 多一段說明都會讓它變高，而那時候沒有 resize 事件可以搭便車
        const unwatchDock = useArcadeStore.subscribe((now, prev) => {
            if (now.dockInset !== prev.dockInset && !this.disposed) this.place();
        });
        ctx.onDispose(unwatchDock);

        ctx.frame(() => this.tick());
        ctx.onResize((w, h) => {
            this.layout.w = w;
            this.layout.h = h;
            this.place();
        });
        this.place();

        ctx.onDispose(() => {
            this.disposed = true;
            this.chipLayer?.stop();
            for (const view of this.spots.values()) view.stop();
            this.video?.destroy();
            this.video = null;
        });
    }

    // ---- 建場 -------------------------------------------------------------

    private buildSpots(): void {
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
    }

    /**
     * 疊在視訊上的那幾樣東西。
     *
     * 全部畫在 Pixi 而不是 DOM——第一版是 DOM 的，視訊沉底之後那條路就斷了
     * （會被畫布蓋住，見 VideoLayer.ts）。搬過來反而更順：倒數條要畫兩段不同顏色的
     * 區間，`Graphics` 本來就比三層 div 疊 transition 好寫。
     */
    private buildOverlay(): void {
        this.badgeDot = new Graphics();
        this.badgeDot.circle(0, 0, 4).fill(0xe05a5a);
        // 呼吸的紅點是「畫面活著」最直接的證據——畫面若凍住，第一個看得出來的就是它
        gsap.to(this.badgeDot, { alpha: 0.3, duration: 0.7, repeat: -1, yoyo: true, ease: 'sine.inOut' });
        this.ctx.onDispose(() => gsap.killTweensOf(this.badgeDot));

        // 靠右：影片裡桌邊那塊 LIVE 牌子在左上角，兩個疊在一起分不出哪個是哪個。
        // 而它們刻意是兩份不同的東西——影片那份是荷官端的時間，這份是 server 校正過的
        this.badge = label('', 12, IVORY, 1);
        this.countText = label('', 26, IVORY, 1);
        this.bar = new Graphics();
        this.banner = label('', 26, IVORY, 0.5);
        this.banner.visible = false;
        this.lagText = label('', 12, 0xe6a15c, 0.5);
        this.lagText.visible = false;

        this.uiLayer.addChild(this.bar, this.badgeDot, this.badge, this.countText, this.banner, this.lagText);
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
                void this.video?.swap(next).then(() => this.place());
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
                    totals: s.totals,
                    myBets: s.myBets,
                    myTotal: sumBets(s.myBets),
                });
                arcadeState().setBalance(s.balance);
                this.syncRoads();
                this.syncAmounts();
                this.scatterSnapshotChips();
                this.setSpotsEnabled(s.phase === 'betting');
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
                } else if (packet.phase === 'dealing') {
                    // 從下注期跨出去的那一刻。延遲警告要從這裡起算——玩家的畫面還會
                    // 再演 latency 秒的下注期，那段時間注區已經鎖上了
                    this.lockedAt = Date.now();
                }
                liveState.set({ phase: packet.phase, endsAt: packet.endsAt - skew, roundNo: packet.round });
                this.setSpotsEnabled(packet.phase === 'betting');
                break;
            }

            case 'deal':
                this.dealt = [...this.dealt, packet.card];
                break;

            case 'reveal':
                this.dealt = this.dealt.map((d) => (d.index < 2 ? { ...d, faceUp: true } : d));
                break;

            case 'bets':
                liveState.set({ totals: packet.totals });
                this.syncAmounts();
                this.flyBatch(packet.bets);
                break;

            case 'betOk': {
                liveState.set({ myBets: packet.myBets, myTotal: sumBets(packet.myBets), totals: packet.totals });
                arcadeState().setBalance(packet.balance);
                this.syncAmounts();
                break;
            }

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

        // 籌碼回收：贏的飛回押注的人面前，輸的往上收給莊家
        this.chipLayer?.recycle(
            (spot) => spotWon(spot as BetSpot, settle.road),
            (seat) => (seat === ME ? this.myOrigin() : this.crowdOrigin(seat)),
            { x: this.rect.x + this.rect.w / 2, y: this.rect.y },
            () => undefined
        );
    }

    // ---- 下注 -------------------------------------------------------------

    /**
     * 送一注出去。
     *
     * 這裡**不動任何狀態**——不加注區金額、不扣餘額、不先飛籌碼。押出去不能撤，
     * 所以在 server 確認之前就宣稱錢已經押了是最糟的一種樂觀更新：被拒的話畫面要倒回去，
     * 而玩家已經看過那個數字了。中間那段 RTT 由 `betOk` 到達時的籌碼動畫蓋掉。
     *
     * 餘額在這裡先擋一次是為了省一趟往返，不是為了判斷——真正說了算的還是 server
     * （它可能因為截止或別的原因拒絕）。
     */
    private sendBet(spot: BetSpot, amount: number): void {
        const st = liveState.get();
        if (st.phase !== 'betting') return;
        if (amount > arcadeState().balance) {
            arcadeState().setError('insufficient_balance');
            return;
        }
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
    }

    // ---- 籌碼 -------------------------------------------------------------

    /**
     * 把一批散客的注飛進注區。
     *
     * 兩層上限一起作用：整批的總數與單一注區的數量（再加上 FlyingChips 自己的桌面總量）。
     * **被砍掉的只有動畫，不是帳**——注區角落的金額永遠是 server 給的權威值。
     */
    private flyBatch(bets: LiveBet[]): void {
        let budget = BATCH_ANIMATE_MAX;
        const perSpot = new Map<BetSpot, number>();
        let index = 0;

        for (const bet of bets) {
            if (budget <= 0) break;
            const used = perSpot.get(bet.spot) ?? 0;
            if (used >= PER_SPOT_PER_TICK) continue;

            const count = Math.min(bet.count, PER_SPOT_PER_TICK - used, budget);
            perSpot.set(bet.spot, used + count);
            budget -= count;

            for (let k = 0; k < count; k++) {
                this.flyChip(bet.chip, bet.spot, CROWD, this.crowdOrigin(CROWD), index * 0.045);
                index++;
            }
        }
    }

    private flyChip(value: ChipValue, spot: BetSpot, seat: number, from: { x: number; y: number }, delay: number): void {
        const view = this.spots.get(spot);
        if (!view || !this.chipLayer) return;
        this.chipLayer.fly(value, spot, seat, from, view.randomChipPoint(this.chipPx), delay);
    }

    /**
     * 散客的籌碼從畫面兩側交替進來。
     *
     * 數位桌台可以讓籌碼從某張椅子飛出來，這裡不行——**視訊桌台看不到別人**。
     * 那正是這個媒介的實情：注區上有幾百萬的注量，但你不知道那是誰押的。
     */
    private crowdOrigin(_seat: number): { x: number; y: number } {
        const left = (this.crowdSide++ & 1) === 0;
        return { x: left ? this.rect.x - 20 : this.rect.x + this.rect.w + 20, y: this.rect.y + this.rect.h * 0.55 };
    }

    /** 我自己的籌碼從注區列底下飛出來，也就是「我坐的位置」 */
    private myOrigin(): { x: number; y: number } {
        return { x: this.layout.w / 2, y: this.layout.h };
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
            const value = nearestChip(total / count);
            const view = this.spots.get(spot);
            if (!view) continue;
            for (let i = 0; i < count; i++) {
                this.chipLayer?.place(value, spot, CROWD, view.randomChipPoint(this.chipPx));
            }
        }
    }

    // ---- 路圖 -------------------------------------------------------------

    private syncRoads(): void {
        // 新的一局會自動貼齊最右邊，除非玩家自己捲開去看前面（見 ScrollableRoad 的 atEnd）
        this.roads.big.setMarks(bigRoadMarks(buildBigRoad(liveState.get().history)));
    }

    // ---- 版面 -------------------------------------------------------------

    /**
     * 版面的順序是**先給注區，剩下的才給視訊**。
     *
     * 反過來做（先把視訊放到最大、注區撿剩下的）在矮視窗上會算出一排 20px 高的注區，
     * 那時候它已經按不到了。視訊小一點還是看得懂，注區小到按不到就是壞的——
     * 所以讓步的是視訊。
     */
    private place(): void {
        const s = uiScale(this.layout.w, this.layout.h);
        const top = topBarH(s);

        // 面板可能貼在底部，也可能貼在右側（手機橫放，見 store 的 dockInset）。
        // 兩邊的值都是 React 那側量好回報的，含它自己留的外邊距。
        //
        // **`bottom` 是 0 不代表沒量到**——面板貼右側時它本來就該是 0。原本這裡寫
        // `inset.bottom || HUD_FALLBACK`，於是手機橫放時保底值 300 被當成面板高度，
        // 從 390 的畫面高裡憑空扣掉，視訊被算成 160×90。**用 `||` 給數值填預設，
        // 只要 0 是合法值就會出事**，而 0 在這裡不但合法還很常見
        const inset = arcadeState().dockInset;
        const measured = inset.bottom > 0 || inset.right > 0;
        const hudTop = this.layout.h - (measured ? inset.bottom : HUD_FALLBACK * s);
        const availH = Math.max(160 * s, hudTop - top - 16 * s);
        const availW = this.layout.w - inset.right;

        const gap = 8 * s;
        /**
         * 注區排**一列**，不是數位桌台那種上下兩列。
         *
         * 兩列在這一頁量出來是壞的：可用高度扣掉視訊之後，每一列只剩四十幾 px，
         * 而注區裡本來就疊著標題、賠率、兩個金額——籌碼落下去必定壓在名稱上，
         * 而名稱正是最後五秒搶著押的時候唯一需要看清楚的東西。
         *
         * 一列的話同樣的總高度全給一排，主注區有六七十 px，籌碼才有地方落。
         * 順帶一提這也是真實視訊桌台的排法：對子在兩側、閒莊在中間、和局居中。
         */
        const betH = Math.min(104 * s, Math.max(64 * s, availH * 0.3));
        const videoAvail = Math.max(90 * s, availH - betH - gap * 2);

        const w = Math.min(availW - 32 * s, PANEL_MAX_W * s, videoAvail / PANEL_RATIO);
        const h = w * PANEL_RATIO;
        const x = (availW - w) / 2;
        // 置中的是**視訊加注區這一整組**，不是只有視訊。只置中視訊的話，寬度被畫面
        // 卡住（豎屏就是這樣）時多出來的高度全部落在注區底下，整組看起來被推到上面去
        const y = top + Math.max(8 * s, (availH - (h + gap + betH)) / 2);

        this.rect = { x, y, w, h };
        this.video?.setRect(x, y, w, h);

        // 路圖疊在視訊下緣。素材的牌區底邊落在畫面 79% 的位置（見 live/dealerScene.ts
        // 的 SPOTS），所以疊到 26% 高只會蓋掉桌面的空地與影片自己燒的那行階段字——
        // 後者疊層已經有一份更準的（server 校正過），蓋掉不損失資訊
        // 高度不是隨手挑的：素材下緣那條帶子（畫面 78% 以下）印著影片自己燒的階段字與
        // 倒數，路圖蓋不滿就會露出半個數字，看起來像沒對齊。**要嘛完全不蓋，要嘛蓋滿**——
        // 蓋滿沒有損失，那兩樣疊層各有一份更準的（server 校正過的時間）
        this.roadH = Math.min(80 * s, Math.max(42 * s, h * 0.24));
        const roadY = y + h - this.roadH;
        this.roads.big.setViewport(this.roadH / ROAD_ROWS, w, this.roadH);
        this.roads.big.position.set(x, roadY);

        this.roadPlate.clear();
        this.roadPlate.rect(x, roadY, w, this.roadH).fill({ color: 0x000000, alpha: 0.92 });
        // 上緣一條金線把路圖跟影片切開。沒有這條線，襯板的上邊界會看起來像影片本身的陰影
        this.roadPlate.rect(x, roadY, w, Math.max(1, s)).fill({ color: GOLD, alpha: 0.35 });

        // 疊層
        this.badge.style.fontSize = 12 * s;
        this.badge.position.set(x + w - 10 * s, y + 9 * s);
        this.badgeDot.position.set(x + w - 10 * s - this.badge.width - 8 * s, y + 9 * s + this.badge.height / 2);
        this.badgeDot.scale.set(s);

        // 字級跟著面板寬度收：矮視窗上視訊只有三百多 px 寬，固定 26px 的數字
        // 會大到跟影片裡桌邊那份倒數打架
        this.countText.style.fontSize = Math.min(26 * s, w * 0.075);
        this.countText.position.set(x + w - 12 * s, roadY - 8 * s - this.countText.height);

        this.banner.style.fontSize = Math.min(30 * s, w * 0.055);
        // 0.24 而不是正中央：素材的牌區從畫面 37% 開始（見 live/dealerScene.ts 的 SPOTS），
        // 橫幅擺中間會**正好蓋住剛翻開的牌**——而那是這一局最值得看的一秒。
        // 24% 那條線落在桌號與閒／莊標籤之間，是畫面上唯一一條橫向的空帶
        this.banner.position.set(x + w / 2, y + h * 0.24);

        // 字級跟著面板寬度收，而不是只跟 uiScale：視訊在矮視窗上會被壓到四百多 px 寬，
        // 固定字級的那行字會直接跨出視訊、落到旁邊的黑底上
        this.lagText.style.fontSize = Math.min(13 * s, w * 0.023);
        // 跟結果橫幅同一條線：兩者不會同時出現（延遲提示只在剛截止的那幾秒，
        // 那時這一局的結果還沒出來），共用同一塊空帶就不必各找各的位置
        this.lagText.position.set(x + w / 2, y + h * 0.24);

        const betY = y + h + gap;
        const units = 1 + 1.6 + 1 + 1.6 + 1;
        const unit = (w - gap * 4) / units;

        // 籌碼大小由**最矮的那一格**決定（見下面的 chipPx）。兩列時對子那一列比主注矮，
        // 拿主注的高度去算，籌碼就會在對子區壓住名稱與底下的金額
        let minSpotH = betH;

        if (unit >= MIN_SPOT_W * s) {
            // 一列五格。閒莊比對子與和局寬——注量差得遠，畫面上的份量也該差得遠
            let bx = x;
            for (const [spot, k] of [
                ['playerPair', 1],
                ['player', 1.6],
                ['tie', 1],
                ['banker', 1.6],
                ['bankerPair', 1],
            ] as Array<[BetSpot, number]>) {
                this.put(spot, bx, betY, unit * k, betH);
                bx += unit * k + gap;
            }
        } else {
            // 窄畫面回到兩列。**字擠到重疊比籌碼壓字更糟**——籌碼壓住的是賠率
            // （次要資訊，而且會動，看得出底下有東西），名稱糊掉的話玩家根本
            // 不知道自己在按哪一區
            const smallH = betH * 0.44;
            const bigH = betH - smallH - gap * 0.5;
            minSpotH = smallH;
            const third = (w - gap * 2) / 3;
            this.put('playerPair', x, betY, third, smallH);
            this.put('tie', x + third + gap, betY, third, smallH);
            this.put('bankerPair', x + (third + gap) * 2, betY, third, smallH);

            const half = (w - gap) / 2;
            const bigY = betY + smallH + gap * 0.5;
            this.put('player', x, bigY, half, bigH);
            this.put('banker', x + half + gap, bigY, half, bigH);
        }

        // 籌碼跟著注區縮放。已經落桌的那些要重新對位——版面變了（轉向、位址列收放），
        // 只記絕對座標的話桌上的籌碼會整批留在原地
        this.chipPx = Math.max(12, Math.min(22 * s, minSpotH * 0.34));
        this.chipLayer?.setChipSize(this.chipPx);
        this.chipLayer?.relayout((spot) => this.spots.get(spot as BetSpot)?.rect() ?? null);
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
        }

        const betting = st.phase === 'betting';
        this.countText.text = betting ? String(secs) : '';
        this.drawBar(betting, left, stats.latency);

        this.badge.text = `LIVE  ${stats.latency.toFixed(1)}s`;
        // 四秒是視訊桌台開始不能接受的線：下注只剩幾秒時，畫面慢四秒等於閉著眼睛押
        this.badge.style.fill = stats.latency > 4 ? BANKER : IVORY;

        this.syncBanner(st.result, betting);
        this.syncLag(betting, stats.latency);
    }

    /**
     * 倒數條的兩段。
     *
     * - **金色**：server 說的真實剩餘時間
     * - **紅色**：畫面上還會再演、但已經押不進去的那一段，長度正好是延遲
     *
     * 玩家看到的倒數是 `left + latency`（他看的是 latency 秒前拍到的畫面），
     * 所以紅色接在金色右邊——它就是「畫面以為還有，實際上沒有」的那一截。
     * 截止之後金色歸零而紅色還在，意思很直白：**你現在看到的整段下注期都是過去式。**
     */
    private drawBar(betting: boolean, left: number, latency: number): void {
        const g = this.bar;
        g.clear();

        // 只在下注期畫。其他階段留一條不會動的線只會讓人以為卡住了
        if (!betting && latency < LAG_WARN) return;

        const { x, w, y, h } = this.rect;
        const barY = y + h - this.roadH - 5 * (w / (PANEL_MAX_W * 0.9));
        const barH = Math.max(3, this.roadH * 0.06);
        const px = (secs: number): number => (Math.max(0, secs) / BETTING_DURATION) * w;

        const live = Math.min(w, px(left));
        const lag = Math.min(w - live, px(Math.min(latency, BETTING_DURATION)));

        if (live > 0) g.rect(x, barY, live, barH).fill({ color: left <= 3 ? BANKER : GOLD });
        if (lag > 0) g.rect(x + live, barY, lag, barH).fill({ color: BANKER, alpha: 0.45 });
    }

    private syncBanner(result: ReturnType<typeof liveState.get>['result'], betting: boolean): void {
        this.banner.visible = result != null && !betting;
        if (!result) return;

        const who =
            result.outcome === 'tie'
                ? t('arcade.live.tie')
                : t(result.outcome === 'player' ? 'arcade.live.playerWins' : 'arcade.live.bankerWins');
        this.banner.text = `${who}  ${result.playerTotal} : ${result.bankerTotal}`;
        this.banner.style.fill = spotColor(result.outcome === 'tie' ? 'tie' : result.outcome);
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

    private statAt = 0;
    private lastSeconds = -1;
}

/** 一個疊層文字。`anchorX` 決定它靠左、置中還是靠右 */
function label(content: string, size: number, fill: number, anchorX: number): Text {
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

/** 撒快照籌碼時挑一個看起來合理的面額 */
function nearestChip(target: number): ChipValue {
    const values: ChipValue[] = [25, 50, 100, 500, 1000];
    let best = values[0];
    for (const v of values) if (Math.abs(v - target) < Math.abs(best - target)) best = v;
    return best;
}
