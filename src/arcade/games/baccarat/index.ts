import gsap from 'gsap';
import { Container, Text, TextStyle } from 'pixi.js';
import { bakeCardAtlas, CARD_ASPECT, type CardAtlas } from '../../common/cards/atlas';
import { CardView } from '../../common/cards/CardView';
import { bakeChipAtlas, type ChipAtlas } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { ScrollableRoad } from '../../common/roadmap/ScrollableRoad';
import { TOP_BAR } from '../../core/layout';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import type { BaccaratS2C } from '../../net/games/baccarat';
import { arcadeState, useArcadeStore } from '../../store';
import { onLangChange, t } from '../../../i18n';
import { buildBigRoad } from './roadmap';
import { beadMarks, bigRoadMarks, derivedMarks, ROAD_ROWS } from './roadView';
import { baccaratState, useBaccaratStore } from './store';
import { BET_SPOTS, PAYOUTS, type BetSpot, type Card, type Round } from './rules';
import { BANKER, PLAYER, TIE } from '../../theme';

/**
 * 百家樂玩法。
 *
 * 跟老虎機一樣，這支檔案**沒有一行在決定輸贏**——牌是 server 發的，賠付是 server 算的，
 * 這裡只負責把已經確定的結果演得好看（見 net/protocol.ts）。
 *
 * 它跟老虎機的差別，正好是這一頁想證明的事：**大部分的東西不是重寫的**。牌、籌碼、
 * 下注區、路圖網格都來自 `common/`，這支只做三件百家樂才有的事——桌面怎麼排、
 * 牌怎麼發、四張路怎麼從歷史推出來。第三款玩法（龍虎、骰寶）會再一次證明這件事。
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

/** 結算後停留多久才回到下注階段。夠看清楚牌與賠付，又不會讓人等到不耐煩。 */
const RESULT_HOLD = 2.6;

/** 發牌的間隔。太快看不出是一張一張發的，太慢會拖 */
const DEAL_GAP = 0.16;

/** 牌下方那行點數要留多高。字級固定，所以這是常數而不是比例（見 layout） */
const TOTAL_LABEL_H = 34;

// 紅莊藍閒是牌桌的通用語言，**不因為換配色而改**——改了路圖上的紅藍就跟全世界的
// 百家樂桌對不起來。能做的是壓飽和度，讓它們在黑金裡不刺眼（見 theme.ts）
const SPOT_COLOR: Record<BetSpot, number> = {
    player: PLAYER,
    banker: BANKER,
    tie: TIE,
    playerPair: PLAYER,
    bankerPair: BANKER,
};

export class BaccaratModule implements GameModule {
    public readonly id = 'baccarat' as const;

    private ctx: ModuleContext | null = null;
    private socket: FakeSocket<'baccarat'> | null = null;

    private cards: CardAtlas | null = null;
    private chips: ChipAtlas | null = null;

    private readonly roadLayer = new Container();
    private readonly tableLayer = new Container();
    private readonly cardLayer = new Container();

    private readonly roads = {
        bead: new ScrollableRoad({ rows: ROAD_ROWS }),
        big: new ScrollableRoad({ rows: ROAD_ROWS }),
        bigEye: new ScrollableRoad({ rows: ROAD_ROWS }),
        small: new ScrollableRoad({ rows: ROAD_ROWS }),
        cockroach: new ScrollableRoad({ rows: ROAD_ROWS }),
    };

    private spots = new Map<BetSpot, BetSpotView>();

    private playerCards: CardView[] = [];
    private bankerCards: CardView[] = [];
    private playerTotal: Text | null = null;
    private bankerTotal: Text | null = null;

    /** 牌從哪裡飛出來。排版時算好，發牌動畫直接用 */
    private shoeAt = { x: 0, y: 0 };
    /** 牌的寬度，跟著畫面縮放 */
    private cardW = 64;

    /** 結算後回到下注階段的排程。玩法卸載或下一局開始前要收掉 */
    private holdCall: gsap.core.Tween | null = null;

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

        ctx.root.addChild(this.roadLayer);
        ctx.root.addChild(this.tableLayer);
        ctx.root.addChild(this.cardLayer);

        for (const road of Object.values(this.roads)) this.roadLayer.addChild(road);

        this.buildSpots();
        this.buildTotals();

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
        useBaccaratStore.getState().setDealHandler(() => this.requestDeal());
        ctx.onDispose(() => useBaccaratStore.getState().reset());

        // ---- 下注時把籌碼疊即時更新 ----
        // 訂閱 store 而不是在點擊處直接改畫面：下注也可能來自面板（重複下注、清除），
        // 兩條路徑各自更新畫面就會有一條遲早忘了更新
        const unsub = useBaccaratStore.subscribe((s) => this.syncBets(s.bets));
        ctx.onDispose(unsub);

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
        if (!this.chips) return;

