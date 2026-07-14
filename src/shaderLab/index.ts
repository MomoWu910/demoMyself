import { Application, Assets, Sprite } from 'pixi.js';
import { createDissolveFilter } from './effects/dissolve';
import shibaPng from '../pixiJSDemo/stressTest/res/shiba.png';

(async () => {
    const params = new URLSearchParams(window.location.search);
    const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({ background: '#0f0f11', resizeTo: window, preference, antialias: false });
    document.body.appendChild(app.canvas);
    (globalThis as any).__PIXI_APP__ = app;

    const texture = await Assets.load(shibaPng);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(app.screen.width / 2, app.screen.height / 2);
    sprite.scale.set(3);
    app.stage.addChild(sprite);

    const filter = createDissolveFilter();
    sprite.filters = [filter];

    // 讓 progress 來回擺盪，一眼看得出溶解有沒有真的在動
    const uniforms = (filter.resources.dissolve as any).uniforms;
    let elapsed = 0;
    app.ticker.add(({ deltaMS }) => {
        elapsed += deltaMS / 1000;
        uniforms.uProgress = (Math.sin(elapsed * 0.6) * 0.5 + 0.5) * 0.85;
    });

    // 給驗證腳本讀：確認實際跑起來的是哪個 backend（preference 只是偏好，不支援會退回）
    (globalThis as any).__BACKEND__ = (app.renderer as any).gl ? 'webgl' : 'webgpu';
})();
