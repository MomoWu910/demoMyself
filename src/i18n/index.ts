/**
 * 輕量雙語 (en / zh-TW) i18n —— 無框架、跨所有 webpack entry 共用。
 *
 * - 靜態 HTML：在元素加 data-i18n="key"（textContent）、data-i18n-html（innerHTML）、data-i18n-title（title 屬性）。
 * - 動態 TS UI（Pixi HUD / lil-gui / 配置器 presets）：呼叫 t(key)，並用 onLangChange() 訂閱以在切換時重繪。
 * - 預設英文；使用者選擇存 localStorage，跨頁記住。
 * - 專有 / 技術名詞（PixiJS、Three.js、WebGL、PBR…）兩種語言維持英文。
 */
export type Lang = 'en' | 'zh';

type Entry = { en: string; zh: string };

const DICT: Record<string, Entry> = {
    // ---- 文件標題 ----
    'title.home': { en: 'Eric Wu | Interactive 3D & Frontend Demos', zh: 'Eric Wu | 互動 3D 與前端 Demo' },
    'title.hub': { en: 'PixiJS Experiments | Eric Wu', zh: 'PixiJS 實驗場 | Eric Wu' },
    'title.configurator': { en: 'Product Configurator', zh: '產品配置器' },
    'title.rwd': { en: 'RWD Showcase | Eric Wu', zh: 'RWD 響應式展示 | Eric Wu' },
    'title.shaderLab': { en: 'Shader Lab | Eric Wu', zh: 'Shader Lab | Eric Wu' },

    // ---- 導覽 ----
    'nav.back': { en: '← Back', zh: '← 返回' },
    'nav.backHome': { en: '← Back to Home', zh: '← 返回首頁' },
    'nav.backHub': { en: '← PixiJS Experiments', zh: '← PixiJS 實驗場' },

    // ---- 首頁 ----
    'home.role': { en: 'Frontend Engineer · 3D / High-Interaction / Complex Web Apps', zh: '前端工程師 · 3D / 高互動 / 複雜 Web 應用' },
    'home.crossEngine.title': { en: 'Cross-Engine Rendering', zh: '跨引擎渲染' },
    'home.crossEngine.desc': {
        en: 'PixiJS (2D UI) and Three.js (3D scene) drawing into a <strong>single shared WebGL context</strong> — manual GL state management to avoid depth / stencil / culling pollution, with cannon-es physics.',
        zh: 'PixiJS（2D UI）與 Three.js（3D 場景）繪製進<strong>同一個共用 WebGL context</strong> — 手動管理 GL 狀態以避免 depth / stencil / culling 污染，搭配 cannon-es 物理。',
    },
    'home.crossEngine.cta': { en: 'Open Demo →', zh: '開啟 Demo →' },
    'home.configurator.title': { en: '3D Product Configurator', zh: '3D 產品配置器' },
    'home.configurator.desc': {
        en: 'Babylon.js real-time configurator: swap finishes (matte / leather / glossy / metallic) and colors, tune studio lighting & background live, with PBR + IBL, soft shadows, post-processing, and colorway variants (glTF KHR_materials_variants).',
        zh: 'Babylon.js 即時配置器：切換質感（matte / leather / glossy / metallic）與顏色、即時調整棚拍打光與背景，搭配 PBR + IBL、柔和陰影、後製，與 colorway 變體（glTF KHR_materials_variants）。',
    },
    'home.configurator.cta': { en: 'Configure →', zh: '進入配置 →' },
    'home.lab.title': { en: 'Rendering Findings', zh: '渲染效能實測結論' },
    'home.lab.desc': {
        en: 'Two test cases, <strong>identical draw call counts, 6.5× the CPU cost</strong>. A measured report on PixiJS v8: how I profiled it, what it proved, and why a single metric can invert your conclusion.',
        zh: '兩個測試案例，<strong>一模一樣的 draw call 數，CPU 成本卻差 6.5 倍</strong>。一份 PixiJS v8 的實測報告：我怎麼量、量到了什麼，以及為什麼只看單一指標會讓結論完全反過來。',
    },
    'home.lab.foot': { en: 'Measured, not claimed', zh: '量出來的，不是講出來的' },
    'home.lab.cta': { en: 'Read Report →', zh: '閱讀報告 →' },
    'home.rwd.title': { en: 'RWD Showcase', zh: 'RWD 響應式展示' },
    'home.rwd.desc': {
        en: 'Built-in device simulator: preview every page of this site in iPhone / iPad / desktop viewports, rotate, or free-drag to any window size — layouts stay intact everywhere.',
        zh: '站內建裝置模擬器：以 iPhone / iPad / 桌機視口即時預覽本站每一頁，可轉向、可自由拖拉任意視窗尺寸——所有佈局都不爆版。',
    },
    'home.rwd.cta': { en: 'Open Simulator →', zh: '開啟模擬器 →' },
    'home.shader.title': { en: 'Shader Lab', zh: 'Shader Lab' },
    'home.shader.desc': {
        en: 'Custom PixiJS v8 shaders with <strong>GLSL and WGSL hand-written side by side</strong> — dissolve, water ripple, and a flag deformed in the vertex stage. Outputs verified by reading the framebuffer on both backends, not by eyeballing them. Live controls in React + Zustand, the shader source on screen, and what each effect actually costs.',
        zh: '自訂 PixiJS v8 shader，<strong>GLSL 與 WGSL 兩份原始碼手寫並存</strong>——溶解、水波折射，以及一面在 vertex 階段被扭曲的旗幟。輸出是讀 framebuffer 在兩個 backend 上逐像素比對出來的，不是用眼睛看的。控制面板用 React + Zustand，原始碼直接攤在畫面上，並說明每個效果真正的代價。',
    },
    'home.shader.foot': { en: 'GLSL + WGSL, both written by hand', zh: 'GLSL + WGSL，兩份都自己寫' },
    'home.shader.cta': { en: 'Open Lab →', zh: '進入 Lab →' },

    // ---- RWD Showcase ----
    'rwd.title': { en: 'RWD Showcase', zh: 'RWD 響應式展示' },
    'rwd.subtitle': {
        en: 'Live device simulator — every page of this site, at any viewport size',
        zh: '即時裝置模擬器——本站每一頁，任意 viewport 尺寸',
    },
    'rwd.device': { en: 'Device', zh: '裝置' },
    'rwd.page': { en: 'Page', zh: '頁面' },
    'rwd.rotate': { en: '↻ Rotate', zh: '↻ 轉向' },
    'rwd.hint': {
        en: 'Canvas demos resize live — drag the cyan handle at the bottom-right corner for any custom size.',
        zh: 'Canvas demo 會即時跟著改變尺寸——拖曳右下角青色手把可拉出任意自訂尺寸。',
    },
    'rwd.handleTitle': { en: 'Drag to resize', zh: '拖曳改變尺寸' },
    'rwd.page.home': { en: 'Home', zh: '首頁' },
    'rwd.page.px3': { en: 'Cross-Engine', zh: '跨引擎' },
    'rwd.page.cfg': { en: 'Configurator', zh: '配置器' },
    'rwd.page.hub': { en: 'Pixi Hub', zh: 'Pixi 實驗場' },
    'rwd.page.stress': { en: 'Filter Stress', zh: '濾鏡壓測' },
    'rwd.page.shiba': { en: 'Shiba Bench', zh: '柴犬壓測' },
    'rwd.page.opt': { en: 'Optimization', zh: '最佳化 Lab' },
    'rwd.page.find': { en: 'Findings', zh: '實測結論' },
    'rwd.page.shader': { en: 'Shader Lab', zh: 'Shader Lab' },

    // ---- pixiHub ----
    'hub.title': { en: 'PixiJS Experiments', zh: 'PixiJS 實驗場' },
    'hub.subtitle': { en: 'Rendering performance tests & prototypes', zh: '渲染效能測試與原型' },
    'hub.stress.title': { en: '⚠️ Filter Stress Test', zh: '⚠️ 濾鏡壓力測試' },
    'hub.stress.desc': {
        en: 'Render pipeline stress test — benchmarking render pass overhead in WebGL vs WebGPU by intentionally breaking batching with per-object filters.',
        zh: '渲染管線壓力測試 — 以每物件濾鏡刻意打斷合批，量測 WebGL 與 WebGPU 的 render pass 開銷。',
    },
    'hub.stress.foot': { en: 'Render Pass Analysis', zh: 'Render Pass 分析' },
    'hub.stress.cta': { en: 'Run Test ▶', zh: '執行測試 ▶' },
    'hub.shiba.desc': {
        en: "Stress testing PixiJS's batch renderer with 100k+ sprites. Benchmarking CPU-bound transformation logic vs GPU rasterization.",
        zh: '以 10 萬+ sprite 壓測 PixiJS 批次渲染器，比較 CPU-bound 變換邏輯與 GPU 光柵化。',
    },
    'hub.shiba.foot': { en: 'Stability Test', zh: '穩定性測試' },
    'hub.shiba.cta': { en: 'Launch ▶', zh: '啟動 ▶' },
    'hub.opt.title': { en: '🛠️ Optimization Lab', zh: '🛠️ 最佳化實驗室' },
    'hub.opt.desc': {
        en: 'Interactive comparison of common rendering pitfalls (Text, Filters, Graphics) and their optimized solutions.',
        zh: '互動比較常見渲染陷阱（Text、Filters、Graphics）與其最佳化解法。',
    },
    'hub.opt.foot': { en: 'Practical Techniques', zh: '實務技巧' },
    'hub.opt.cta': { en: 'Open Lab ▶', zh: '開啟 Lab ▶' },

    // ---- 配置器 ----
    'cfg.title': { en: 'Product Configurator', zh: '產品配置器' },
    'cfg.subtitle': {
        en: 'Babylon.js · real-time PBR material / lighting · auto-generated UI per model part',
        zh: 'Babylon.js · PBR 即時材質 / 光照 · 自動依模型部件生成 UI',
    },
    'cfg.section.part': { en: 'Part', zh: '部件' },
    'cfg.section.finish': { en: 'Finish', zh: '質感' },
    'cfg.section.color': { en: 'Color', zh: '顏色' },
    'cfg.section.colorway': { en: 'Colorway', zh: '配色' },
    'cfg.section.lighting': { en: 'Lighting', zh: '打光' },
    'cfg.section.background': { en: 'Background', zh: '背景' },
    'cfg.slider.envInt': { en: 'Env Intensity', zh: '環境光強度' },
    'cfg.slider.envRot': { en: 'Env Rotation', zh: '環境旋轉' },
    'cfg.slider.keyInt': { en: 'Key Intensity', zh: '主光強度' },
    'cfg.slider.keyTemp': { en: 'Key Temp', zh: '主光色溫' },
    'cfg.btn.autorotate': { en: '◐ Auto-rotate', zh: '◐ 自動旋轉' },
    'cfg.btn.reset': { en: '⟲ Reset View', zh: '⟲ 重置視角' },
    'cfg.loading': { en: 'Loading 3D model…', zh: '載入 3D 模型…' },
    'cfg.preset.soft': { en: 'Soft', zh: '柔光棚' },
    'cfg.preset.dramatic': { en: 'Dramatic', zh: '戲劇側光' },
    'cfg.preset.ecom': { en: 'E-com', zh: '電商白' },
    'cfg.bg.studio': { en: 'Studio', zh: 'Studio' },
    'cfg.bg.gradient': { en: 'Gradient', zh: '漸層' },
    'cfg.bg.dark': { en: 'Dark', zh: '深色' },
    'cfg.bg.white': { en: 'White', zh: '純白' },
    'cfg.part.whole': { en: 'Whole Shoe', zh: '整雙鞋' },
    'cfg.sheet.customize': { en: 'Customize', zh: '配置選項' },

    // ---- pixiXthree HUD ----
    'px3.subtitle': { en: '2D HUD · 3D physics · one shared WebGL context', zh: '2D HUD · 3D 物理 · 共用一個 WebGL context' },
    'px3.hint': { en: '✋  Drag the scene to tilt the tray', zh: '✋  拖曳場景傾斜容器' },
    'px3.btn.add': { en: 'Add ×8', zh: '新增 ×8' },
    'px3.btn.shake': { en: 'Shake', zh: '搖晃' },
    'px3.btn.reset': { en: 'Reset', zh: '重置' },
    'px3.gravity.normal': { en: 'Gravity: Normal', zh: '重力：正常' },
    'px3.gravity.low': { en: 'Gravity: Low', zh: '重力：低' },

    // ---- 壓力測試 / 最佳化 (lil-gui) ----
    'gui.useWebGPU': { en: 'Use WebGPU ⚡', zh: '使用 WebGPU ⚡' },
    'gui.enableFilter': { en: 'Enable Filter (B&W)', zh: '啟用濾鏡（黑白）' },
    'gui.shibaCount': { en: 'Shiba Count', zh: '柴犬數量' },
    'gui.add100': { en: 'Add 100 Shibas 🐕', zh: '新增 100 隻柴犬 🐕' },
    'gui.backend': { en: 'Backend', zh: 'Backend' },
    'gui.objectCount': { en: 'Object Count', zh: '物件數量' },
    'gui.stepSize': { en: 'Step Size', zh: '每次數量' },
    'gui.addShibas': { en: 'Add Shibas 🐕', zh: '新增柴犬 🐕' },
    'gui.reset': { en: 'Reset 🗑️', zh: '重置 🗑️' },
    'gui.changeRenderer': { en: 'Change Renderer', zh: '切換渲染器' },
    'gui.testScenario': { en: 'Test Scenario', zh: '測試情境' },
    'gui.mode': { en: 'Mode', zh: '模式' },
    'gui.runBench': { en: '📊 Run Benchmark', zh: '📊 執行 Benchmark' },
    // ---- Pixi Hub：Findings 入口卡 ----
    'hub.findings.title': { en: '📊 Rendering Findings', zh: '📊 渲染效能實測結論' },
    'hub.findings.desc': {
        en: "What the experiments below actually proved. Measured CPU frame time and draw calls, the method behind the numbers, and the conclusions I'd act on in production.",
        zh: '下面那些實驗到底證明了什麼。實測的 CPU frame time 與 draw call、數字背後的量測方法，以及我在正式專案裡會據此做的決策。',
    },
    'hub.findings.foot': { en: 'Measured, not claimed', zh: '量出來的，不是講出來的' },
    'hub.findings.cta': { en: 'Read Findings →', zh: '閱讀結論 →' },

    // ---- Findings（渲染效能實測結論）----
    'title.findings': { en: 'Rendering Findings | Eric Wu', zh: '渲染效能實測結論 | Eric Wu' },
    'findings.title': { en: 'Rendering Findings', zh: '渲染效能實測結論' },
    'findings.lede': {
        en: "Measured conclusions from the PixiJS v8 Optimization Lab — not a feature tour. Every number below was produced by the in-page benchmark runner, on the hardware listed.",
        zh: '來自 PixiJS v8 Optimization Lab 的實測結論——不是功能導覽。以下每個數字都由站內的 benchmark runner 在下列硬體上實際跑出來。',
    },

    'findings.method.title': { en: 'How this was measured', zh: '量測方法' },
    'findings.method.metric.title': {
        en: 'The metric is CPU frame time, not FPS',
        zh: '主指標是 CPU frame time，不是 FPS',
    },
    'findings.method.metric.body': {
        en: "vsync pins FPS to the display's refresh rate, so under light load every case reports a flat 60 — while one of them has already eaten 12 ms of the 16.7 ms frame budget. Median and p95 CPU frame time expose both the typical cost and the stutter; FPS only shows up once you are already losing.",
        zh: 'vsync 會把 FPS 鎖在螢幕更新率上，所以輕負載時每個案例都回報 60 fps——即使其中一個已經吃掉 16.7ms 幀預算裡的 12ms。CPU frame time 的中位數與 p95 能同時暴露「平均成本」與「卡頓」；等 FPS 掉下來時，你早就輸了。',
    },
    'findings.method.window.title': {
        en: 'Where the measurement window sits',
        zh: '量測窗口擺在哪裡',
    },
    'findings.method.window.body': {
        en: "Pixi renders at ticker priority LOW (-25). The timer opens at HIGH (25) — where the case's per-frame logic also runs — and closes at UTILITY (-50), after render has submitted. So one sample = all CPU work for that frame: scene updates plus command submission.",
        zh: 'Pixi 的 render 掛在 ticker 的 LOW (-25)。計時器在 HIGH (25) 開啟（案例的每幀邏輯也在此執行），在 UTILITY (-50) 關閉，此時 render 已提交完畢。所以一個樣本 = 這一幀的全部 CPU 工作：場景更新加上指令提交。',
    },
    'findings.method.warmup.title': { en: 'Warm-up before sampling', zh: '取樣前先暖機' },
    'findings.method.warmup.body': {
        en: 'The first frames of any case are polluted by JIT compilation, texture uploads and shader compilation. Each case runs 45 discarded warm-up frames, then 180 sampled frames.',
        zh: '任何案例的前幾幀都被 JIT 編譯、貼圖上傳與 shader 編譯污染。每個案例先跑 45 幀暖機（丟棄），再取樣 180 幀。',
    },
    'findings.method.crosscheck.title': { en: 'Why FPS is still reported', zh: '為什麼還是要報告 FPS' },
    'findings.method.crosscheck.body': {
        en: 'CPU frame time only captures synchronous work on the main thread. A backend that hands a texture upload to the driver asynchronously will look cheap in that window while the frame still takes 300 ms to land. Reporting the real frame rate alongside it is what makes that gap visible — and Finding 04 exists entirely because the two disagreed.',
        zh: 'CPU frame time 只抓得到主執行緒上的同步工作。如果某個 backend 把貼圖上傳非同步丟給驅動，它在這個窗口裡看起來很便宜，但那一幀實際上還是花了 300ms 才畫完。同時報告真實幀率，才能讓這個落差現形——Finding 04 完全是因為這兩個指標互相矛盾才存在的。',
    },
    'findings.method.limits.title': { en: 'What this cannot measure', zh: '這套方法量不到什麼' },
    'findings.method.limits.body': {
        en: 'GPU rasterisation time is not observable from the browser (EXT_disjoint_timer_query is disabled in every major engine), so it is not reported rather than guessed. Draw calls are counted by wrapping the WebGL context — under WebGPU, commands are recorded on a GPURenderPassEncoder with no equivalent hook, so that column is honestly marked n/a.',
        zh: 'GPU 光柵化時間在瀏覽器裡觀測不到（EXT_disjoint_timer_query 在各大引擎都已停用），所以選擇不報告，而不是用猜的。Draw call 是靠包住 WebGL context 計數——WebGPU 的指令錄在 GPURenderPassEncoder 上，沒有等價的攔截點，該欄位就誠實標成 n/a。',
    },

    'findings.data.title': { en: 'Results', zh: '實測數據' },
    'findings.data.empty': {
        en: 'No measurements recorded yet. Open the Optimization Lab and hit Run Benchmark to generate them.',
        zh: '尚未記錄任何量測結果。開啟 Optimization Lab 並執行 Run Benchmark 即可產生。',
    },
    'findings.data.rerun': {
        en: 'Numbers are hardware-specific. Re-run them yourself: open the <a href="./pixi_optimization.html">Optimization Lab</a> and hit <b>Run Benchmark</b>.',
        zh: '數字會因硬體而異。你可以自己重跑：開啟 <a href="./pixi_optimization.html">Optimization Lab</a> 並點擊 <b>Run Benchmark</b>。',
    },
    'findings.col.scenario': { en: 'Scenario', zh: '情境' },
    'findings.col.mode': { en: 'Mode', zh: '模式' },
    'findings.col.objects': { en: 'Objects', zh: '物件數' },
    'findings.col.cpu': { en: 'CPU ms', zh: 'CPU ms' },
    'findings.col.fps': { en: 'FPS', zh: 'FPS' },
    'findings.col.draws': { en: 'Draws', zh: 'Draw calls' },
    'findings.col.vs': { en: 'vs Naive', zh: '相對 Naive' },

    'findings.f1.title': {
        en: 'A per-object filter is a per-object render pass',
        zh: '每個物件掛一個 filter，就是每個物件一個 render pass',
    },
    'findings.f1.body': {
        en: 'Pixi batches sprites aggressively — hundreds of tinted sprites cost a single draw call, because tint is just a vertex attribute riding along inside the batch. Attach a ColorMatrixFilter to each sprite and the batch collapses: every filtered object needs its own framebuffer round-trip, and the draw call count explodes in proportion to the object count.',
        zh: 'Pixi 的合批很積極——上百個帶 tint 的 sprite 只需要一次 draw call，因為 tint 只是跟著批次一起走的頂點屬性。但只要每個 sprite 各掛一個 ColorMatrixFilter，合批就崩潰了：每個被 filter 的物件都需要自己的 framebuffer 來回，draw call 數量隨物件數等比爆炸。',
    },
    'findings.f1.takeaway': {
        en: 'If all you need is a colour shift, <b>tint is free and a filter is not</b>. Reach for a filter only when you need something tint genuinely cannot express.',
        zh: '如果你只是要改顏色，<b>tint 是免費的，filter 不是</b>。只有在 tint 真的表達不了時，才動用 filter。',
    },

    'findings.f2.title': {
        en: 'Draw calls are not the whole story',
        zh: 'Draw call 不是全部的真相',
    },
    'findings.f2.body': {
        en: 'Redrawing a Graphics every frame — clear(), circle(), fill() — leaves the draw call count identical to the Sprite version, because Pixi still batches the resulting geometry. The cost sits upstream, on the CPU: each redraw re-tessellates the circle into triangles before a single byte reaches the GPU. A Sprite with a pre-generated texture merely changes a transform.',
        zh: '每幀重畫 Graphics——clear()、circle()、fill()——draw call 數量跟 Sprite 版本完全一樣，因為 Pixi 照樣把產生的幾何合批。成本在更上游的 CPU：每次重畫都要把圓形重新三角化（tessellation），資料根本還沒送到 GPU。而預先生成貼圖的 Sprite 只是改一個 transform。',
    },
    'findings.f2.takeaway': {
        en: 'Two cases can have <b>identical draw calls and wildly different frame times</b>. Profile the CPU, not just the batch count — optimising the number you can see is not the same as optimising the bottleneck.',
        zh: '兩個案例可以有<b>完全相同的 draw call，卻有天差地遠的 frame time</b>。要 profile CPU，不能只看合批數——優化「你看得到的數字」不等於優化真正的瓶頸。',
    },

    'findings.f3.title': {
        en: 'A mutating Text re-uploads a texture every frame',
        zh: '會變動的 Text，每幀都在重新上傳貼圖',
    },
    'findings.f3.body': {
        en: 'A Pixi Text whose string changes each frame must re-render itself to a canvas, then upload that canvas to the GPU as a texture — every frame, for every object. BitmapText draws pre-baked glyphs as sprites, so a changing score is just a different set of quads inside the same batch.',
        zh: '字串每幀變動的 Pixi Text，必須先把自己重繪到一張 canvas，再把那張 canvas 當貼圖上傳到 GPU——每一幀、每一個物件都來一次。BitmapText 則是把預先烘焙好的字形當 sprite 畫，所以分數跳動只是同一個批次裡換一組 quad 而已。',
    },
    'findings.f3.takeaway': {
        en: 'Any text that changes per frame — scores, timers, counters, damage numbers — should be <b>BitmapText</b>. Reserve Text for static labels.',
        zh: '任何會逐幀變動的文字——分數、計時器、計數器、傷害數字——都該用 <b>BitmapText</b>。Text 留給靜態標籤就好。',
    },

    'findings.exp.title': { en: 'Reproduce it yourself', zh: '自己重現一次' },
    'findings.exp.lede': {
        en: "Every conclusion above came out of these three labs. The benchmark runner is built into the first one — open it, hit Run Benchmark, and you'll get your own numbers on your own hardware.",
        zh: '上面每一條結論都是從這三個 Lab 跑出來的。Benchmark runner 就內建在第一個裡面——打開它、按下 Run Benchmark，你會在自己的硬體上得到自己的數字。',
    },
    'findings.exp.opt.title': { en: '🛠️ Optimization Lab', zh: '🛠️ Optimization Lab' },
    'findings.exp.opt.desc': {
        en: 'The source of all four findings. Three A/B scenarios, plus the benchmark runner that produced the table above.',
        zh: '四條結論的來源。三組 A/B 對照情境，以及產生上面那張表的 benchmark runner。',
    },
    'findings.exp.opt.cta': { en: 'Run the benchmark ▶', zh: '執行 benchmark ▶' },
    'findings.exp.stress.title': { en: '⚠️ Filter Stress Test', zh: '⚠️ Filter 壓力測試' },
    'findings.exp.stress.desc': {
        en: 'Finding 01 taken to its extreme — deliberately breaking batching with a filter per object, until the render passes bury the GPU.',
        zh: '把 Finding 01 推到極端——刻意用「每個物件一個 filter」打斷合批，直到 render pass 把 GPU 淹沒。',
    },
    'findings.exp.stress.cta': { en: 'Break it ▶', zh: '把它弄壞 ▶' },
    'findings.exp.shiba.title': { en: '🐕 Super Shiba Mark', zh: '🐕 Super Shiba Mark' },
    'findings.exp.shiba.desc': {
        en: 'The other end of the scale: 100k+ sprites in a single batch, where the bottleneck moves off the GPU and onto CPU-bound transforms.',
        zh: '光譜的另一端：10 萬個以上的 sprite 塞進同一個批次，此時瓶頸從 GPU 移到了 CPU 端的變換運算。',
    },
    'findings.exp.shiba.cta': { en: 'Launch ▶', zh: '啟動 ▶' },

    // ---- Hub 卡片：Shader Lab ----
    'hub.shader.title': { en: '🎨 Shader Lab', zh: '🎨 Shader Lab' },
    'hub.shader.desc': {
        en: 'Shaders written from scratch — GLSL and WGSL side by side. Two filters and one mesh material whose geometry is deformed in the vertex stage, so the cost of each technique is on the table. Live controls in React + Zustand, with the shader source on screen.',
        zh: '從零手寫的 shader——GLSL 與 WGSL 並存。兩個 filter，加上一個在 vertex 階段扭曲幾何的 mesh 材質，把每種技法的代價攤開來講。控制面板用 React + Zustand，shader 原始碼直接攤在畫面上。',
    },
    'hub.shader.foot': { en: 'GLSL + WGSL, both by hand', zh: 'GLSL + WGSL，兩份都自己寫' },
    'hub.shader.cta': { en: 'Open Lab ▶', zh: '進入 Lab ▶' },

    // ---- Shader Lab ----
    'shader.lab.title': { en: 'Shader Lab', zh: 'Shader Lab' },
    'shader.lab.subtitle': {
        en: 'Custom PixiJS v8 filters — GLSL and WGSL, hand-written side by side',
        zh: '自訂 PixiJS v8 filter——GLSL 與 WGSL 兩份手寫並存',
    },

    'shader.panel.effect': { en: 'Effect', zh: '效果' },
    'shader.panel.params': { en: 'Parameters', zh: '參數' },
    'shader.panel.source': { en: 'Shader source', zh: 'Shader 原始碼' },
    'shader.panel.cost': { en: 'What it costs', zh: '它的代價' },
    'shader.panel.animate': { en: 'Auto-play', zh: '自動播放' },
    'shader.panel.reset': { en: 'Reset', zh: '重設' },
    'shader.panel.fps': { en: 'fps', zh: 'fps' },

    'shader.source.glslNote': {
        en: 'WebGL path. GLSL 300 es — Pixi v8 filters run on WebGL2. Pixi supplies the default filter vertex shader, so only the fragment stage is written here.',
        zh: 'WebGL 路徑。GLSL 300 es——Pixi v8 的 filter 走 WebGL2。Pixi 有提供預設的 filter vertex shader，所以這裡只寫 fragment 階段。',
    },
    'shader.source.wgslNote': {
        en: 'WebGPU path. WGSL — Pixi ships no default WGSL filter vertex shader, so the vertex stage and the global filter uniforms are declared by hand. The noise functions must compute exactly the same values as the GLSL version, or the two backends drift apart.',
        zh: 'WebGPU 路徑。WGSL——Pixi 沒有提供 WGSL 版的預設 filter vertex shader，所以 vertex 階段與全域 filter uniform 都得自己宣告。noise 函式必須跟 GLSL 版算出完全相同的值，否則兩個 backend 會長得不一樣。',
    },

    'shader.param.progress': { en: 'Dissolve progress', zh: '溶解進度' },
    'shader.param.edgeWidth': { en: 'Burn edge width', zh: '灼燒邊緣寬度' },
    'shader.param.noiseScale': { en: 'Noise scale', zh: 'Noise 尺度' },
    'shader.param.edgeColor': { en: 'Burn edge color', zh: '灼燒邊緣顏色' },
    'shader.param.amplitude': { en: 'Wave amplitude (px)', zh: '波幅（px）' },
    'shader.param.frequency': { en: 'Wave frequency', zh: '波的密度' },
    'shader.param.speed': { en: 'Wave speed', zh: '波速' },
    'shader.param.chromaStrength': { en: 'Aberration strength (px)', zh: '色散強度（px）' },
    'shader.param.chromaFalloff': { en: 'Falloff from centre', zh: '離中心的衰減指數' },
    'shader.param.flagAmp': { en: 'Flap amplitude (px)', zh: '飄動幅度（px）' },
    'shader.param.flagFreq': { en: 'Ripples across the flag', zh: '旗面上的波數' },
    'shader.param.shading': { en: 'Slope shading', zh: '斜率明暗' },

    // 技法標籤：filter 與 mesh 材質的差別，就是這個 Lab 想講的核心
    'shader.technique.filter': { en: 'Technique · Filter', zh: '技法 · Filter' },
    'shader.technique.filter.note': {
        en: 'Post-processes an already-rendered image. Can read neighbouring pixels — pays for it with its own render pass, out of the batch.',
        zh: '對「已經畫好的畫面」做後處理。能讀鄰近像素，代價是自己獨立成一個 render pass、被踢出合批。',
    },
    'shader.technique.mesh': { en: 'Technique · Mesh material', zh: '技法 · Mesh 材質' },
    'shader.technique.mesh.note': {
        en: 'The shader IS the object\'s material. No extra render pass, no scratch texture — but it cannot see any pixel other than its own.',
        zh: 'shader 就是物件的材質本身。沒有額外的 render pass、沒有暫存貼圖——但它看不到自己以外的任何像素。',
    },

    'shader.chromatic.title': { en: 'Chromatic Aberration', zh: '鏡頭色差' },
    'shader.chromatic.desc': {
        en: 'Real lenses refract red and blue light to slightly different points, so fringes appear — and they grow the further you are from the optical axis. The same coordinate is sampled three times, each offset along the direction away from centre, and only one channel is kept from each. A uniform shift would not be aberration; it would just be a misregistered print.',
        zh: '真實鏡頭對紅光與藍光的折射率不同，兩者沒有落在同一點上，於是出現紅／藍分離——而且離光軸越遠越明顯。同一個座標取樣三次、各自沿著離開中心的方向錯開，每次只取其中一個 channel。均勻的整片位移不是色差，那只是印刷沒對準。',
    },
    'shader.chromatic.cost': {
        en: 'Three texture fetches per pixel instead of one. Texture bandwidth, not ALU, is what you are spending here — and bandwidth is the resource that runs out first on mobile GPUs. The subtle trap is premultiplied alpha: the three samples land in different places and therefore carry different alphas, so each channel must be divided back out by its own alpha before being combined, then repremultiplied by a single shared alpha. Skip that and translucent edges pick up colour fringing that is a bug, not an effect.',
        zh: '每個像素從一次取樣變成三次。你花掉的是**貼圖頻寬**而不是 ALU——而頻寬正是行動裝置 GPU 最先耗盡的資源。隱晦的陷阱在預乘 alpha：三個取樣點落在不同位置、各自的 alpha 也不同，所以每個 channel 都得先除回自己的 alpha 再組合，最後用一個共用的 alpha 重新預乘。省掉這步，半透明邊緣會出現一圈「不是特效、是 bug」的色邊。',
    },

    'shader.flag.title': { en: 'Waving Flag', zh: '飄動旗幟' },
    'shader.flag.desc': {
        en: 'The only effect here whose geometry is deformed in the vertex shader. A 48×16 subdivided plane; each vertex offsets itself by a sine wave scaled by its distance from the pole. The shading is not lighting — it is the slope of that wave (one cos), so the flag reads as three-dimensional for free.',
        zh: '這裡唯一在 vertex shader 裡扭曲幾何的效果。一張 48×16 細分的 plane，每個頂點依自己離旗杆的距離算出正弦波位移。明暗不是打光，而是那道波的斜率（一行 cos）——立體感是白送的。',
    },
    'shader.flag.cost': {
        en: 'This is the cheap end of animation. 48×16 = 768 vertices, versus the hundreds of thousands of pixels a fragment shader would touch — and because the shader is the material rather than a filter, there is no extra render pass and no scratch texture at all. Flags, grass, water surfaces, a character\'s breathing: if the motion can be expressed as geometry, do it in the vertex stage. The trade-off is absolute — a vertex shader cannot see any pixel other than its own, which is exactly why the ripple effect could not be built this way.',
        zh: '這是動畫最便宜的那一端。48×16 = 768 個頂點，對比 fragment shader 要碰的幾十萬個像素——而且因為 shader 是材質本身而不是 filter，完全沒有額外的 render pass、沒有暫存貼圖。旗幟、草叢、水面起伏、角色的呼吸：只要動作能用幾何表達，就該在 vertex 階段做。取捨是絕對的——vertex shader 讀不到自己以外的任何像素，這正是水波那種效果沒辦法用這條路做的原因。',
    },

    'shader.dissolve.title': { en: 'Dissolve', zh: '溶解' },
    'shader.dissolve.desc': {
        en: 'The classic spawn / death effect. The noise is generated procedurally in the shader (hash + 4-octave fbm) rather than sampled from a texture, and the pixels riding the dissolve boundary glow.',
        zh: '最經典的出場／死亡特效。noise 不是從貼圖取樣，而是在 shader 裡即時算出來（hash + 4 個八度的 fbm），並讓正好落在溶解邊界上的像素發光。',
    },
    'shader.displacement.title': { en: 'Water Ripple', zh: '水波折射' },
    'shader.displacement.desc': {
        en: 'UV displacement — the pixel does not recolor itself, it goes and samples somewhere else. Two sine waves at different frequencies and phases, so it reads as water rather than a sheet sliding sideways.',
        zh: 'UV 位移——像素不是把自己重新上色，而是「跑去別的地方取樣」。兩道不同頻率與相位的正弦波疊起來，看起來才像水，而不是整片一起平移。',
    },
    'shader.displacement.cost': {
        en: 'A gather operation: to read neighbouring pixels it needs an already-rendered input texture, which is exactly why it has to be a filter — and why it costs a render pass. The maths is cheap (two sin/cos and one fetch per pixel); the expensive knob is padding. The filter\'s scratch texture is (w + 2p) × (h + 2p), so on a 200×200 sprite, raising padding from 0 to 40px is 2.0× the fillrate. Padding is not "set it high to be safe" — it multiplies straight into the cost.',
        zh: '這是一個 gather 操作：要讀鄰近像素，就得先有一張「已經畫好」的輸入貼圖——這正是它必須是 filter 的原因，也是它要付一個 render pass 的原因。數學本身很便宜（每像素兩次 sin/cos、一次取樣），真正貴的旋鈕是 padding：filter 的暫存貼圖是 (w + 2p) × (h + 2p)，在一個 200×200 的 sprite 上，padding 從 0 加到 40px 就是 2.0 倍的 fillrate。padding 不是「設大一點比較安全」的東西，它是直接乘在成本上的。',
    },

    'shader.dissolve.cost': {
        en: 'No noise texture: one less asset and one less texture fetch, paid for with a few dozen extra ALU instructions per pixel — a good trade on any modern GPU. The real cost is not the maths but the filter itself: it forces the sprite out of the batch and into its own render pass, so a hundred dissolving enemies means a hundred render passes. Bake it into a mesh material instead, and they batch again.',
        zh: '不用 noise 貼圖：省下一張素材與一次貼圖取樣，代價是每像素多幾十道 ALU 指令——在任何現代 GPU 上都划算。真正的成本不在數學，而在 filter 本身：它會把 sprite 踢出合批、獨立成一個 render pass，所以一百隻正在溶解的敵人就是一百個 render pass。改成寫進 mesh 材質，它們就能重新合批。',
    },

    // ---- Shader 成本卡：實測數字（見 shaderLab/bench） ----
    'shader.cost.run': { en: 'Measure ▸', zh: '量測成本 ▸' },
    'shader.cost.running': { en: 'Measuring…', zh: '量測中…' },
    'shader.cost.hint': {
        en: 'No numbers baked in yet for this effect. Click “Measure” to run the benchmark on your machine, then export the JSON.',
        zh: '這個效果還沒有實測數字。按「量測成本」在你的機器上跑一次 benchmark，再匯出 JSON。',
    },
    'shader.cost.drawcall': { en: 'Draw calls · 1 sprite (WebGL)', zh: 'Draw call · 單一 sprite（WebGL）' },
    'shader.cost.note': {
        en: 'Draw calls are exact (WebGL): a filter forces its own render pass, a mesh material does not. The fragment-shader maths is not shown because it sits below the measurement floor on this GPU — 48× overdraw never dropped a frame. These effects cost you render-pass structure, not ALU.',
        zh: 'Draw call 是精確值（WebGL）：filter 會逼出自己的一道 render pass，mesh 材質不會。fragment shader 的數學成本不列——它在這顆 GPU 上低於量測地板（疊 48 層都沒掉一幀）。這些效果的成本在 render pass 結構，不在數學。',
    },
    'shader.cost.layering': {
        en: 'Architecture · N filters vs one',
        zh: '架構 · N 個 filter vs 單一 filter',
    },
    'shader.cost.layering.perObject': { en: 'A filter on every object', zh: '每個物件各掛一個 filter' },
    'shader.cost.layering.container': { en: 'One filter on the parent', zh: '父容器掛單一 filter' },
    'shader.cost.layering.note': {
        en: 'Same visual, same object count. Per-object filters force one render pass each; moving the filter up to the parent container collapses them into a single pass — the draw-call gap is the whole point.',
        zh: '同樣的畫面、同樣的物件數。每物件各掛一個 filter 就是各開一道 render pass；把 filter 上移到父容器，全部併成一道——draw call 的落差就是重點。',
    },

    'findings.f4.title': {
        en: 'The same cost, booked in two different places',
        zh: '同一筆成本，被記在兩個不同的地方',
    },
    'findings.f4.body': {
        en: 'Take the worst case above — 500 Text objects mutating every frame. Under WebGL it costs 12.7 ms of CPU frame time; under WebGPU, 182.2 ms. A 14× gap that seems to say WebGPU is catastrophically slower. The real frame rate says the exact opposite: 3.2 fps on WebGL versus 5.5 fps on WebGPU. WebGL\'s texSubImage2D hands the upload to the driver and returns immediately, so most of that frame never enters the CPU measurement window at all; WebGPU blocks synchronously in JavaScript and books the entire bill somewhere you can actually see it. Note also that this display runs at 120 Hz — the budget is 8.3 ms, so WebGL\'s "modest" 12.7 ms had already blown it. Neither backend is fine here. They just file the invoice in different places.',
        zh: '拿上面最慘的案例——500 個每幀變動的 Text。在 WebGL 下花掉 12.7ms 的 CPU frame time，在 WebGPU 下是 182.2ms。14 倍的落差，看起來像是在說 WebGPU 慢得離譜。但真實幀率講的是完全相反的故事：WebGL 3.2 fps，WebGPU 5.5 fps。WebGL 的 texSubImage2D 把上傳丟給驅動就立刻返回，所以那一幀的大部分成本根本沒進到 CPU 量測窗口；WebGPU 則是同步阻塞在 JavaScript 裡，把整筆帳記在你看得見的地方。另外別忘了這台螢幕是 120Hz——frame budget 只有 8.3ms，所以 WebGL 那個看似溫和的 12.7ms 其實早就爆掉了。兩個 backend 在這裡都不及格，它們只是把帳單開在不同的地方而已。',
    },
    'findings.f4.takeaway': {
        en: '<b>A single metric can invert your conclusion.</b> WebGPU did not make this workload slower — it made an existing cost visible. Which is also why the answer is not "switch backend", it is "stop uploading 500 textures per frame".',
        zh: '<b>只看單一指標，會讓你的結論完全反過來。</b>WebGPU 沒有讓這個工作負載變慢——它只是讓本來就存在的成本現形。這也正是為什麼解法不是「換 backend」，而是「別再每幀上傳 500 張貼圖」。',
    },

    'gui.folder.info': { en: 'Info', zh: '資訊' },
    'gui.folder.actions': { en: 'Actions', zh: '操作' },
    'gui.folder.system': { en: 'System', zh: '系統' },

    // ---- 最佳化說明面板 ----
    'opt.select': { en: 'Select a test scenario…', zh: '請選擇測試情境…' },
    'opt.tintFilter.naive': {
        en: `<strong style="color:#ff5555">🔴 Naive (Filters)</strong><br>A separate ColorMatrixFilter on every object.<br><span style="color:#aaa">• Breaks batching</span><br><span style="color:#aaa">• Adds render-pass switching cost</span><br><span style="color:#aaa">• Prone to UBO memory overflow</span>`,
        zh: `<strong style="color:#ff5555">🔴 Naive (Filters)</strong><br>每個物件都掛載獨立的 ColorMatrixFilter。<br><span style="color:#aaa">• 打斷 Batching（合批失效）</span><br><span style="color:#aaa">• 增加 Render Pass 切換成本</span><br><span style="color:#aaa">• 容易導致 UBO 記憶體溢出</span>`,
    },
    'opt.tintFilter.optimized': {
        en: `<strong style="color:#00d2ff">🟢 Optimized (Tint)</strong><br>Modify vertex color via Sprite.tint.<br><span style="color:#aaa">• Perfect batching</span><br><span style="color:#aaa">• Zero extra GPU cost</span><br><span style="color:#aaa">• Great for damage / recolor effects</span>`,
        zh: `<strong style="color:#00d2ff">🟢 Optimized (Tint)</strong><br>使用 Sprite.tint 修改頂點顏色屬性。<br><span style="color:#aaa">• 完美合批 (Batching)</span><br><span style="color:#aaa">• 零 GPU 額外負擔</span><br><span style="color:#aaa">• 適合做受傷、變色等效果</span>`,
    },
    'opt.textBitmap.naive': {
        en: `<strong style="color:#ff5555">🔴 Naive (PIXI.Text)</strong><br>Updates text content every frame.<br><span style="color:#aaa">• Triggers Canvas 2D redraw</span><br><span style="color:#aaa">• Triggers texture upload (bandwidth killer)</span><br><span style="color:#aaa">• Heavy CPU & memory use</span>`,
        zh: `<strong style="color:#ff5555">🔴 Naive (PIXI.Text)</strong><br>每幀更新文字內容。<br><span style="color:#aaa">• 觸發 Canvas 2D 重繪</span><br><span style="color:#aaa">• 觸發 Texture 上傳 (頻寬殺手)</span><br><span style="color:#aaa">• 極度消耗 CPU 與記憶體</span>`,
    },
    'opt.textBitmap.optimized': {
        en: `<strong style="color:#00d2ff">🟢 Optimized (BitmapText)</strong><br>Uses a pre-generated font atlas.<br><span style="color:#aaa">• Renders just like a Sprite</span><br><span style="color:#aaa">• Zero Canvas redraw cost</span><br><span style="color:#aaa">• Ideal for scores / timers</span>`,
        zh: `<strong style="color:#00d2ff">🟢 Optimized (BitmapText)</strong><br>使用預先生成的字型圖集 (Atlas)。<br><span style="color:#aaa">• 渲染方式等同於 Sprite</span><br><span style="color:#aaa">• 零 Canvas 重繪成本</span><br><span style="color:#aaa">• 適合分數、計時器等高頻變動文字</span>`,
    },
    'opt.spriteGraphics.naive': {
        en: `<strong style="color:#ff5555">🔴 Naive (Graphics)</strong><br>clear() + drawCircle() redraw every frame.<br><span style="color:#aaa">• CPU re-tessellates geometry</span><br><span style="color:#aaa">• Cannot batch (each Graphics is unique)</span><br><span style="color:#aaa">• A perf killer for dynamic shapes</span>`,
        zh: `<strong style="color:#ff5555">🔴 Naive (Graphics)</strong><br>每幀執行 clear() 與 drawCircle() 重畫。<br><span style="color:#aaa">• CPU 需重新計算幾何 (Tessellation)</span><br><span style="color:#aaa">• 無法合批 (每個 Graphics 都是獨立的)</span><br><span style="color:#aaa">• 動態圖形的效能殺手</span>`,
    },
    'opt.spriteGraphics.optimized': {
        en: `<strong style="color:#00d2ff">🟢 Optimized (Texture)</strong><br>Bake the Graphics into a Texture up front.<br><span style="color:#aaa">• Only Scale / Transform updates (GPU)</span><br><span style="color:#aaa">• Near-zero CPU cost</span><br><span style="color:#aaa">• Ideal for particles / health bars</span>`,
        zh: `<strong style="color:#00d2ff">🟢 Optimized (Texture)</strong><br>預先將 Graphics 轉為 Texture。<br><span style="color:#aaa">• 僅更新 Scale/Transform (GPU 處理)</span><br><span style="color:#aaa">• CPU 負擔幾乎為零</span><br><span style="color:#aaa">• 適合粒子、血條等重複圖形</span>`,
    },
};