        for (const spot of BET_SPOTS) {
            const view = new BetSpotView({
                label: t(`arcade.bac.${spot}`),
                odds: oddsLabel(spot),
                color: SPOT_COLOR[spot],
                chips: this.chips,
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

    private refreshLabels(): void {
        for (const [spot, view] of this.spots) view.setLabels(t(`arcade.bac.${spot}`), oddsLabel(spot));
    }

    // ---- 互動 ----

    /**
     * 點下注區＝加一顆目前面額的籌碼。
     *
     * 餘額在這裡先擋一次，省掉一趟 RTT——**這不是在替代 server 的檢查**，
     * server 那邊仍然會擋（見 baccaratServer.deal），這裡只是讓回饋即時。
     */
    private tapSpot(spot: BetSpot): void {
        const st = baccaratState();
        if (st.phase !== 'betting') return;

        const shell = arcadeState();
        if (st.totalBet + st.chip > shell.balance) {
            shell.setError('insufficient_balance');
            return;
        }
        st.addBet(spot, st.chip);
    }

    private syncBets(bets: Record<string, number | undefined>): void {
        for (const [spot, view] of this.spots) view.setAmount(bets[spot] ?? 0);
    }

    private requestDeal(): void {
        const st = baccaratState();
        const shell = arcadeState();
        if (st.phase !== 'betting' || shell.connection !== 'open') return;
        if (st.totalBet <= 0) {
            shell.setError('no_bet');
            return;
        }

        this.holdCall?.kill();
        this.holdCall = null;
        for (const view of this.spots.values()) view.setWin(false);

        st.setPhase('dealing');
        shell.setError(null);
        this.socket?.send({ type: 'deal', bets: st.bets });
    }

    // ---- 封包 ----

    private onPacket(p: BaccaratS2C): void {
        switch (p.type) {
            case 'welcome':
                arcadeState().setBalance(p.balance);
                // 握手完成才要桌況：路圖是「這一靴」的歷史，中途坐下來也要看得到前面發生過什麼
                this.socket?.send({ type: 'sit' });
                break;

            case 'balance':
                arcadeState().setBalance(p.balance);
                break;

            case 'table':
                baccaratState().setTable(p.history, p.shoe);
                this.updateRoads();
                break;

            case 'dealResult': {
                const st = baccaratState();
                // 淨輸贏在這裡就算得出來，但**不能現在寫進 store**——面板上的「上一局」
                // 會立刻跳出數字，牌都還沒翻就先告訴玩家結果了。所以帶著它進演出，
                // 等牌翻完才一起寫（見 playRound 的結算段）
                const net = p.totalReturn - st.totalBet;
                void this.playRound(p.round, p.payouts, net, p.balance, () => {
                    st.pushHistory(
                        {
                            outcome: p.round.outcome,
                            playerPair: p.round.playerPair,
                            bankerPair: p.round.bankerPair,
                        },
                        p.shoe,
                        p.shoeChanged
                    );
                    this.updateRoads();
                });
                break;
            }

            case 'error':
                arcadeState().setError(p.reason);
                baccaratState().setPhase('betting');
                break;
        }
    }

    // ---- 演出 ----

    /**
     * 把一局演出來：發四張 → 翻閒家 → 翻莊家 → 有補牌就補 → 標中獎區 → 回到下注。
     *
     * **餘額等到牌全部翻完才更新**，跟老虎機等轉軸停穩才跳數字是同一個道理：
     * 先跳數字的話，玩家會從餘額知道結果，後面翻牌就白翻了。
     */
    private async playRound(
        round: Round,
        payouts: Record<BetSpot, number>,
        net: number,
        balance: number,
        onSettled: () => void
    ): Promise<void> {
        this.clearCards();

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
        }
        if (this.dead) return;

        // 閒家先翻，莊家後翻。中間的停頓是刻意的——那一拍就是百家樂的張力所在
        await this.flipSide('player', round.playerTotal);
        if (this.dead) return;
        await this.flipSide('banker', round.bankerTotal);
        if (this.dead) return;

        // 補牌：settleRound 已經算好誰補了幾張，這裡照著演就好
        if (round.player.length > 2) {
            await this.dealCard('player', 2, round.player[2]);
            await this.playerCards[2]?.flip();
            this.setTotal('player', round.playerTotal);
        }
        if (this.dead) return;
        if (round.banker.length > 2) {
            await this.dealCard('banker', 2, round.banker[2]);
            await this.bankerCards[2]?.flip();
            this.setTotal('banker', round.bankerTotal);
        }
        if (this.dead) return;

        // 到這裡結果才對玩家揭曉：餘額、面板上的淨輸贏、中獎區的高亮一起發生
        arcadeState().setBalance(balance);
        baccaratState().setResult(round, payouts, net);
        for (const [spot, view] of this.spots) view.setWin(payouts[spot] > 0);
        onSettled();

        baccaratState().setPhase('result');
        this.holdCall = gsap.delayedCall(RESULT_HOLD, () => {
            if (this.dead) return;
            for (const view of this.spots.values()) view.setWin(false);
            const st = baccaratState();
            st.clearBets();
            st.setPhase('betting');
            this.holdCall = null;
        }) as unknown as gsap.core.Tween;
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
        this.holdCall?.kill();
        this.holdCall = null;
        for (const card of [...this.playerCards, ...this.bankerCards]) {
            card.stop();
            gsap.killTweensOf(card);
        }
        for (const view of this.spots.values()) view.stop();
    }

    // ---- 路圖 ----

    /**
     * 四張路全部從同一份歷史重推。
     *
     * 不做增量更新是刻意的：路圖的增量規則比重推複雜得多（新的一顆可能讓拖尾轉向、
     * 讓後面所有衍生路的判定改變），而一靴最多八十局，全部重算是幾十微秒的事。
     * **能重算就不要維護狀態**——這裡省下來的不是效能，是一整類對不上的 bug。
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
        // （見 common/roadmap/ScrollableRoad 與 roadView 開頭的說明）
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
     * 直式與桌面：路圖在上、牌在中、注區在下、操作面板貼底。
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

        // ---- 路圖區 ----
        // 豎屏時右上角有語言鈕，路圖得整個往下讓——不讓的話被壓住的正好是最右邊那幾欄，
        // 而那是最新的幾局，也就是最常被看的部分
        const roadY = portrait ? TOP_BAR + 24 : 12;

        // 「路圖是參考資訊，牌才是主角，所以路圖先讓步」——這句話原本只寫在 ROAD_RATIO 的
        // 註解裡，實際的程式卻是路圖照比例吃滿、牌撿剩下的。豎屏就是這個落差爆出來的地方：
        // 垂直空間要分給三段，路圖照橫屏的比例吃完，牌只剩 47px，點數根本讀不出來。
        //
        // 所以改成**先問牌**：算出「要讓牌長到看得清點數，路圖最多能佔多高」，路圖就縮到那裡。
        // 空間本來就夠的時候（桌機、iPad 直式）這個上限比 ROAD_MAX 大，等於沒有作用——
        // 路圖只在真的會壓到牌的時候才讓步，不是一律縮小。
        const roadIdeal = Math.min((h - roadY) * ROAD_RATIO, ROAD_MAX);
        // 由牌區的高度公式反解（見下面 cardW 的第 2 條）：
        // cardW * 2.5 = smallY - (roadY + roadH + 14) - 14 - TOTAL_LABEL_H
        const roadForComfort = smallY - roadY - 28 - TOTAL_LABEL_H - CARD_COMFORT_W * 2.5;
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

        // ---- 牌區 ----
        // 夾在路圖與下注區之間，牌的大小跟著剩下的空間走
        const cardTop = roadY + roadH + 14;
        this.placeCards(cardTop, smallY - cardTop - 14, w);
    }

    /**
     * 手機橫放：面板直立在右側，所以底部整條空了出來給路單。
     *
     * 由下往上疊：路單 → 注區 → 牌。牌拿到最上面那一整塊，因為它是這一局唯一會動、
     * 也最需要被看清楚的東西；路單與注區各自壓到還能用的最小高度。
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
        const bigY = roadY - 10 - bigH;
        const smallY = bigY - smallH - gap;
        this.placeBets(betX, betW, smallY, bigY, smallH, bigH, gap);

        // ---- 牌區：頂列到注區之間整片 ----
        this.placeCards(top, smallY - top - 10, availW);
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
     * 牌區：算牌多大、莊閒兩堆擺哪、點數標在哪。兩套版面共用。
     *
     * `space` 是這塊區域的高度，`availW` 是扣掉右側面板之後的可用寬度。
     */
    private placeCards(top: number, space: number, availW: number): void {
        // 牌寬取三個上限裡最小的：
        //
        // 1. 76 —— 牌面是烘出來的貼圖，再放大只會糊。
        // 2. 垂直：要塞得下三段——上方的橫放補牌（1.1 倍牌寬）、原牌本身（1.4 倍牌寬）、
        //    底下的點數。點數的字級是固定的，所以先扣掉再除；按比例算的話，牌一小就會
        //    替一行固定高度的字保留過多空間，牌又更小。
        // 3. 橫向：莊閒兩堆各偏離中線 1.85 倍牌寬，一堆本身寬 1.12 倍，合計 4.82 倍，
        //    留一成的邊 → 約 availW * 0.19。**這裡原本寫的是 w * 0.12**，是憑感覺抓的保守值，
        //    豎屏時它會搶在垂直限制之前生效，把牌壓到 47px——那個尺寸點數根本讀不出來。
        this.cardW = Math.max(40, Math.min(76, (space - TOTAL_LABEL_H) / 2.5, availW * 0.19));

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
