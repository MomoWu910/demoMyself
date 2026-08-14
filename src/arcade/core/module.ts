import { Container, type Application, type Ticker } from 'pixi.js';
import type { GameId } from '../net/protocol';

/**
 * 玩法模組的契約——這一頁在架構上真正要證明的東西。
 *
 * 站內跨頁切換是整頁導覽（`location.href`），瀏覽器會把整個 document 連同 JS heap、
 * WebGL context 一起丟掉，隔離是免費的。但**遊樂場內部**在玩法之間切換沒有這道保險：
 * 大廳與各個玩法活在同一個 Application、同一個 ticker、同一份 GPU 記憶體裡。舊玩法的
 * texture、每幀 callback、resize 監聽、setTimeout 只要漏掉一個，玩個三輪就開始掉幀，
 * 而且症狀會出現在**下一個**玩法身上，非常難查。
 *
 * 所以資源不是靠「記得在 unmount 裡清掉」來管的——那遲早會漏。改成模組拿不到裸的 app：
 * 想加每幀邏輯得走 `ctx.frame()`，想長期持有物件得走 `ctx.track()`，全部登記在案，
 * 卸載時由 host 統一收回。**寫得出來的路徑就只有會被清乾淨的那一條。**
 *
 * 剩下的漏洞是模組自己 new 出來卻沒 track 的東西，所以 host 在卸載後會核對一次
 * （見 ModuleHost.switchTo 的 verify），對不上就在 console 出聲。
 */

/** 能被回收的東西。Pixi 的 Container / Texture / Filter 都符合這個形狀。 */
export interface Disposable {
    destroy(options?: unknown): void;
    readonly destroyed?: boolean;
}

export interface ModuleContext {
    /** 這個模組的根容器。卸載時整棵連同子節點一起 destroy。 */
    readonly root: Container;
    /** 借出 renderer 用來烘貼圖（generateTexture）等一次性工作，不要拿去存起來。 */
    readonly app: Application;
    /** 目前畫布尺寸。resize 後才會變，別在建構時抄成常數。 */
    readonly screen: { width: number; height: number };

    /** 註冊每幀邏輯。卸載時自動移除。 */
    frame(fn: (ticker: Ticker) => void): void;
    /** 註冊 resize 回呼。卸載時自動移除；註冊當下不會立刻呼叫。 */
    onResize(fn: (w: number, h: number) => void): void;
    /** 登記一個需要主動釋放的資源（texture、filter、自己 new 的 container…）。回傳原物件方便串接。 */
    track<T extends Disposable>(obj: T): T;
    /** 登記一個任意的收尾動作（清 timer、關 socket、kill tween）。 */
    onDispose(fn: () => void): void;
}

export interface GameModule {
    /** 用 GameId 而不是 string：這個 id 會被 HUD 拿去決定掛哪一組面板，打錯字就靜默失效 */
    readonly id: GameId;
    /** 建場。ctx 只在這個模組活著的期間有效，不要存到模組外面。 */
    mount(ctx: ModuleContext): void | Promise<void>;
}

/** 卸載後的核對結果，給 HUD 顯示用。 */
export interface DisposeReport {
    /** 這個模組總共登記了幾個資源 */
    tracked: number;
    /** 卸載後仍未被回收的數量。正常是 0。 */
    leaked: number;
    /** 卸載後 renderer 還握著幾個 texture source（含引擎自己的，看的是「有沒有回到基線」而不是絕對值） */
    textureSources: number;
}

/**
 * 模組的宿主：負責掛載、卸載，以及卸載後核對資源有沒有真的還回來。
 */
export class ModuleHost {
    private app: Application;
    private current: GameModule | null = null;
    private ctx: InternalContext | null = null;
    private lastReport: DisposeReport | null = null;

    constructor(app: Application) {
        this.app = app;
    }

    public getCurrent(): GameModule | null {
        return this.current;
    }

    public getLastReport(): DisposeReport | null {
        return this.lastReport;
    }