const STORAGE_KEY = 'site-lang';
const listeners = new Set<(l: Lang) => void>();
let current: Lang = readLang();

function readLang(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'zh') return v;
    } catch { /* localStorage 不可用時退回預設 */ }
    return 'en';
}

export function getLang(): Lang {
    return current;
}

/** 取譯文；查無 key 時回傳 key 本身（方便發現漏譯） */
export function t(key: string): string {
    const e = DICT[key];
    return e ? e[current] : key;
}

export function onLangChange(fn: (l: Lang) => void): void {
    listeners.add(fn);
}

export function setLang(l: Lang): void {
    if (l === current) return;
    current = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    document.documentElement.lang = l === 'zh' ? 'zh-TW' : 'en';
    applyDom();
    listeners.forEach((fn) => fn(l));
}

/** 套用到靜態 DOM（data-i18n / -html / -title） */
export function applyDom(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
    root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => { el.innerHTML = t((el as any).dataset.i18nHtml); });
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { (el as HTMLElement).title = t((el as any).dataset.i18nTitle); });
}

/** 建立「EN / 中」切換鈕。parent 給定則插入該容器（流式排版），否則 fixed 定位到 body。 */
export function mountLangToggle(opts: { parent?: HTMLElement; style?: Partial<CSSStyleDeclaration> } = {}): HTMLElement {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        display: 'inline-flex', gap: '2px', padding: '3px', borderRadius: '10px',
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(8px)', zIndex: '200', fontFamily: 'Segoe UI, Roboto, sans-serif',
        ...(opts.parent ? {} : { position: 'fixed' as const }),
        ...opts.style,
    } as CSSStyleDeclaration);

    const seg = (lang: Lang, text: string) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.dataset.lang = lang;
        Object.assign(b.style, {
            border: 'none', cursor: 'pointer', borderRadius: '7px', padding: '5px 11px',
            fontSize: '13px', background: 'transparent', color: '#a1a1aa', transition: 'all 0.15s',
        });
        b.addEventListener('click', () => setLang(lang));
        return b;
    };
    const enBtn = seg('en', 'EN');
    const zhBtn = seg('zh', '中');
    wrap.append(enBtn, zhBtn);

    const paint = () => {
        [enBtn, zhBtn].forEach((b) => {
            const active = b.dataset.lang === current;
            b.style.background = active ? 'rgba(0,210,255,0.18)' : 'transparent';
            b.style.color = active ? '#00d2ff' : '#a1a1aa';
            b.style.fontWeight = active ? '700' : '500';
        });
    };
    onLangChange(paint);
    paint();

    (opts.parent ?? document.body).appendChild(wrap);
    return wrap;
}

/** 頁面初始化：設 <html lang>、套用靜態翻譯、（可選）掛切換鈕 */
export function initI18n(toggle?: { parent?: HTMLElement; style?: Partial<CSSStyleDeclaration> }): void {
    document.documentElement.lang = current === 'zh' ? 'zh-TW' : 'en';
    applyDom();
    if (toggle !== undefined) mountLangToggle(toggle);
}
