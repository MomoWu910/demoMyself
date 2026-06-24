import { Application, Assets, Container } from 'pixi.js';
import Stats from 'stats.js';
import { showGameInfosPannel } from '../../tools';
import { Shiba } from './src/Shiba';
import shibaPng from './res/shiba.png';
import { UIManager } from './src/UIManager';

(async () => {
    // 1. 初始化
    const urlParams = new URLSearchParams(window.location.search);
    // 預設 WebGPU，可透過 URL 切換
    const targetRenderer = urlParams.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({ 
        background: '#1099bb', 
        resizeTo: window, 
        preference: targetRenderer as 'webgpu' | 'webgl', 
        antialias: false // 關閉反鋸齒以獲得最高效能
    });
    document.body.appendChild(app.canvas);

    (globalThis as any).__PIXI_APP__ = app;
    // 顯示 FPS 和 Renderer 資訊
    showGameInfosPannel(app, ['fps', 'drawcalls']);

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    // 2. 載入資源
    const texture = await Assets.load(shibaPng);

    const shibas: Shiba[] = [];
    const gravity = 0.5;
    
    // 用一個 Container 裝 Shiba，Pixi v8 會自動對這個 Container 進行 Batch 渲染優化
    const shibaContainer = new Container();
    app.stage.addChild(shibaContainer);

    // 3. 邏輯函式
    const addShibas = (amount: number) => {
        for (let i = 0; i < amount; i++) {
            const shiba = new Shiba(texture);
            shiba.randomizePosition(app.screen.width, app.screen.height);
            
            shibas.push(shiba);
            shibaContainer.addChild(shiba);
        }
        // 更新 UI
        uiManager.updateCount(shibas.length);
    };

    const resetShibas = () => {
        for(const s of shibas) {
            s.destroy(); // 釋放記憶體
        }
        shibas.length = 0;
        shibaContainer.removeChildren();
        // 更新 UI
        uiManager.updateCount(0);
    };

    const onRendererChange = (v: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set('renderer', v);
        window.location.href = url.toString();
    };

    // 4. 初始化 UI Manager
    const uiManager = new UIManager(
        targetRenderer,
        app.renderer.name,
        addShibas,
        resetShibas,
        onRendererChange
    );

    // 5. Ticker (物理運算)
    // 這裡我們刻意用 CPU 算位置，來測試當物件極多時，Rendering Engine 能不能跟上
    app.ticker.add(() => {
        stats.begin();

        const count = shibas.length;
        // 取得螢幕邊界 (支援 Resize)
        const right = app.screen.width;
        const bottom = app.screen.height;

        for (let i = 0; i < count; i++) {
            shibas[i].update(gravity, right, bottom);
        }

        stats.end();
    });

    // 預先加一點
    addShibas(100); // 起手 1 萬隻
})();