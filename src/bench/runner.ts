import { UPDATE_PRIORITY } from 'pixi.js';
import { DrawCallCounter } from './drawCallCounter';
import { collectEnv, median, round, summarize } from './env';
import type { BenchCase, BenchConfig, BenchEnv, BenchReport, BenchResult } from './types';

const DEFAULTS: BenchConfig = {
    warmupFrames: 45,
    sampleFrames: 180,
};

/**
 * 逐案例跑「暖機 → 取樣 → 統計」。
 *
 * 量測窗口的擺法是這裡的重點。Pixi 的 Application 把 render 掛在 ticker 的
 * UPDATE_PRIORITY.LOW (-25)，所以：
 *
 *   HIGH (25)     ── 記 t0，並在此執行案例的 update（讓它落在窗口內）
 *   LOW  (-25)    ── Pixi 在這裡 render（提交 GL / WebGPU 指令）
 *   UTILITY (-50) ── 記 t1
 *
 * t1 - t0 = 這一幀 CPU 端做的全部工作。GPU 實際光柵化的時間量不到
 * （需要 EXT_disjoint_timer_query，且多數瀏覽器已停用），報表不會假裝有。
 */
export class BenchRunner {
    private cfg: BenchConfig;
    private counter: DrawCallCounter;

    private collecting = false;
    private t0 = 0;
    private lastRafAt = 0;

    private cpuSamples: number[] = [];
    private drawSamples: number[] = [];
    private rafDeltas: number[] = [];

    private activeUpdate: BenchCase['update'] = undefined;
    private startedAt = 0;
    private frameWaiters: Array<{ remaining: number; resolve: () => void }> = [];

    constructor(private app: any, cfg: Partial<BenchConfig> = {}) {
        this.cfg = { ...DEFAULTS, ...cfg };
        this.counter = new DrawCallCounter(app);

        app.ticker.add(this.onFrameStart, this, UPDATE_PRIORITY.HIGH);
        app.ticker.add(this.onFrameEnd, this, UPDATE_PRIORITY.UTILITY);
    }

    private onFrameStart(): void {
        this.t0 = performance.now();
        this.counter.reset();
        this.activeUpdate?.(this.t0 - this.startedAt);
    }

    private onFrameEnd(): void {
        const now = performance.now();

        if (this.collecting) {
            this.cpuSamples.push(now - this.t0);
            if (this.counter.supported) this.drawSamples.push(this.counter.value);
            if (this.lastRafAt) this.rafDeltas.push(now - this.lastRafAt);
        }
        this.lastRafAt = now;

        // 推進等待中的 waitFrames()
        for (const w of this.frameWaiters) w.remaining--;
        const done = this.frameWaiters.filter((w) => w.remaining <= 0);
        this.frameWaiters = this.frameWaiters.filter((w) => w.remaining > 0);
        for (const w of done) w.resolve();
    }

    private waitFrames(n: number): Promise<void> {
        return new Promise((resolve) => this.frameWaiters.push({ remaining: n, resolve }));
    }

    /**
     * 量測環境。
     *
     * refreshHz 是靠 rAF 間隔推算的，所以必須在「沒有負載」的狀態下量——
     * 否則場景一重，量到的是掉幀後的幀率，而不是螢幕更新率上限。
     * 先把 stage 藏起來讓 Pixi 空跑幾幀，量完再還原。
     */
    private async measureEnvIdle(): Promise<BenchEnv> {
        const stage = this.app.stage;
        const wasVisible = stage.visible;
        stage.visible = false;
        try {
            return await collectEnv(this.app);
        } finally {
            stage.visible = wasVisible;
        }
    }

    /** 依序跑完所有案例。onProgress 讓 UI 顯示進度。 */
    async run(
        cases: BenchCase[],
        onProgress?: (done: number, total: number, current: BenchCase) => void,
    ): Promise<BenchReport> {
        const env = await this.measureEnvIdle();
        const results: BenchResult[] = [];
        let previous: BenchCase | null = null;

        for (let i = 0; i < cases.length; i++) {
            const c = cases[i];
            onProgress?.(i, cases.length, c);

            previous?.teardown?.();
            const objectCount = await c.setup();

            this.activeUpdate = c.update;
            this.startedAt = performance.now();

            await this.waitFrames(this.cfg.warmupFrames);

            this.cpuSamples = [];
            this.drawSamples = [];
            this.rafDeltas = [];
            this.collecting = true;
            await this.waitFrames(this.cfg.sampleFrames);
            this.collecting = false;

            results.push({
                id: c.id,
                label: c.label,
                objectCount,
                cpuMs: summarize(this.cpuSamples),
                fps: this.rafDeltas.length ? round(1000 / median(this.rafDeltas), 1) : 0,
                drawCalls: this.drawSamples.length ? median(this.drawSamples) : null,
                samples: this.cpuSamples.length,
                meta: c.meta,
            });

            previous = c;
        }

        previous?.teardown?.();
        this.activeUpdate = undefined;
        onProgress?.(cases.length, cases.length, cases[cases.length - 1]);

        return { env, config: this.cfg, results };
    }

    destroy(): void {
        this.app.ticker.remove(this.onFrameStart, this);
        this.app.ticker.remove(this.onFrameEnd, this);
    }
}
