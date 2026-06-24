import { Application, Assets, Container, ColorMatrixFilter } from 'pixi.js';

import Stats from 'stats.js';
import shibaImg from './res/shiba.png';
import { Shiba } from './src/Shiba';
import { UIManager } from './src/UIManager';
import { showGameInfosPannel } from '../../tools';

(async () => {
    // 1. Setup Stats for performance monitoring
    const stats = new Stats();
    stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(stats.dom);

    // 2. Initialize PixiJS Application
    const app = new Application();
    const urlParams = new URLSearchParams(window.location.search);
    const preference = (urlParams.get('preference') as 'webgl' | 'webgpu') || 'webgl';

    await app.init({
        background: '#0f1452ff',
        resizeTo: window,
        preference: preference, 
        antialias: false,     // Disable antialias for performance
    });
    document.body.appendChild(app.canvas);

    // Expose app for PixiJS DevTools
    (globalThis as any).__PIXI_APP__ = app;
    showGameInfosPannel(app, ['drawcalls', 'fps']);

    // 3. Load Assets
    const texture = await Assets.load(shibaImg);

    // 4. Variables for simulation
    const shibas: Shiba[] = [];
    const gravity = 0.5;
    let maxX = app.screen.width;
    let maxY = app.screen.height;
    const container = new Container();
    app.stage.addChild(container);
    
    // 5. Setup Filter
    const filter = new ColorMatrixFilter();
    filter.desaturate();

    // 6. UI Manager
    let isFilterEnabled = false;
    const uiManager = new UIManager(
        (count) => addShibas(count),
        (enable) => {
            isFilterEnabled = enable;
            const currentFilters = enable ? [filter] : [];
            shibas.forEach(shiba => {
                shiba.filters = currentFilters;
            });
        }
    );

    // 6. Function to add Shibas
    const addShibas = (count: number) => {
        const currentFilters = isFilterEnabled ? [filter] : [];
        for (let i = 0; i < count; i++) {
            const shiba = new Shiba(texture);
            shiba.randomizePosition(maxX, maxY);
            shiba.filters = currentFilters;
            
            shibas.push(shiba);
            container.addChild(shiba);
        }
        uiManager.updateShibaCount(shibas.length);
    };

    // Initialize
    addShibas(100); // Start with 100

    // 7. Handle Resize
    window.addEventListener('resize', () => {
        maxX = app.screen.width;
        maxY = app.screen.height;
    });

    // 8. Game Loop
    app.ticker.add(() => {
        stats.begin();
        
        for (const shiba of shibas) {
            shiba.update(gravity, maxX, maxY);
        }
        
        stats.end();
    });
})();
