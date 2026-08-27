import gsap from 'gsap';
import { Container } from 'pixi.js';
import { getLang, onLangChange, setLang, t, type Lang } from '../../../i18n';
import { bakeChipAtlas, largestChipUnder, nearestChipTo, type ChipAtlas, type ChipValue } from '../../common/chips/atlas';
import { FlyingChips } from '../../common/chips/FlyingChips';
import { PhaseBanner } from '../../common/table/PhaseBanner';
import { ChipRail } from '../../common/ui/ChipRail';
import { MoreMenu, type MenuSection } from '../../common/ui/MoreMenu';
import { MySeat } from '../../common/ui/MySeat';
import { StatStrip } from '../../common/ui/StatStrip';
import { TableButton } from '../../common/ui/TableButton';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import { ONLINE_SEAT, type RouletteBet, type RouletteS2C } from '../../net/games/roulette';
import { arcadeState, useArcadeStore } from '../../store';
import { OnlineBadge } from '../baccarat/seatView';
import { computeRouletteLayout, type RouletteLayout } from './layout';
import { FeltView } from './feltView';
import { HistoryView } from './historyView';
import { PAYOUT, parseBetKey, totalStake, type BetKey } from './rules';
import { pocketAngleOf, planSpin, sampleSpin, WHEEL_OMEGA, type SpinPlan, type SpinSample } from './spin';
import { rouletteState, useRouletteStore } from './store';
import { RouletteWheel } from './wheelView';

/**
 * 輪盤桌。
 *
 * 這一款在遊樂場裡補的是**「結果先定、動畫反推」的困難版本**。老虎機已經證過一次
 * 同樣的原則，但那是一維的捲軸停格；這裡是兩個反向旋轉的座標系相減，而且中間隔著
 * 十秒的球軌跡——server 送來號碼的那一刻，畫面上什麼都還沒發生。
 *
 * 其餘的部分刻意跟兩張百家樂桌長得一樣：同一個假 WebSocket、同一套模組契約、
 * 同一組籌碼與飛幣元件、同一個共用錢包。**第四款玩法要證明的是那套地基真的能重複用**，
 * 所以凡是能沿用的都沿用，只有真正不同的東西才新寫（輪盤、桌布幾何、開獎看板）。
 *
 * ---
 *
 * **桌上沒有其他玩家的頭像**，這是排版逼出來的取捨，理由寫在 layout.ts。桌上的「別人」
 * 由線上人數與從畫面邊緣飛進來的籌碼表達。
 */

/** 疊放順序。籌碼要蓋在桌布上，輪盤要蓋在籌碼上（球會飛出盤外一點） */
const Z = { FELT: 10, CHIP: 20, WHEEL: 30, UI: 40 };

/**
 * 我自己的座位編號。
 *
 * 跟兩張百家樂桌同一個數字與同一個道理（見 games/baccarat/index.ts 的 MY_SEAT）：
 * 不能跟散客的 `ONLINE_SEAT` 撞號，否則結算時我贏的籌碼會飛去線上人數的膠囊。
 */
const MY_SEAT = -2;

/**
 * 一個下注 tick 最多飛幾顆籌碼，以及**同一個位置一次最多疊幾顆**。
 *
 * 兩個上限都是實測調出來的：輪盤的注比百家樂散得多（154 個位置對五個注區），
 * 十八秒的下注期跑完，桌上會積到號碼完全看不見。**帳目照收，只是畫面不演**——
 * 那幾顆沒飛的籌碼仍然算在注區總額裡。
 */
const CHIP_BUDGET = 12;
const PER_KEY_PER_TICK = 2;

/** 中途進桌時，每個有人押的位置最多先擺幾顆 */
const SNAPSHOT_CHIPS = 3;

export class RouletteModule implements GameModule {
    public readonly id = 'roulette' as const;

    private ctx!: ModuleContext;
    private dead = false;
    private size = { w: 0, h: 0 };

    private socket: FakeSocket<'roulette'> | null = null;
    private chips: ChipAtlas | null = null;
    private chipLayer: FlyingChips | null = null;
    private chipPx = 22;

