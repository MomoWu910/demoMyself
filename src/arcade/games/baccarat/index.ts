import gsap from 'gsap';
import { Container, Text, TextStyle } from 'pixi.js';
import { bakeCardAtlas, type CardAtlas } from '../../common/cards/atlas';
import { CardView } from '../../common/cards/CardView';
import { bakeChipAtlas, type ChipAtlas } from '../../common/chips/atlas';
import { BetSpotView } from '../../common/chips/BetSpotView';
import { RoadGrid } from '../../common/roadmap/RoadGrid';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import type { BaccaratS2C } from '../../net/games/baccarat';
import { arcadeState, useArcadeStore } from '../../store';
import { onLangChange, t } from '../../../i18n';
import { buildBigRoad } from './roadmap';
import { beadMarks, bigRoadMarks, derivedMarks, ROAD_ROWS } from './roadView';
import { baccaratState, useBaccaratStore } from './store';
import { BET_SPOTS, PAYOUTS, type BetSpot, type Card, type Round } from './rules';

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

/** 路圖區佔畫面高度的比例。上限是為了在很高的視窗裡不讓路圖胖到喧賓奪主。 */
const ROAD_RATIO = 0.3;
const ROAD_MAX = 210;

/** 結算後停留多久才回到下注階段。夠看清楚牌與賠付，又不會讓人等到不耐煩。 */
const RESULT_HOLD = 2.6;

/** 發牌的間隔。太快看不出是一張一張發的，太慢會拖 */
const DEAL_GAP = 0.16;

const SPOT_COLOR: Record<BetSpot, number> = {
    player: 0x4cc9f0,
    banker: 0xff4d6d,
    tie: 0x4fd18b,
    playerPair: 0x4cc9f0,
    bankerPair: 0xff4d6d,
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
        bead: new RoadGrid({ rows: ROAD_ROWS }),
        big: new RoadGrid({ rows: ROAD_ROWS }),
        bigEye: new RoadGrid({ rows: ROAD_ROWS }),
        small: new RoadGrid({ rows: ROAD_ROWS }),
        cockroach: new RoadGrid({ rows: ROAD_ROWS }),
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

        this.roads.bead.setMarks(beadMarks(history, this.roadCols.bead, labels));
        this.roads.big.setMarks(bigRoadMarks(road, this.roadCols.big));
        this.roads.bigEye.setMarks(derivedMarks(road, 'bigEye', this.roadCols.derived));
        this.roads.small.setMarks(derivedMarks(road, 'small', this.roadCols.derived));
        this.roads.cockroach.setMarks(derivedMarks(road, 'cockroach', this.roadCols.derived));
    }

    /** 每張路目前畫得下幾欄。排版時算好，推路圖時用來裁切 */
    private roadCols = { bead: 12, big: 24, derived: 12 };

    // ---- 排版 ----

    private layout(w: number, h: number): void {
        const narrow = w < 760;

        // ---- 路圖區 ----
        const roadH = Math.min(h * ROAD_RATIO, ROAD_MAX);
        const roadW = Math.min(w - 24, 900);
        const roadX = (w - roadW) / 2;
        const roadY = 12;

        // 上排（珠盤路 + 大路）拿六成高度，下排三張衍生路分剩下的
        const topH = roadH * 0.58;
        const botH = roadH - topH - 6;
        const topCell = topH / ROAD_ROWS;
        const botCell = botH / ROAD_ROWS;

        const beadW = Math.min(roadW * 0.3, topCell * 12);
        const beadCols = Math.max(4, Math.floor(beadW / topCell));
        const bigCols = Math.max(6, Math.floor((roadW - beadCols * topCell - 8) / topCell));
        const derivedCols = Math.max(4, Math.floor((roadW / 3 - 6) / botCell));

        this.roadCols = { bead: beadCols, big: bigCols, derived: derivedCols };

        this.roads.bead.setLayout(topCell, beadCols);
        this.roads.bead.position.set(roadX, roadY);
        this.roads.big.setLayout(topCell, bigCols);
        this.roads.big.position.set(roadX + beadCols * topCell + 8, roadY);

        const derivedW = derivedCols * botCell;
        const derivedY = roadY + topH + 6;
        this.roads.bigEye.setLayout(botCell, derivedCols);
        this.roads.bigEye.position.set(roadX, derivedY);
        this.roads.small.setLayout(botCell, derivedCols);
        this.roads.small.position.set(roadX + derivedW + 6, derivedY);
        this.roads.cockroach.setLayout(botCell, derivedCols);
        this.roads.cockroach.position.set(roadX + (derivedW + 6) * 2, derivedY);

        this.updateRoads();

        // ---- 下注區 ----
        const betW = Math.min(w * 0.94, 720);
        const betX = (w - betW) / 2;
        const gap = 8;
        const smallH = narrow ? 46 : 54;
        const bigH = narrow ? 60 : 72;
        // 讓開畫面下緣的操作面板。這個數字是**量出來的**（見 style.css 的 .dock：
        // 讀數列 + 籌碼列 + 動作列 + 說明，加上安全區的邊距），窄畫面時面板會堆疊得更高。
        // 沒讓夠的話莊閒兩個大注區會被面板蓋住一半，而它們正是最常被點的兩區
        const betBottom = h - (narrow ? 268 : 202);
        const bigY = betBottom - bigH;
        const smallY = bigY - smallH - gap;

        const third = (betW - gap * 2) / 3;
        this.place('playerPair', betX, smallY, third, smallH);
        this.place('tie', betX + third + gap, smallY, third, smallH);
        this.place('bankerPair', betX + (third + gap) * 2, smallY, third, smallH);

        const half = (betW - gap) / 2;
        this.place('player', betX, bigY, half, bigH);
        this.place('banker', betX + half + gap, bigY, half, bigH);

        // ---- 牌區 ----
        // 夾在路圖與下注區之間，牌的大小跟著剩下的空間走
        const cardTop = roadY + roadH + 14;
        const cardSpace = smallY - cardTop - 14;
        this.cardW = Math.max(44, Math.min(76, cardSpace / 2.1, w * 0.11));

        const centreY = cardTop + cardSpace / 2;
        this.sideAt = {
            player: { x: w / 2 - this.cardW * 1.85, y: centreY },
            banker: { x: w / 2 + this.cardW * 1.85, y: centreY },
        };

        // 牌靴在右上角，牌從那裡發出來
        this.shoeAt = { x: w - 40, y: cardTop + 10 };

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

    /** 某一邊第 index 張牌該在哪。第三張稍微錯開並壓在前兩張上，是真實桌台的擺法 */
    private cardSlot(side: 'player' | 'banker', index: number): { x: number; y: number } {
        const base = this.sideAt[side];
        if (index < 2) {
            const offset = (index - 0.5) * this.cardW * 0.62;
            return { x: base.x + offset, y: base.y };
        }
        return { x: base.x, y: base.y + this.cardW * 0.34 };
    }

    private settleCard(card: CardView | undefined, side: 'player' | 'banker', index: number): void {
        if (!card) return;
        const slot = this.cardSlot(side, index);
        // resize 期間不做動畫：視窗正在被拖動時，每一幀都補一個 tween 會打架
        gsap.killTweensOf(card);
        card.position.set(slot.x, slot.y);
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
