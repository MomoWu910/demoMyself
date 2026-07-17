import { Application, Assets } from 'pixi.js';
import { BenchRunner, BenchPanel } from '../../bench';
import { useLabStore } from '../store';
import { buildShaderCases, DEFAULT_TUNING } from './shaderCases';
import shibaPng from '../../pixiJSDemo/stressTest/res/shiba.png';

/**
 * 面板「量測成本」按鈕的進入點。
 *
 * 量測在一個**專用的離屏 Application** 上跑，不碰 live 預覽那顆——兩顆 ticker 同時跑的話，
 * 量到的是預覽 + 量測的混合負載。所以開跑前先把 live 那顆停掉（stage.ts 已把它掛在
 * globalThis.__PIXI_APP__），跑完再開回來。
 *
 * 尺寸固定 1280×720 @1x，好讓數字在不同時間、不同視窗大小下都可比較。
 * backend 跟 live 目前實際跑的那個一致（webgl / webgpu）。
 *
 * URL 可覆寫：?overdraw= / ?layers= / ?warmup= / ?sample=。
 */
let running = false;

export async function runShaderBenchmark(onState?: (running: boolean) => void): Promise<void> {
    if (running) return;
    running = true;
    onState?.(true);

    const live = (globalThis as { __PIXI_APP__?: Application }).__PIXI_APP__;
    live?.stop();

    const params = new URLSearchParams(window.location.search);
    const num = (key: string, fallback: number): number => {
        const v = Number(params.get(key));
        return v > 0 ? v : fallback;
    };

    const backend = useLabStore.getState().backend;
    const preference = backend === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({
        width: 1280,
        height: 720,
        backgroundColor: 0x0a0e1a,
        preference,
        antialias: false,
    });
    // 刻意不把 canvas 掛進 DOM：離屏渲染即可，量的是 GPU/CPU 成本不是給人看的

    const runner = new BenchRunner(app, {
        ...(num('warmup', 0) ? { warmupFrames: num('warmup', 0) } : {}),
        ...(num('sample', 0) ? { sampleFrames: num('sample', 0) } : {}),
    });
    const panel = new BenchPanel();

    try {
        const texture = await Assets.load(shibaPng);
        const cases = buildShaderCases(app, texture, {
            overdraw: num('overdraw', DEFAULT_TUNING.overdraw),
            overdrawSize: DEFAULT_TUNING.overdrawSize,
            layers: num('layers', DEFAULT_TUNING.layers),
        });
        const report = await runner.run(cases, (done, total, c) => panel.progress(done, total, c.label));
        panel.results(report);
    } finally {
        runner.destroy();
        app.destroy(true); // 釋放這顆量測 app 的 GPU 資源
        live?.start();
        running = false;
        onState?.(false);
    }
}
