import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { GameModule, ModuleContext } from '../../core/module';
import { FakeSocket } from '../../net/fakeSocket';
import type { SlotS2C, WinLine } from '../../net/games/slot';
import { arcadeState, useArcadeStore } from '../../store';
import { Reel } from './reel';
import { PAYLINES, REELS, ROWS, type Sym } from './rules';
import { slotState, useSlotStore } from './store';
import { stopRanks } from './stopOrder';
import { bakeSymbolAtlas } from './symbols';

/**
 * 老虎機玩法。
 *
 * 這支檔案只做三件事：**接封包、指揮轉軸、演中獎**。它沒有任何一行在決定輸贏——
 * 盤面與賠付都是 server 算好從 socket 送過來的（見 net/protocol.ts 的說明）。
 *
 * 所有會留下痕跡的東西都走 ctx 登記（每幀邏輯、resize、texture、socket、tween），
 * 卸載時由 ModuleHost 統一收回，這樣切回大廳再進來第二次不會比第一次慢（見 core/module.ts）。
 */

/** 一格的長寬比。轉軸的格子略高於寬，符號才不會擠成一團。 */
const CELL_RATIO = 1.06;

/** 轉軸之間的間距，相對格寬。 */
const GAP_RATIO = 0.09;

/**
 * 前後兩根轉軸的停止時間差（秒）。逐根停才有節奏，一起停會像畫面卡住。
 *
 * 一根軸從減速到停穩約要一秒（見 reel.ts），所以這個值不必接近那個長度——前一根還在
 * 回彈時下一根就開始減速，看起來是連續的一串，而不是五段各自為政的動作。
 *
 * 乘的是**停軸名次**而不是轉軸索引（見 stopOrder.ts），順序才換得動。
 */
const STOP_STAGGER = 0.22;

/** 贏超過押注幾倍算大獎，中獎演出會加碼。 */
const BIG_WIN_MULT = 10;

export class SlotModule implements GameModule {
    public readonly id = 'slot';

    private reels: Reel[] = [];
    private board = new Container();
    private lineLayer = new Graphics();
    private winText: Text | null = null;
    private socket: FakeSocket<'slot'> | null = null;
    private ctx: ModuleContext | null = null;

    /** 目前的格子尺寸。中獎線照它算座標——不能用 Container 的 bounds，那會被遮罩影響。 */
    private cellW = 100;
    private cellH = 106;

    /** 中獎演出的 tween，換下一把前要全部收掉 */
    private fx: gsap.core.Tween[] = [];

