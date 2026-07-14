import { Application, Assets, Filter, Sprite } from 'pixi.js';
import { getEffect } from './effects';
import { labState, useLabStore, type Backend } from './store';
import shibaPng from '../pixiJSDemo/stressTest/res/shiba.png';

/**
 * canvas 內的世界：Pixi 自己的 render loop，不歸 React 管。
 * React 只負責 canvas 外的面板——這正是這類產品的真實架構，也是這個 demo 想示範的分工。
 * 兩邊唯一的接點是 Zustand store：面板寫值，這裡每幀讀值餵給 uniform。
 */
export async function mountStage(container: HTMLElement): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({
        backgroundAlpha: 0, // 透出底下的棋盤格，溶解掉的區域一眼看得出 alpha 真的被吃掉
        resizeTo: container,
        preference,
        antialias: false,
    });
    container.appendChild(app.canvas);
    (globalThis as any).__PIXI_APP__ = app;

    // preference 只是偏好：不支援 WebGPU 的瀏覽器會靜默退回 WebGL，所以要問實際跑起來的是哪個
    const backend: Backend = (app.renderer as any).gl ? 'webgl' : 'webgpu';
    (globalThis as any).__BACKEND__ = backend;
    useLabStore.getState().setBackend(backend);

    const texture = await Assets.load(shibaPng);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    app.stage.addChild(sprite);

    // 每個效果的 filter 只建一次：切回來時不必重編 shader
    const filters = new Map<string, Filter>();
    const filterFor = (id: string): Filter => {
        let f = filters.get(id);
        if (!f) {
            f = getEffect(id).create();
            filters.set(id, f);
        }
        return f;
    };

    let currentId = '';
    let elapsed = 0;
    let fpsAccum = 0;
    let fpsFrames = 0;

    app.ticker.add(({ deltaMS }) => {
        elapsed += deltaMS / 1000;

        // 讓主體隨容器縮放：面板收合、手機轉向、RWD 模擬器拖拉都靠這裡
        const { width, height } = app.screen;
        sprite.position.set(width / 2, height / 2);
        const fit = Math.min(width, height) * 0.62;
        sprite.scale.set(fit / Math.max(texture.width, texture.height));

        const state = labState();
        const def = getEffect(state.effectId);

        if (state.effectId !== currentId) {
            currentId = state.effectId;
            sprite.filters = [filterFor(currentId)];
        }
        const filter = filterFor(currentId);

        // 自動播放：在 [min, max] 之間來回擺盪，並把值寫回 store，讓面板的 slider 也跟著跑
        if (state.animating && def.animate) {
            const { key, cycleSeconds, min, max } = def.animate;
            const phase = (elapsed % cycleSeconds) / cycleSeconds;
            const wave = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0→1→0，端點速度慢
            state.setParam(key, Number((min + wave * (max - min)).toFixed(3)));
        }

        def.apply(filter, labState().values[currentId]);
        def.tick?.(filter, elapsed);

        // FPS 每 0.5 秒回報一次就好——每幀寫 store 會讓面板每幀重繪
        fpsAccum += deltaMS;
        fpsFrames++;
        if (fpsAccum >= 500) {
            state.setFps(Math.round((fpsFrames * 1000) / fpsAccum));
            fpsAccum = 0;
            fpsFrames = 0;
        }
    });
}