    private readonly feltLayer = new Container();
    private readonly wheelLayer = new Container();
    private readonly uiLayer = new Container();

    private readonly wheel = new RouletteWheel();
    private readonly felt = new FeltView();
    private readonly history = new HistoryView();
    private readonly banner = new PhaseBanner();
    private readonly mySeat = new MySeat();
    private readonly stats = new StatStrip();
    private readonly online = new OnlineBadge(0);
    private chipRail: ChipRail | null = null;
    private more: MoreMenu | null = null;
    private undoBtn: TableButton | null = null;
    private repeatBtn: TableButton | null = null;

    private L: RouletteLayout | null = null;

    /**
     * 這一趟球的軌跡。`null` = 現在沒在轉，盤子空轉、球停在上一局那一格。
     *
     * 它是**算出來的一條曲線而不是一組會被逐幀更新的變數**，所以掉幀、切分頁、
     * 中途進桌都不會讓球飄掉（見 spin.ts）。
     */
    private plan: SpinPlan | null = null;
    /** 這一趟從什麼時候開始（performance.now）。取樣時用它換算成秒 */
    private spinAt = 0;
    /** 沒在轉的時候，盤子從哪個角度開始空轉 */
    private idleFrom = 0;
    private idleAt = 0;
    /** 球現在停在哪一格。剛進桌還不知道就停在 0 */
    private resting = 0;

    private lastSeconds = -1;
    /** 上一次寫進畫面的階段，用來判斷「剛換階段」而不是每幀重設 */
    private lastPhase: string | null = null;