    public async mount(ctx: ModuleContext): Promise<void> {
        this.ctx = ctx;

        // ---- 符號 atlas：進玩法時烘一次，之後只取 frame ----
        const atlas = bakeSymbolAtlas(ctx.app);
        // 底層那張圖要登記，卸載才會把 GPU 記憶體還回去；切出來的 frame 共用同一個 source，
        // 各自 destroy 反而會重複釋放，所以只 track source 這一個
        ctx.track(atlas.source);

        ctx.root.addChild(this.board);
        this.board.addChild(this.lineLayer);

        for (let i = 0; i < REELS; i++) {
            const reel = new Reel({ frames: atlas.frames, cellW: 100, cellH: 106 });
            this.reels.push(reel);
            this.board.addChildAt(reel, 0); // 轉軸排在中獎線圖層底下
        }

        this.winText = new Text({
            text: '',
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: 46,
                fontWeight: '900',
                fill: 0xffd93d,
                dropShadow: { color: 0x000000, alpha: 0.6, blur: 6, distance: 0, angle: 0 },
            }),
        });
        this.winText.anchor.set(0.5);
        this.winText.alpha = 0;
        this.board.addChild(this.winText);

        // ---- 連線 ----
        // 一條連線對一張桌：這裡開，卸載時關（見 net/fakeSocket.ts）
        const socket = new FakeSocket('slot', {
            onMessage: (p) => this.onPacket(p),
            onStateChange: (s) => useArcadeStore.getState().setConnection(s),
        });
        this.socket = socket;
        ctx.onDispose(() => socket.close());

        // ---- 接上 React 的 SPIN 按鈕 ----
        useSlotStore.getState().setSpinHandler(() => this.requestSpin());
        // 離桌時把這張桌的狀態整份清掉（押注、轉動中、上一把的贏分），
        // 下次進來才不會看到上一輪的殘影
        ctx.onDispose(() => useSlotStore.getState().reset());

        // ---- 每幀推進轉軸 ----
        ctx.frame((ticker) => {
            const dt = ticker.deltaMS / 1000;
            for (const r of this.reels) r.update(dt);
        });

        ctx.onResize((w, h) => this.layout(w, h));
        this.layout(ctx.screen.width, ctx.screen.height);

        // 中獎演出的 tween 不歸 ctx 管（它們是短命的），但卸載時要確保沒有殘留
        ctx.onDispose(() => this.clearFx());
    }

    /** 送出 spin。按鈕已經在 React 那側上鎖，這裡再擋一次是為了鍵盤等其他觸發路徑。 */
    private requestSpin(): void {
        const shell = arcadeState();
        const slot = slotState();
        if (slot.spinning || shell.connection !== 'open') return;
        // 本地先擋一次餘額不足，省掉一趟 RTT。**這不是在替代 server 的檢查**——
        // server 那邊仍會擋（見 slotServer.spin），這裡只是讓回饋即時。
        if (slot.bet > shell.balance) {
            shell.setError('insufficient_balance');
            return;
        }

        this.clearFx();
        this.lineLayer.clear();
        if (this.winText) this.winText.alpha = 0;

        slot.setSpinning(true);
        slot.setResult(0, []);
        shell.setError(null);

        // 先起轉再送封包：真的機台就是這個順序，玩家按下去的當下轉軸就該動，
        // 不是等網路回來才動——那會有一段莫名其妙的延遲。
        // 起轉演法每把重讀，所以面板上切換完下一把就生效，不必重載玩法。
        for (const r of this.reels) r.spin(slot.spinStyle);
        this.socket?.send({ type: 'spin', bet: slot.bet });
    }

    private onPacket(p: SlotS2C): void {
        switch (p.type) {
            case 'welcome':
            case 'balance':
                arcadeState().setBalance(p.balance);
                break;

            case 'spinResult':
                void this.playResult(p.grid, p.wins, p.totalWin, p.balance);
                break;

            case 'error':
                arcadeState().setError(p.reason);
                slotState().setSpinning(false);
                break;
        }
    }

    /**
     * 把伺服器給的結果演出來：逐根停軸 → 全部停穩 → 畫中獎線。
     *
     * 餘額等到**轉軸停穩**才更新，不是收到封包就更新——先跳數字再停軸，
     * 玩家會先從數字知道結果，轉軸就白轉了。
     */
    private async playResult(grid: number[][], wins: WinLine[], totalWin: number, balance: number): Promise<void> {
        // 順序演法每把重讀，跟起轉演法一樣，面板上切換完下一把就生效
        const ranks = stopRanks(slotState().stopOrder, this.reels.length);
        await Promise.all(this.reels.map((reel, i) => reel.stopAt(grid[i] as Sym[], ranks[i] * STOP_STAGGER)));

        const slot = slotState();
        arcadeState().setBalance(balance);
        slot.setResult(totalWin, wins);
        slot.setSpinning(false);

        if (wins.length > 0) this.showWins(wins, totalWin, slot.bet);
    }

    /** 畫中獎線、讓中獎的格子脈動、跳出贏分數字。 */
    private showWins(wins: WinLine[], totalWin: number, bet: number): void {
        this.lineLayer.clear();

        const cellW = this.cellW;
        const cellH = this.cellH;
        const pitch = cellW + cellW * GAP_RATIO;

        for (const win of wins) {
            const path = PAYLINES[win.line];
            const color = LINE_COLORS[win.line % LINE_COLORS.length];

            // 線只畫到「中了幾格」為止——畫滿五格會讓人以為整條線都中了
            for (let r = 0; r < win.count; r++) {
                const x = r * pitch + cellW / 2;
                const y = path[r] * cellH + cellH / 2;
                if (r === 0) this.lineLayer.moveTo(x, y);
                else this.lineLayer.lineTo(x, y);
            }
            this.lineLayer.stroke({ color, width: 4, alpha: 0.9 });

            // 中獎的格子脈動一下。轉軸自己管縮放基準（見 Reel.highlightCell）
            for (let r = 0; r < win.count; r++) this.reels[r]?.highlightCell(path[r]);
        }

        if (this.winText) {
            const big = totalWin >= bet * BIG_WIN_MULT;
            this.winText.text = big ? `BIG WIN  +${totalWin}` : `+${totalWin}`;
            this.winText.style.fontSize = big ? 62 : 46;
            this.winText.alpha = 0;
            this.winText.scale.set(big ? 0.6 : 0.85);
            this.fx.push(
                gsap.to(this.winText, { alpha: 1, duration: 0.22 }),
                gsap.to(this.winText.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' })
            );
        }
    }

    /** 收掉所有中獎演出的 tween，並把被它們改過的縮放還原。 */
    private clearFx(): void {
        for (const t of this.fx) t.kill();
        this.fx = [];
        for (const reel of this.reels) reel.clearHighlights();
    }

    /** 盤面置中，格子大小跟著畫布縮放。 */
    private layout(w: number, h: number): void {
        // 盤面寬 = 5 格 + 4 個間距；高 = 3 格。取兩軸各自能容納的較小值，並留邊。
        const byW = (w * 0.86) / (REELS + (REELS - 1) * GAP_RATIO);
        const byH = (h * 0.62) / (ROWS * CELL_RATIO);
        const cellW = Math.max(48, Math.min(byW, byH));
        const cellH = cellW * CELL_RATIO;
        const gap = cellW * GAP_RATIO;
        const pitch = cellW + gap;

        this.cellW = cellW;
        this.cellH = cellH;

        for (let i = 0; i < this.reels.length; i++) {
            const reel = this.reels[i];
            reel.resize(cellW, cellH);
            reel.x = i * pitch;
            reel.y = 0;
        }

        const boardW = REELS * cellW + (REELS - 1) * gap;
        const boardH = ROWS * cellH;
        this.board.position.set((w - boardW) / 2, (h - boardH) / 2 - h * 0.04);

        if (this.winText) this.winText.position.set(boardW / 2, boardH + cellH * 0.42);
    }
}

/** 每條賠付線一個顏色，同時中好幾條時才分得出是哪幾條。 */
const LINE_COLORS = [0xffd93d, 0x4cc9f0, 0xff4d6d, 0x4fd18b, 0xb57bff];