    /**
     * 換到另一個模組。**一定先卸乾淨再建新的**，順序不能反：
     * 兩個模組同時活著的那一瞬間，GPU 記憶體會是兩者的總和，在低階手機上足以直接掉幀或當掉。
     */
    public async switchTo(next: GameModule): Promise<void> {
        if (this.current) this.disposeCurrent();

        const ctx = new InternalContext(this.app);
        this.app.stage.addChild(ctx.root);
        this.ctx = ctx;
        this.current = next;
        await next.mount(ctx);
    }

    /** 卸掉目前模組，回到空舞台。 */
    public disposeCurrent(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        this.lastReport = ctx.dispose();
        this.ctx = null;
        this.current = null;
    }

    /** 畫面尺寸變了：轉給目前模組。 */
    public resize(w: number, h: number): void {
        this.ctx?.emitResize(w, h);
    }
}

/** ModuleContext 的實作。只有 host 造得出來，模組拿到的是唯讀的那一面。 */
class InternalContext implements ModuleContext {
    public readonly root = new Container();
    public readonly app: Application;
    public readonly screen: { width: number; height: number };

    private frames: Array<(t: Ticker) => void> = [];
    private resizes: Array<(w: number, h: number) => void> = [];
    private tracked: Disposable[] = [];
    private disposers: Array<() => void> = [];
    private disposed = false;

    constructor(app: Application) {
        this.app = app;
        this.screen = { width: app.screen.width, height: app.screen.height };
    }

    public frame(fn: (t: Ticker) => void): void {
        if (this.disposed) return;
        this.frames.push(fn);
        this.app.ticker.add(fn);
    }

    public onResize(fn: (w: number, h: number) => void): void {
        if (this.disposed) return;
        this.resizes.push(fn);
    }

    public track<T extends Disposable>(obj: T): T {
        if (!this.disposed) this.tracked.push(obj);
        return obj;
    }

    public onDispose(fn: () => void): void {
        if (this.disposed) fn();
        else this.disposers.push(fn);
    }

    public emitResize(w: number, h: number): void {
        this.screen.width = w;
        this.screen.height = h;
        for (const fn of this.resizes) fn(w, h);
    }

    /**
     * 回收順序是有講究的，**由外而內**：
     *   1. 先停掉每幀邏輯——不然接下來 destroy 到一半，ticker 還在對半死的物件動手
     *   2. 再跑模組自己的收尾（關 socket、清 timer、kill tween）
     *   3. 然後拆場景樹
     *   4. 最後才 destroy 登記的資源（此時已經沒有人在用它們了）
     */
    public dispose(): DisposeReport {
        if (this.disposed) return { tracked: 0, leaked: 0, textureSources: countTextureSources(this.app) };
        this.disposed = true;

        for (const fn of this.frames) this.app.ticker.remove(fn);
        this.frames = [];
        this.resizes = [];

        for (const fn of this.disposers) {
            try {
                fn();
            } catch (err) {
                console.error('[arcade] 收尾動作失敗', err);
            }
        }
        this.disposers = [];

        this.root.removeFromParent();
        // children: true 才會連同子節點一起拆；texture 不在這裡處理，交給下面的 tracked
        this.root.destroy({ children: true });

        let leaked = 0;
        for (const obj of this.tracked) {
            if (obj.destroyed) continue; // 已經隨場景樹一起走了
            try {
                obj.destroy();
            } catch (err) {
                console.error('[arcade] 資源回收失敗', err);
                leaked++;
            }
        }
        const total = this.tracked.length;
        this.tracked = [];

        return { tracked: total, leaked, textureSources: countTextureSources(this.app) };
    }
}

/**
 * renderer 目前握著幾個 texture source。
 *
 * 這個數字的**絕對值沒有意義**（引擎自己就佔著幾個），要看的是「進出玩法幾次之後，
 * 它有沒有回到剛進站時的基線」——那才是有沒有漏的證據。HUD 上顯示的就是這個對照。
 */
function countTextureSources(app: Application): number {
    const managed = (app.renderer as unknown as { texture?: { managedTextures?: unknown[] } }).texture;
    return managed?.managedTextures?.length ?? 0;
}