    public async mount(ctx: ModuleContext): Promise<void> {
        this.ctx = ctx;
        this.dead = false;
        rouletteState.reset();
        this.size = { w: ctx.screen.width, h: ctx.screen.height };

        this.chips = bakeChipAtlas(ctx.app);
        // `true` = 連同底層 TextureSource 一起還。不傳的話核對會漂亮地回報 0，
        // 而 GPU 那塊記憶體每進出一次疊一階（見 core/module.ts 的 DestroyOptions）
        ctx.track(this.chips.source, true);
        this.chipLayer = new FlyingChips(this.chips);

        ctx.root.sortableChildren = true;
        this.feltLayer.zIndex = Z.FELT;
        this.chipLayer.zIndex = Z.CHIP;
        this.wheelLayer.zIndex = Z.WHEEL;
        this.uiLayer.zIndex = Z.UI;
        ctx.root.addChild(this.feltLayer, this.chipLayer, this.wheelLayer, this.uiLayer);

        this.buildScene();

        // 語言換了要重寫桌布與看板上的字。`onLangChange` 沒有退訂（它是整頁層級的），
        // 所以用旗標擋——離桌之後這個 callback 還會被呼叫，那時元件已經被 destroy
        onLangChange(() => {
            if (this.dead) return;
            this.felt.refreshLabels();
            this.history.refreshLabels();
            this.syncPhase();
            this.syncReadouts();
            this.refreshMenu();
            this.undoBtn?.setLabel(t('arcade.rou.undo'));
            this.repeatBtn?.setLabel(t('arcade.bac.repeat'));
        });

        const socket = new FakeSocket('roulette', {
            onMessage: (packet) => this.handle(packet),
            onStateChange: (state) => arcadeState().setConnection(state),
        });
        this.socket = socket;
        ctx.onDispose(() => socket.close());

        rouletteState.set({
            betHandler: (key, amount) => this.sendBet(key, amount),
            undoHandler: () => this.socket?.send({ type: 'undo' }),
            repeatHandler: () => this.repeatBets(),
        });
        ctx.onDispose(() => rouletteState.reset());

        /**
         * 驗證用的狀態入口，跟另外兩張桌同一個用途（見 core/stage.ts 的 `__ARCADE__`）：
         * 介面整組住在畫布裡，端對端腳本沒有 DOM 可以讀。
         */
        (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__ = () => rouletteState.get();
        ctx.onDispose(() => {
            delete (globalThis as unknown as { __TABLE__?: () => unknown }).__TABLE__;
        });

        const unwatchTable = useRouletteStore.subscribe((now, prev) => {
            if (this.dead) return;
            if (
                now.myTotal !== prev.myTotal ||
                now.lastNet !== prev.lastNet ||
                now.played !== prev.played ||
                now.phase !== prev.phase ||
                now.chip !== prev.chip ||
                now.roundNo !== prev.roundNo ||
                now.lastBets !== prev.lastBets
            ) {
                this.syncReadouts();
            }
        });
        ctx.onDispose(unwatchTable);

        const unwatchShell = useArcadeStore.subscribe((now, prev) => {
            if (this.dead) return;
            if (now.balance !== prev.balance) this.mySeat.setBalance(now.balance);
            if (now.chipSet !== prev.chipSet) {
                this.chipRail?.setChips(now.chipSet);
                this.refreshMenu();
                this.alignChip();
            }
        });
        ctx.onDispose(unwatchShell);

        // 籌碼架的慣性也在這裡推——捲動器自己不碰 ticker，那是模組契約的要求
        ctx.frame((ticker) => {
            this.tick();
            this.chipRail?.update(ticker.deltaMS / 1000);
        });
        ctx.onResize((w, h) => {
            this.size = { w, h };
            this.layout(w, h);
        });
        this.layout(this.size.w, this.size.h);

        ctx.onDispose(() => {
            this.dead = true;
            this.chipLayer?.stop();
            this.chipRail?.stop();
            this.banner.stop();
            this.online.stop();
            this.mySeat.stop();
            gsap.killTweensOf(this.wheel);
        });
    }

    // ---- 建場 ---------------------------------------------------------------

    private buildScene(): void {
        this.feltLayer.addChild(this.felt);
        this.wheelLayer.addChild(this.wheel);
        this.uiLayer.addChild(this.history, this.banner, this.mySeat, this.stats, this.online);

        this.felt.onPick = (key) => this.pick(key);

        const shell = arcadeState();
        this.mySeat.setPlayer(shell.player.name, shell.player.tint);
        this.mySeat.setBalance(shell.balance);

        if (this.chips) {
            this.chipRail = new ChipRail({
                atlas: this.chips,
                onPick: (value) => rouletteState.set({ chip: value }),
            });
            this.chipRail.setChips(shell.chipSet);
            this.chipRail.setSelected(rouletteState.get().chip);
            this.uiLayer.addChild(this.chipRail);

            this.more = new MoreMenu({
                atlas: this.chips,
                onChipSetChange: (values) => arcadeState().setChipSet(values),
            });
            this.more.setChipSet(shell.chipSet);
            this.uiLayer.addChild(this.more);
        }

        this.undoBtn = new TableButton({
            label: t('arcade.rou.undo'),
            variant: 'ghost',
            onTap: () => this.socket?.send({ type: 'undo' }),
        });
        this.repeatBtn = new TableButton({
            label: t('arcade.bac.repeat'),
            variant: 'ghost',
            onTap: () => this.repeatBets(),
        });
        this.uiLayer.addChild(this.undoBtn, this.repeatBtn);

        this.refreshMenu();
        this.alignChip();
        this.syncPhase();
        this.syncReadouts();
    }

    // ---- 下注 ---------------------------------------------------------------

    /**
     * 桌布被點了。
     *
     * 命中判定已經在 `FeltView` 裡把座標翻成注別了，這裡只管**能不能押**與**押多少**。
     * 這個分工很重要：幾何是可以被窮舉驗證的純函式，而「現在是不是下注階段」是桌況，
     * 兩者混在一起就沒有一邊測得動。
     */
    private pick(key: BetKey): void {
        const st = rouletteState.get();
        if (st.phase !== 'betting') {
            arcadeState().setNotice('arcade.bac.betClosed');
            return;
        }
        this.sendBet(key, st.chip);
    }

    private sendBet(key: BetKey, amount: number): void {
        const shell = arcadeState();
        if (rouletteState.get().phase !== 'betting') {
            shell.setNotice('arcade.bac.betClosed');
            return;
        }
        if (shell.connection !== 'open') return;
        if (amount > shell.balance) {
            shell.setError('insufficient_balance');
            return;
        }

        this.flyChip(largestChipUnder(amount), key, MY_SEAT, this.mySeat.originPoint(), 0);
        this.socket?.send({ type: 'bet', key, amount });
    }

    /** 重複上一局的注——一注一注重送，server 那邊就只認得單筆下注 */
    private repeatBets(): void {
        const st = rouletteState.get();
        if (st.phase !== 'betting') {
            arcadeState().setNotice('arcade.bac.betClosed');
            return;
        }
        for (const [key, amount] of Object.entries(st.lastBets)) {
            if (amount > 0) this.sendBet(key, amount);
        }
    }

    private flyChip(value: ChipValue, key: BetKey, seat: number, from: { x: number; y: number }, delay: number): void {
        const at = this.felt.anchor(key);
        if (!at || !this.chipLayer) return;

        // 同一個位置上的籌碼稍微散開，不然疊上去只看得到最後那一顆
        const jitter = this.chipPx * 0.22;
        const to = {
            x: at.x + (Math.random() - 0.5) * jitter,
            y: at.y + (Math.random() - 0.5) * jitter,
            u: 0.5,
            v: 0.5,
        };
        this.chipLayer.fly(value, key, seat, from, to, delay);
    }

    // ---- 收封包 -------------------------------------------------------------

    private handle(packet: RouletteS2C): void {
        switch (packet.type) {
            case 'welcome':
                arcadeState().setBalance(packet.balance);
                this.socket?.send({ type: 'sit' });
                break;

            case 'balance':
                arcadeState().setBalance(packet.balance);
                break;

            case 'table': {
                const s = packet.snapshot;
                // 時差校正。我們的 server 就住在同一個分頁裡，這個差值必定是 0——
                // 留著它是因為換成真後端時這裡是唯一要改的地方
                const skew = s.serverNow - Date.now();
                rouletteState.set({
                    phase: s.phase,
                    endsAt: s.endsAt - skew,
                    roundNo: s.round,
                    history: s.history,
                    totals: s.totals,
                    myBets: s.myBets,
                    myTotal: totalStake(s.myBets),
                    seats: s.seats,
                });
                this.resting = s.history[0] ?? 0;
                this.online.setCount(s.seats.length * 37 + 11);
                this.history.setHistory(s.history);
                this.scatterSnapshotChips();
                this.syncPhase();

                // 正好在轉：把球接在它現在該在的位置上，而不是從頭演一次
                if (s.spin) {
                    this.startSpin(s.spin.winning, s.spin.duration, s.spin.elapsed);
                    rouletteState.set({ spin: { winning: s.spin.winning, duration: s.spin.duration } });
                }
                break;
            }

            case 'phase': {
                const skew = packet.serverNow - Date.now();
                rouletteState.set({ phase: packet.phase, endsAt: packet.endsAt - skew, roundNo: packet.round });
                if (packet.phase === 'betting') this.beginRound();
                this.syncPhase();
                break;
            }

            case 'seats':
                rouletteState.set({ seats: packet.seats });
                this.online.setCount(packet.seats.length * 37 + 11);
                break;

            case 'bets':
                rouletteState.set({ totals: packet.totals });
                this.flyCrowd(packet.bets);
                break;

            case 'betOk':
                arcadeState().setBalance(packet.balance);
                rouletteState.set({
                    myBets: packet.myBets,
                    myTotal: totalStake(packet.myBets),
                    totals: packet.totals,
                });
                // undo 之後桌上那顆籌碼也要跟著消失，否則畫面上的注會比帳目多
                this.syncMyChips(packet.myBets);
                break;

            case 'spin':
                rouletteState.set({ spin: packet.outcome });
                this.startSpin(packet.outcome.winning, packet.outcome.duration, 0);
                break;

            case 'settle': {
                const st = rouletteState.get();
                const back = packet.totalReturn;
                const staked = st.myTotal;
                arcadeState().setBalance(packet.balance);
                rouletteState.set({
                    winning: packet.winning,
                    history: packet.history,
                    lastPayouts: packet.payouts,
                    lastNet: back - staked,
                    played: staked > 0,
                    lastBets: st.myBets,
                });
                this.history.setHistory(packet.history);
                this.settle(packet.winning, packet.payouts);
                break;
            }

            case 'error':
                // `nothing_to_undo` 不是錯，是「沒東西可以收」。當成錯誤跳紅字的話，
                // 玩家連按兩下 undo 就會看到一個看起來很嚴重的訊息
                if (packet.reason === 'nothing_to_undo') break;
                arcadeState().setError(packet.reason);
                break;
        }
    }

    /** 新的一局：清桌、把上一局的標示拿掉 */
    private beginRound(): void {
        rouletteState.set({ winning: null, spin: null, myBets: {}, myTotal: 0, totals: {} });
        this.felt.mark(null);
        this.wheel.mark(null);
    }

    /**
     * 開球。
     *
     * `elapsed` 是「這一趟已經跑了多久」——中途進桌時不為零。給了它之後球會直接出現在
     * 半路上，而不是從頭再演一次（那會讓中途進來的人看到一顆停在錯的地方的球）。
     */
    private startSpin(winning: number, duration: number, elapsed: number): void {
        const now = performance.now();
        const current = this.sample(now);

        this.plan = planSpin(winning, duration, current.wheelAngle, current.ballAngle);
        this.spinAt = now - elapsed * 1000;
        this.resting = winning;
    }

    /**
     * 結算：標出中獎號碼，把籌碼收掉。
     *
     * 中獎的位置**同時標在輪盤與桌布上**——那兩個地方對玩家是不同的問題：輪盤上是
     * 「球停在哪」，桌布上是「我押的那幾格中了沒」。只標一邊的話，押角注的人得自己
     * 在腦子裡把號碼換算回桌布位置。
     */
    private settle(winning: number, payouts: Record<string, number>): void {
        this.wheel.mark(winning);
        this.felt.mark(winning);

        const house = this.L ? { x: this.L.wheel.x, y: this.L.wheel.y } : { x: 0, y: 0 };
        this.chipLayer?.recycle(
            (key) => (payouts[key] ?? 0) > 0,
            (seat) => (seat === MY_SEAT ? this.mySeat.originPoint() : this.online.originPoint()),
            house,
            () => undefined
        );

        const net = rouletteState.get().lastNet;
        if (rouletteState.get().played) this.mySeat.flashDelta(net);
    }

    /** 一批別人的注飛進桌布。預算用完就不飛了——**帳目照收，只是畫面不演** */
    private flyCrowd(bets: RouletteBet[]): void {
        if (!this.L) return;
        let budget = CHIP_BUDGET;
        let index = 0;
        let sawCrowd = false;
        const perKey = new Map<string, number>();

        for (const bet of bets) {
            if (budget <= 0) break;
            const used = perKey.get(bet.key) ?? 0;
            if (used >= PER_KEY_PER_TICK) continue;

            const count = Math.min(bet.count, budget, PER_KEY_PER_TICK - used);
            perKey.set(bet.key, used + count);
            budget -= count;
            if (bet.seat === ONLINE_SEAT) sawCrowd = true;

            // 每一筆從不同的邊緣點飛進來，看起來才像四面八方都有人在押
            const origins = this.L.crowdOrigins;
            const from = origins[(bet.seat + 6 + index) % origins.length];
            for (let k = 0; k < count; k++) {
                this.flyChip(bet.chip, bet.key, bet.seat, from, index * 0.04);
                index++;
            }
        }

        if (sawCrowd) this.online.ping();
    }

    /**
     * 讓桌上我的籌碼跟帳目對齊。
     *
     * 只有 `undo` 需要它：下注是「先飛一顆再送封包」，收回卻沒有「反向飛」這種東西
     * ——最誠實的做法是把我的籌碼整批重畫成帳目現在的樣子。別人的籌碼不動。
     */
    private syncMyChips(myBets: Record<string, number>): void {
        if (!this.chipLayer) return;
        const before = totalStake(rouletteState.get().myBets);
        const after = totalStake(myBets);
        if (after >= before) return;

        this.chipLayer.recycle(
            () => false,
            () => this.mySeat.originPoint(),
            this.mySeat.originPoint(),
            () => {
                // 收乾淨之後照帳目重擺一次。**別人的注也會一起被清掉**，所以順便照總額重撒
                this.scatterSnapshotChips();
                for (const [key, amount] of Object.entries(myBets)) {
                    if (amount <= 0) continue;
                    const at = this.felt.anchor(key);
                    if (at) this.chipLayer?.place(largestChipUnder(amount), key, MY_SEAT, { ...at, u: 0.5, v: 0.5 });
                }
            }
        );
    }

    /**
     * 中途進桌（或收回注之後）照總額撒一些籌碼。
     *
     * **這是視覺化，不是重建**：server 的快照只給每個位置的總額，給不出「誰押了幾顆
     * 什麼面額」。玩家看到的是「這幾格很熱」這個正確的資訊，只是每一顆籌碼不對應到
     * 某一筆真實的注。
     */
    private scatterSnapshotChips(): void {
        const st = rouletteState.get();
        for (const [key, total] of Object.entries(st.totals)) {
            if (total <= 0) continue;
            const at = this.felt.anchor(key);
            if (!at) continue;

            const count = Math.min(SNAPSHOT_CHIPS, Math.max(1, Math.round(Math.log10(total))));
            const value = nearestChipTo(total / count);
            for (let i = 0; i < count; i++) {
                const jitter = this.chipPx * 0.22;
                this.chipLayer?.place(value, key, ONLINE_SEAT, {
                    x: at.x + (Math.random() - 0.5) * jitter,
                    y: at.y + (Math.random() - 0.5) * jitter,
                    u: 0.5,
                    v: 0.5,
                });
            }
        }
    }

    // ---- 每幀 ---------------------------------------------------------------

    private tick(): void {
        const now = performance.now();
        this.wheel.apply(this.sample(now));

        const st = rouletteState.get();
        const left = Math.max(0, (st.endsAt - Date.now()) / 1000);
        const secs = Math.ceil(left);
        if (secs !== this.lastSeconds) {
            this.lastSeconds = secs;
            rouletteState.set({ secondsLeft: secs });
            this.banner.setLeft(secs);
        }
    }

    /**
     * 這一幀球與盤在哪裡。
     *
     * 沒有在轉的時候盤子**仍然要慢慢轉**（真輪盤的轉子整晚不停），球則停在上一局那一格
     * 跟著它走。這件事看起來是裝飾，其實是那張桌子「還活著」最便宜的證據——
     * 靜止的輪盤跟當掉的輪盤在畫面上長得一模一樣。
     */
    private sample(now: number): SpinSample {
        if (this.plan) return sampleSpin(this.plan, (now - this.spinAt) / 1000);

        if (this.idleAt === 0) this.idleAt = now;
        const wheelAngle = this.idleFrom + WHEEL_OMEGA * ((now - this.idleAt) / 1000);
        return { wheelAngle, ballAngle: wheelAngle + pocketAngleOf(this.resting), radius01: 0, settled: true };
    }

    // ---- 介面 ---------------------------------------------------------------

    private syncPhase(): void {
        const st = rouletteState.get();
        this.banner.setPhase(t(`arcade.rou.phase.${st.phase}`), st.phase !== 'result');

        if (st.phase !== this.lastPhase) {
            this.lastPhase = st.phase;
            // 封盤之後桌布就不能點了。**留著能點但送出去被拒**是最糟的做法：
            // 玩家會看到籌碼飛出去又消失
            this.felt.eventMode = st.phase === 'betting' ? 'static' : 'none';
            this.felt.cursor = st.phase === 'betting' ? 'pointer' : 'default';
        }
    }

    private syncReadouts(): void {
        const st = rouletteState.get();

        this.stats.setStats([
            { label: t('arcade.rou.round'), value: `#${st.roundNo}` },
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
        this.undoBtn?.setEnabled(betting && st.myTotal > 0);
        this.repeatBtn?.setEnabled(betting && Object.keys(st.lastBets).length > 0);
    }

    private alignChip(): void {
        const set = arcadeState().chipSet;
        if (set.length === 0) return;
        if (!set.includes(rouletteState.get().chip)) rouletteState.set({ chip: set[set.length - 1] });
        this.chipRail?.setSelected(rouletteState.get().chip);
    }

    private refreshMenu(): void {
        this.more?.setSections(this.menuSections());
        this.more?.setChipSet(arcadeState().chipSet);
    }

    private menuSections(): MenuSection[] {
        const st = rouletteState.get();
        const hovered = st.myBets;

        return [
            {
                kind: 'stats',
                title: t('arcade.rou.table'),
                stats: [
                    { label: t('arcade.rou.wheelType'), value: t('arcade.rou.european') },
                    { label: t('arcade.rou.edge'), value: '2.70%' },
                    { label: t('arcade.rou.maxPayout'), value: `${PAYOUT.straight}:1` },
                    { label: t('arcade.bac.totalBet'), value: totalStake(hovered).toLocaleString() },
                ],
            },
            { kind: 'chips', title: t('arcade.bac.chipSet'), hint: t('arcade.bac.chipSetHint') },
            {
                kind: 'segmented',
                title: t('arcade.language'),
                // 順序與標籤跟兩張百家樂桌一致（EN 在前、中文用單字）——同一個遊樂場裡
                // 同一顆開關長得不一樣，玩家會以為那是兩件不同的事
                options: [
                    { key: 'en', label: 'EN' },
                    { key: 'zh', label: '中' },
                ],
                value: getLang(),
                onPick: (key) => setLang(key as Lang),
            },
            { kind: 'note', title: t('arcade.howToPlay'), text: t('arcade.rou.help') },
        ];
    }

    // ---- 排版 ---------------------------------------------------------------

    private layout(w: number, h: number): void {
        if (w === 0 || h === 0) return;
        const L = computeRouletteLayout(w, h);
        this.L = L;

        this.wheel.position.set(L.wheel.x, L.wheel.y);
        this.wheel.setRadius(L.wheel.radius);

        this.history.setRect(L.history);
        this.felt.setRect(L.felt);

        this.banner.position.set(L.banner.x, L.banner.y);
        this.banner.setBoxSize(L.banner.w, L.banner.h);

        this.mySeat.position.set(L.mySeat.x, L.mySeat.y);
        this.mySeat.setBoxSize(L.mySeat.w, L.mySeat.h, L.mySeat.w < 100 * L.scale);

        this.undoBtn?.position.set(L.undo.x, L.undo.y);
        this.undoBtn?.setBoxSize(L.undo.w, L.undo.h);
        this.repeatBtn?.position.set(L.repeat.x, L.repeat.y);
        this.repeatBtn?.setBoxSize(L.repeat.w, L.repeat.h);

        this.online.position.set(L.online.x, L.online.y);
        this.stats.position.set(L.stats.x, L.stats.y);
        this.stats.setScale$(L.scale);
        // 手機橫放沒有一條空帶可以放讀數，硬放會疊在輪盤的外框上（見 layout.ts）
        this.stats.visible = L.showStats;

        // 籌碼大小由籌碼架的高度反推，桌上的籌碼跟著同一個數字——**桌上與架上一樣大**，
        // 玩家才認得出自己剛剛押出去的是哪一顆
        this.chipPx = Math.max(16, Math.min(L.chipRail.h * 0.62, 44 * L.scale));
        this.chipLayer?.setChipSize(this.chipPx * 0.8);
        this.chipRail?.position.set(L.chipRail.x, L.chipRail.y);
        this.chipRail?.setViewport(L.chipRail.w, L.chipRail.h);

        this.more?.place(L.more.x, L.more.y, w, h, L.scale);

        // 版面變了，桌上的籌碼要跟著注區走（見 FlyingChips.relayout 的說明）
        this.chipLayer?.relayout((key) => {
            const at = this.felt.anchor(key);
            return at ? { x: at.x - this.chipPx / 2, y: at.y - this.chipPx / 2, w: this.chipPx, h: this.chipPx } : null;
        });
    }
}
