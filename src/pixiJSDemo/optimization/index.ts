import { Application, Container, Sprite, Texture, Graphics, Text, BitmapText, ColorMatrixFilter, TextStyle, Assets, BitmapFont } from 'pixi.js';
import Stats from 'stats.js';
import GUI from 'lil-gui';
import { showGameInfosPannel } from '../../tools';
import { createDescriptionPanel } from './src/DescriptionPanel'; // ★ 引入元件
import { t, onLangChange, mountLangToggle } from '../../i18n';
import { wireGoBack } from '../../shell/goBack';
import { BenchRunner, BenchPanel, type BenchCase } from '../../bench';

(async () => {
    // 1. 初始化
    // renderer 由 URL 決定（?renderer=webgl），預設 WebGPU。
    // 兩種 backend 各跑一次 benchmark，才能得到 WebGL vs WebGPU 的對照數據。
    const urlParams = new URLSearchParams(window.location.search);
    const preference = urlParams.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({
        background: '#1a1a1a',
        resizeTo: window,
        preference,
        antialias: false
    });
    document.body.appendChild(app.canvas);

    (globalThis as any).__PIXI_APP__ = app;
    showGameInfosPannel(app, ['fps', 'drawcalls']); // 我們主要看 FPS 變化

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    const descPanel = createDescriptionPanel();

    // 2. 全域變數
    const container = new Container();
    app.stage.addChild(container);
    
    let currentTest: (() => void) | null = null;
    let isOptimized = false;
    let objectCount = 2000; // 預設物件數量
    const objects: any[] = [];
    
    // 載入兔子圖 (作為通用素材)
    const bunnyTexture = await Assets.load('https://pixijs.com/assets/bunny.png');

    // 預先生成 BitmapFont (為了測試 2)
    // Pixi v8 可以直接從系統字體生成 BitmapFont，超方便
    BitmapFont.install({
        name: 'DebugFont',
        style: new TextStyle({
            fontFamily: 'Arial',
            fontSize: 24,
            fill: 'white',
            fontWeight: 'bold'
        })
    });

    // 預先生成一個圓形 Texture (為了測試 3)
    const circleGraphics = new Graphics().circle(0,0,16).fill(0xffffff);
    // 注意：v8 中 generateTexture 改由 renderer 呼叫，或者用 app.renderer
    // 這裡我們簡單用 graphics 轉 texture 的方法 (需視 v8 版本而定，最穩是 renderer.generateTexture)
    // 簡單起見，我們這裡即時畫一個離屏 Canvas 轉 Texture，或者直接用 Graphics
    // 為了 Demo 穩定，我們用 renderer 生成
    const circleTexture = app.renderer.generateTexture(circleGraphics);


    // ==========================================
    // 核心測試邏輯
    // ==========================================

    // 清除場景
    const reset = () => {
        container.removeChildren();
        objects.length = 0;
    };

    // --- 測試案例 1: 顏色變換 (Tint vs Filter) ---
    const setupTintTest = () => {
        reset();
        
        // ★★★ 關鍵修正：限制 Naive Filter 的數量 ★★★
        // WebGPU 的 UBO Batch 有大小限制，2000 個獨立 Filter 會直接撐爆它導致 Crash。
        // 我們限制在 500 個，這足夠讓 FPS 掉下來，但不會 Crash。
        const count = isOptimized ? objectCount : Math.min(objectCount, 500); 

        for(let i=0; i<count; i++) {
            const bunny = new Sprite(bunnyTexture);
            bunny.x = Math.random() * app.screen.width;
            bunny.y = Math.random() * app.screen.height;
            bunny.anchor.set(0.5);
            
            // 隨機屬性
            (bunny as any).speed = 1 + Math.random();
            (bunny as any).hue = Math.random() * 360;

            if (!isOptimized) {
                // Naive: 每個物件掛一個獨立的 Filter (效能殺手!)
                bunny.filters = [new ColorMatrixFilter()]; 
            } else {
                // Optimized: 什麼都不用掛，用 Tint
                bunny.tint = 0xffffff;
            }

            container.addChild(bunny);
            objects.push(bunny);
        }
    };

    const updateTintTest = (time: number) => {
        for(let i=0; i<objects.length; i++) {
            const obj = objects[i];
            obj.rotation += 0.05;
            
            // 模擬顏色動態變化
            (obj as any).hue += 2;
            
            if (!isOptimized) {
                // Naive: 更新 Filter 參數 (極度耗能，因為每幀都要重新編譯/上傳 uniform)
                const filter = obj.filters[0] as ColorMatrixFilter;
                filter.hue((obj as any).hue, false);
            } else {
                // Optimized: 更新 Tint (極快，只是頂點屬性)
                // 簡單模擬顏色變化 (這裡隨便算個顏色)
                const val = Math.sin(time * 0.01 + i) * 127 + 128;
                obj.tint = (val << 16) | (val << 8) | 255;
            }
        }
    };


    // --- 測試案例 2: 大量文字 (BitmapText vs Text) ---
    const setupTextTest = () => {
        reset();
        // 文字數量少一點，因為 Text 非常重
        const count = Math.min(objectCount, 500); 

        for(let i=0; i<count; i++) {
            let textObj: any;

            if (!isOptimized) {
                // Naive: 使用標準 PIXI.Text
                // 這會導致每幀都建立 Canvas -> drawText -> upload Texture
                textObj = new Text({ text: 'Score: 0', style: { fill: 'white', fontSize: 24 } });
            } else {
                // Optimized: 使用 PIXI.BitmapText
                // 這只是畫 Sprite，超快
                textObj = new BitmapText({ text: 'Score: 0', style: { fontFamily: 'DebugFont', fontSize: 24 } });
            }

            textObj.x = Math.random() * app.screen.width;
            textObj.y = Math.random() * app.screen.height;
            (textObj as any).score = 0;
            
            container.addChild(textObj);
            objects.push(textObj);
        }
    };

    const updateTextTest = () => {
        for(let i=0; i<objects.length; i++) {
            const obj = objects[i];
            // 模擬數值跳動 (這是最傷效能的，因為內容變了)
            obj.score += 1;
            obj.text = `Score: ${obj.score}`; 
        }
    };


    // --- 測試案例 3: 幾何圖形 (Sprite vs Graphics) ---
    const setupGraphicsTest = () => {
        reset();
        
        for(let i=0; i<objectCount; i++) {
            let obj: any;

            if (!isOptimized) {
                // Naive: 使用 Graphics
                // 每個物件都是獨立的 Graphics 實例，無法合批
                const g = new Graphics();
                g.circle(0,0,16).fill(Math.random() * 0xffffff);
                obj = g;
            } else {
                // Optimized: 使用預先生成的 Texture (Sprite)
                // 這可以完美合批
                const s = new Sprite(circleTexture);
                s.anchor.set(0.5);
                s.tint = Math.random() * 0xffffff; // 用 Tint 來模擬不同顏色
                obj = s;
            }

            obj.x = Math.random() * app.screen.width;
            obj.y = Math.random() * app.screen.height;
            
            container.addChild(obj);
            objects.push(obj);
        }
    };

    const updateGraphicsTest = (time: number) => { // 記得傳入 time
        // 讓半徑隨時間變化，模擬動態圖形
        const radius = 16 + Math.sin(time * 0.005) * 5; 

        for(let i=0; i<objects.length; i++) {
            const obj = objects[i];
            
            // 基礎移動
            obj.x += (Math.random() - 0.5) * 2;
            obj.y += (Math.random() - 0.5) * 2;

            if (!isOptimized) {
                // ★ Naive 模式致命傷：每一幀都重畫 (Redraw per frame)
                // 這會觸發 CPU 的 "Tessellation" (將圓形算成三角形)，非常耗效能
                const color = obj.color;
                const g = obj as Graphics;
                g.clear(); 
                g.circle(0, 0, radius); 
                g.fill(color); 
                // g.tint 這裡沒用，因為我們是直接重畫 fill
            } else {
                // ★ Optimized 模式：只改變 Scale
                // 這是純 GPU 操作，完全不消耗 CPU 算幾何
                const s = obj as Sprite;
                const scale = radius / 16; // 換算比例
                s.scale.set(scale);
            }
        }
    };


    // ==========================================
    // 狀態機與 GUI
    // ==========================================

    const params = {
        testCase: 'Tint vs Filter',
        mode: 'Naive (Slow)',
        count: 2000,
    };

    const runTest = () => {
        descPanel.update(params.testCase, isOptimized);
        
        if (params.testCase === 'Tint vs Filter') {
            setupTintTest();
            currentTest = () => updateTintTest(performance.now());
        } else if (params.testCase === 'Text vs Bitmap') {
            setupTextTest();
            currentTest = () => updateTextTest();
        } else if (params.testCase === 'Sprite vs Graphics') {
            setupGraphicsTest();
            currentTest = () => updateGraphicsTest(performance.now());
        }
    };

    const gui = new GUI({ title: 'Optimization Lab' });

    const cScenario = gui.add(params, 'testCase', ['Tint vs Filter', 'Text vs Bitmap', 'Sprite vs Graphics'])
        .name(t('gui.testScenario'))
        .onChange(runTest);

    const cMode = gui.add(params, 'mode', ['Naive (Slow)', 'Optimized (Fast)'])
        .name(t('gui.mode'))
        .onChange((v: string) => {
            isOptimized = v === 'Optimized (Fast)';
            runTest(); // 重跑
        });

    const cCount = gui.add(params, 'count', 100, 5000, 100)
        .name(t('gui.objectCount'))
        .onChange((v: number) => {
            objectCount = v;
            runTest();
        });

    // ==========================================
    // Benchmark：把互動 demo 變成可重現的量測
    // ==========================================

    // 三個場景、兩種模式共用同一個物件數，對照才公平。
    // 上限 500 不是隨便挑的——Tint 場景的 naive 模式每個物件掛一個獨立 Filter，
    // 再多會撐爆 WebGPU 的 UBO batch（見 setupTintTest）。對照組必須一起遷就這個上限。
    const BENCH_COUNT = 500;

    const buildBenchCases = (): BenchCase[] => {
        const scenarios: Array<{ name: string; setup: () => void; update: (time: number) => void }> = [
            { name: 'Tint vs Filter', setup: setupTintTest, update: updateTintTest },
            { name: 'Text vs Bitmap', setup: setupTextTest, update: () => updateTextTest() },
            { name: 'Sprite vs Graphics', setup: setupGraphicsTest, update: updateGraphicsTest },
        ];

        const cases: BenchCase[] = [];
        for (const s of scenarios) {
            for (const mode of ['Naive', 'Optimized'] as const) {
                cases.push({
                    id: `${s.name}/${mode}`,
                    label: `${s.name} — ${mode}`,
                    meta: { scenario: s.name, mode, renderer: preference },
                    setup: () => {
                        isOptimized = mode === 'Optimized';
                        objectCount = BENCH_COUNT;
                        s.setup();
                        return objects.length; // 回報實際建立數，不是要求數
                    },
                    update: () => s.update(performance.now()),
                });
            }
        }
        return cases;
    };

    const benchPanel = new BenchPanel();

    // 取樣幀數可用 ?warmup= / ?sample= 覆寫，方便快速試跑；預設值見 bench/runner.ts
    const benchOverrides: Partial<{ warmupFrames: number; sampleFrames: number }> = {};
    const warmupParam = Number(urlParams.get('warmup'));
    const sampleParam = Number(urlParams.get('sample'));
    if (warmupParam > 0) benchOverrides.warmupFrames = warmupParam;
    if (sampleParam > 0) benchOverrides.sampleFrames = sampleParam;

    const benchRunner = new BenchRunner(app, benchOverrides);

    const runBenchmark = async () => {
        // 交出 ticker：互動模式的 update 若跟 bench 的 update 同時跑，量到的是兩倍工作量
        currentTest = null;

        const report = await benchRunner.run(buildBenchCases(), (done, total, c) => {
            benchPanel.progress(done, total, c.label);
        });
        benchPanel.results(report);

        // 還原成 GUI 上的互動設定
        isOptimized = params.mode === 'Optimized (Fast)';
        objectCount = params.count;
        runTest();
    };

    const cBench = gui.add({ run: runBenchmark }, 'run').name(t('gui.runBench'));

    // 啟動預設測試
    isOptimized = false; // 預設先看慢的
    runTest();

    // Ticker
    app.ticker.add(() => {
        stats.begin();
        if (currentTest) currentTest();
        stats.end();
    });

    // Back Button
    const backBtn = document.createElement('a');
    backBtn.innerText = t('nav.backFindings');
    backBtn.href = './findings.html'; // 壓測是「實驗結論」底下的實驗，返回回 Findings
    Object.assign(backBtn.style, { position: 'absolute',
        top: '55px',
        left: '20px',
        color: 'white',
        textDecoration: 'none',
        background: 'rgba(0,0,0,0.3)',
        padding: '10px 15px',
        borderRadius: '8px',
        fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        backdropFilter: 'blur(5px)',
        transition: 'background 0.3s',
        zIndex: '100' });
    document.body.appendChild(backBtn);
    wireGoBack(backBtn); // 返回＝回上一頁，不新增歷史紀錄

    // 語言切換鈕：擺在 back 正下方，避開右上的 lil-gui 與變寬的 back
    const langWrap = mountLangToggle({ style: { top: '55px', left: '20px' } });
    const placeLang = () => {
        langWrap.style.left = `${backBtn.offsetLeft}px`;
        langWrap.style.top = `${backBtn.offsetTop + backBtn.offsetHeight + 10}px`;
    };
    placeLang();

    // 語言切換時更新 back 與 GUI 控制項名稱（說明面板自行訂閱）
    onLangChange(() => {
        backBtn.innerText = t('nav.backFindings');
        cScenario.name(t('gui.testScenario'));
        cMode.name(t('gui.mode'));
        cCount.name(t('gui.objectCount'));
        cBench.name(t('gui.runBench'));
        placeLang(); // back 文字變寬/變窄後重新定位語言鈕
    });

})();