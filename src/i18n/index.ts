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

// 匯出給 webpack 在 build 時取用：把靜態 HTML 會用到的中文字串內聯進頁面，
// 避免使用者要等 bundle 執行才從英文換成中文（見 webpack.config.js 的 i18nBoot）。
export const DICT: Record<string, Entry> = {
    // ---- 文件標題 ----
    'title.home': { en: 'Eric Wu | Interactive 3D & Frontend Demos', zh: 'Eric Wu | 互動 3D 與前端 Demo' },
    'title.hub': { en: 'PixiJS Experiments | Eric Wu', zh: 'PixiJS 實驗場 | Eric Wu' },
    'title.configurator': { en: 'Product Configurator', zh: '產品配置器' },
    'title.rwd': { en: 'RWD Showcase | Eric Wu', zh: 'RWD 響應式展示 | Eric Wu' },
    'title.shaderLab': { en: 'Shader Lab | Eric Wu', zh: 'Shader Lab | Eric Wu' },
    'title.arcade': { en: 'Arcade | Eric Wu', zh: '遊樂場 | Eric Wu' },

    // ---- 導覽 ----
    'nav.back': { en: '← Back', zh: '← 返回' },
    'nav.backHome': { en: '← Back to Home', zh: '← 返回首頁' },
    'nav.backPark': { en: '← Cloud Park', zh: '← 返回雲朵樂園' },
    'nav.backHub': { en: '← PixiJS Experiments', zh: '← PixiJS 實驗場' },
    'nav.backFindings': { en: '← Findings', zh: '← 實驗結論' },

    // ---- 首頁 ----
    'home.role': { en: 'Frontend Engineer · 3D / High-Interaction / Complex Web Apps', zh: '前端工程師 · 3D / 高互動 / 複雜 Web 應用' },
    // 刻意寫成「說明書口吻」而不是宣言：每一句都能當場攤開 source 佐證——
    // 這頁確實是 Pixi 畫的、水面與漣漪的 shader 在 home/graph/field.ts、
    // 線的兩級分法在 home/projects.ts 的 EdgeKind。寫得漂亮但答不出來的話不要寫。
    'home.tagline': {
        en: 'Frontend engineer, 3D and high-interaction web. This page is a render graph I drew with PixiJS and my own shaders — the nodes are projects, the lines are what they actually share in the source.',
        zh: '前端工程師，做 3D 與高互動的 Web。這頁是我用 PixiJS 和自己寫的 shader 畫的 render graph——節點是專案，線是它們在原始碼裡真正共用的東西。',
    },
    // 小螢幕的短版：完整版在 390 寬要排到 7 行，最後兩行會壓在節點上。
    // 砍掉的是「怎麼讀這張圖」那半句——那件事左下的圖例本來就會講一次。
    'home.tagline.short': {
        en: 'Frontend engineer, 3D and high-interaction web. This page is a render graph I drew with PixiJS and my own shaders.',
        zh: '前端工程師，做 3D 與高互動的 Web。這頁是我用 PixiJS 和自己寫的 shader 畫的 render graph。',
    },
    'home.tech.title': { en: 'Tech stack', zh: '技術棧' },
    'home.tech.render': { en: 'Rendering', zh: '渲染引擎' },
    'home.tech.shader': { en: 'Shaders', zh: '著色器' },
    'home.tech.frontend': { en: 'Frontend', zh: '前端' },
    'home.tech.bench': { en: 'Measurement', zh: '量測' },
    // 「共用」分兩級，因為被問到「共用什麼？」時兩者的答案完全不同（見 projects.ts 的 EdgeKind）：
    // 實線＝兩端 import 同一個我寫的模組（有東西在流動），虛線＝各自 import 同一個第三方函式庫。
    'home.legend.module': { en: 'both ends import the same module I wrote', zh: '兩端 import 同一個我寫的模組' },
    'home.legend.library': { en: 'built on the same library, no shared code', zh: '建構在同一個函式庫上，沒有共用程式碼' },
    'home.legend.wraps': { en: 'RWD wraps every page', zh: 'RWD 包住站內每一頁' },
    // 全站共用的模組畫不成線——每個 entry 都 import，畫出來會變成節點兩兩相連的完全圖。
    'home.legend.shell': { en: 'shell · i18n are imported by every page', zh: 'shell · i18n 每一頁都 import' },
    'home.hint': { en: 'Hover a pass to inspect · click to enter', zh: '滑過節點看細節 · 點擊進入' },
    'home.crossEngine.title': { en: 'Cross-Engine Rendering', zh: '跨引擎渲染' },
    'home.crossEngine.desc': {
        en: 'A glass tray you tilt with the mouse; the balls and blocks inside slide around. What I wanted to try was whether two rendering engines can share one canvas. The usual approach is to stack two of them — here the 3D scene and the 2D interface share the same one, so the numbers in the HUD and the collisions they describe are always from the same frame.',
        zh: '一個可以用滑鼠傾斜的玻璃托盤，裡面的球和方塊會滾來滾去。想試的是兩個繪圖引擎能不能共用同一塊畫布。一般做法是各開一個疊起來，這裡 3D 場景和 2D 介面共用同一個，所以 HUD 的數字跟球的碰撞永遠是同一幀。',
    },
    'home.configurator.title': { en: '3D Product Configurator', zh: '3D 產品配置器' },
    'home.configurator.desc': {
        en: 'A shoe you configure yourself: swap materials and colours, adjust the studio lighting, watch it update as you go. This is the most common real use for 3D on the web — letting a shopper see the exact one they want before they buy it.',
        zh: '一雙可以自己配的鞋：換材質、換顏色、調棚拍打光，即時看結果。這是 3D 最常見的實際用途——電商讓客人先看到自己要的那一款長什麼樣。',
    },
    'home.lab.title': { en: 'Rendering Findings', zh: '渲染效能實測結論' },
    'home.lab.desc': {
        en: 'A performance report you can re-run yourself on the page. It started with the line "fewer draw calls is faster" — I wanted to know whether that actually holds. What came out: the same draw call count, 6.5× the CPU cost.',
        zh: '一份可以自己在頁面上重跑的效能報告。起因是「draw call 越少越快」這句話——我想知道是不是真的。量出來是：同樣的 draw call 數，CPU 成本可以差 6.5 倍。',
    },
    'home.lab.foot': { en: 'Measured, not claimed', zh: '量出來的，不是講出來的' },
    'home.rwd.title': { en: 'RWD Showcase', zh: 'RWD 響應式展示' },
    'home.rwd.desc': {
        en: 'A device simulator built into the site: pick an iPhone, iPad or desktop and see any page of this site at that size, or drag it to whatever size you like. I built it because "it is responsive" is not something a sentence can prove — easier to let people drag it themselves.',
        zh: '站內建的裝置模擬器：挑 iPhone、iPad 或桌機，即時看本站每一頁在那個尺寸長什麼樣，也可以自己拖成任意大小。做這個是因為「有做 RWD」這句話沒辦法證明，不如讓人自己拉。',
    },
    'home.shader.title': { en: 'Shader Lab', zh: 'Shader Lab' },
    'home.shader.desc': {
        en: 'Three effects you can tune live — dissolve, water ripple, and a flag in the wind — with the shader source sitting next to them. I built it to work out how WebGL and WebGPU shaders actually differ, so each effect is written twice, once in each language, and the two outputs are compared to check they really match.',
        zh: '三個可以當場調參數的效果：溶解、水波、被風吹動的旗子，原始碼就攤在旁邊。做這個是想搞清楚 WebGL 跟 WebGPU 的 shader 差在哪，所以同一個效果兩種語言各寫一份，再比對輸出有沒有真的一樣。',
    },
    'home.shader.foot': { en: 'GLSL + WGSL, both written by hand', zh: 'GLSL + WGSL，兩份都自己寫' },
    'home.arcade.title': { en: 'Arcade', zh: '遊樂場' },
    'home.arcade.desc': {
        en: 'Explore a pastel Three.js theme park with a third-person character, rides, a live map and fast travel. Walk into the casino to discover the PixiJS arcade: slots, baccarat, video baccarat and roulette.',
        zh: '在 Three.js 製作的可愛 3D 遊樂園自由散步、搭乘設施、收集星星，用小地圖快速旅行。走進賭場，再進入 PixiJS 遊戲大廳，體驗老虎機、百家樂、視訊百家樂與輪盤。',
    },

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
    'rwd.page.arcade': { en: 'Arcade', zh: '遊樂場' },
    'rwd.page.park': { en: 'Cloud Park', zh: '3D 雲朵樂園' },

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
    'cfg.section.view': { en: 'View', zh: '機位' },
    'cfg.section.surface': { en: 'Surface Detail', zh: '表面細節' },
    // 兩個來源刻意標出「生成」與「掃描」的差別，這組對照本身就是這一段要講的事
    'cfg.surface.shader': { en: 'Shader', zh: 'Shader 生成' },
    'cfg.surface.texture': { en: 'Scanned', zh: '掃描貼圖' },
    'cfg.surface.preparing': { en: 'Preparing…', zh: '準備中…' },
    'cfg.surface.download': { en: 'Download', zh: '下載量' },
    'cfg.surface.prep': { en: 'First prep', zh: '首次準備' },
    // 這行是 hover 提示：424ms vs 12ms 的落差看起來很嚇人，但兩邊各自含著什麼要講清楚，
    // 否則會被讀成「程序生成慢 30 倍」——實際上 shader 那邊大半是一次性的編譯。
    'cfg.surface.prepHint': {
        en: 'Measured once per material. Shader includes GLSL compile; scanned includes download + decode.',
        zh: '每種材質只量一次。Shader 含 GLSL 編譯；掃描貼圖含下載與解碼。',
    },
    'cfg.surface.perFrame': { en: 'Per frame', zh: '每幀成本' },
    'cfg.surface.same': { en: 'identical', zh: '兩者相同' },
    'cfg.slider.tiling': { en: 'Tiling', zh: '紋理密度' },
    'cfg.slider.bump': { en: 'Bump', zh: '凹凸強度' },
    'cfg.view.hero': { en: 'Hero', zh: '主視角' },
    'cfg.view.side': { en: 'Side', zh: '側面' },
    'cfg.view.front': { en: 'Front', zh: '正面' },
    'cfg.view.top': { en: 'Top', zh: '俯視' },
    'cfg.view.detail': { en: 'Detail', zh: '近拍' },
    'cfg.slider.envInt': { en: 'Env Intensity', zh: '環境光強度' },
    'cfg.slider.envRot': { en: 'Env Rotation', zh: '環境旋轉' },
    'cfg.slider.keyInt': { en: 'Key Intensity', zh: '主光強度' },
    'cfg.slider.keyTemp': { en: 'Key Temp', zh: '主光色溫' },
    'cfg.btn.autorotate': { en: '◐ Auto-rotate', zh: '◐ 自動旋轉' },
    'cfg.btn.reset': { en: '⟲ Reset View', zh: '⟲ 重置視角' },
    'cfg.btn.share': { en: '🔗 Copy Link', zh: '🔗 複製連結' },
    'cfg.btn.copied': { en: '✓ Copied', zh: '✓ 已複製' },
    'cfg.btn.export': { en: '⤓ Export PNG', zh: '⤓ 匯出 PNG' },
    'cfg.btn.exporting': { en: '⤓ Rendering…', zh: '⤓ 匯出中…' },
    'cfg.loading': { en: 'Loading 3D model…', zh: '載入 3D 模型…' },
    'cfg.preset.soft': { en: 'Soft', zh: '柔光棚' },
    'cfg.preset.dramatic': { en: 'Dramatic', zh: '戲劇側光' },
    'cfg.preset.ecom': { en: 'E-com', zh: '電商白' },
    'cfg.bg.studio': { en: 'Studio', zh: 'Studio' },
    'cfg.bg.gradient': { en: 'Gradient', zh: '漸層' },
    'cfg.bg.dark': { en: 'Dark', zh: '深色' },
    'cfg.bg.white': { en: 'White', zh: '純白' },
    // finish / tint / 部件的名稱都由 materialConfigurator 以 key 的形式吐出來（不是現成的字），
    // 這裡是它們唯一的翻譯來源。「Original」在兩組裡意思不同：finish 的是「原始材質參數」，
    // tint 的是「不上色、保留貼圖原色」，所以分開兩個 key，中文才能各自講清楚。
    'cfg.finish.original': { en: 'Original', zh: '原始' },
    'cfg.finish.matte': { en: 'Matte', zh: '霧面' },
    'cfg.finish.leather': { en: 'Leather', zh: '皮革' },
    'cfg.finish.glossy': { en: 'Glossy', zh: '亮面' },
    'cfg.finish.metallic': { en: 'Metallic', zh: '金屬' },
    'cfg.tint.none': { en: 'Original', zh: '原色' },
    'cfg.tint.crimson': { en: 'Crimson', zh: '緋紅' },
    'cfg.tint.cobalt': { en: 'Cobalt', zh: '鈷藍' },
    'cfg.tint.forest': { en: 'Forest', zh: '森綠' },
    'cfg.tint.amber': { en: 'Amber', zh: '琥珀' },
    'cfg.tint.charcoal': { en: 'Charcoal', zh: '炭黑' },
    'cfg.tint.ivory': { en: 'Ivory', zh: '象牙白' },
    'cfg.part.whole': { en: 'Whole Shoe', zh: '整雙鞋' },
    'cfg.part.outsole': { en: 'Outsole', zh: '鞋底' },
    'cfg.part.midsole': { en: 'Midsole', zh: '中底' },
    'cfg.part.sole': { en: 'Sole', zh: '鞋底' },
    'cfg.part.lace': { en: 'Laces', zh: '鞋帶' },
    'cfg.part.tongue': { en: 'Tongue', zh: '鞋舌' },
    'cfg.part.upper': { en: 'Upper', zh: '鞋面' },
    'cfg.part.toe': { en: 'Toe', zh: '鞋頭' },
    'cfg.part.heel': { en: 'Heel', zh: '鞋跟' },
    'cfg.part.collar': { en: 'Collar', zh: '鞋口' },
    'cfg.part.logo': { en: 'Logo', zh: 'Logo' },
    // 通用材質部件（分件模型的材質名幾乎都用這些詞）
    'cfg.part.fabric': { en: 'Fabric', zh: '布料' },
    'cfg.part.wood': { en: 'Wood', zh: '木料' },
    'cfg.part.metal': { en: 'Metal', zh: '金屬' },
    'cfg.part.glass': { en: 'Glass', zh: '玻璃' },
    'cfg.part.plastic': { en: 'Plastic', zh: '塑膠' },
    'cfg.part.label': { en: 'Label', zh: '標籤' },
    'cfg.part.leather': { en: 'Leather', zh: '皮革' },
    'cfg.product.shoe': { en: 'Shoe', zh: '球鞋' },
    'cfg.product.chair': { en: 'Chair', zh: '單椅' },
    'cfg.section.product': { en: 'Product', zh: '產品' },
    'cfg.product.loading': { en: 'Loading model…', zh: '載入模型中…' },
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
    'shader.panel.backend': { en: 'Rendering backend', zh: '渲染後端' },
    'shader.panel.switchTo': { en: 'Switch backend (reloads the page)', zh: '切換後端（會重新載入頁面）' },
    'shader.panel.noWebgpu': {
        en: 'This browser has no WebGPU support — the page falls back to WebGL.',
        zh: '這個瀏覽器沒有 WebGPU 支援，頁面會退回 WebGL。',
    },

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
        zh: '每個像素從一次取樣變成三次。你花掉的是貼圖頻寬而不是 ALU——而頻寬正是行動裝置 GPU 最先耗盡的資源。隱晦的陷阱在預乘 alpha：三個取樣點落在不同位置、各自的 alpha 也不同，所以每個 channel 都得先除回自己的 alpha 再組合，最後用一個共用的 alpha 重新預乘。省掉這步，半透明邊緣會出現一圈「不是特效、是 bug」的色邊。',
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

    // ---- 遊樂場 ----
    'arcade.balance': { en: 'Balance', zh: '餘額' },
    'arcade.bet': { en: 'Bet', zh: '押注' },
    'arcade.win': { en: 'Last win', zh: '上一把' },
    'arcade.spin': { en: 'SPIN', zh: 'SPIN' },
    'arcade.spinning': { en: 'SPINNING…', zh: '轉動中…' },
    // 轉動中同一顆按鈕就是「停」。按下之後畫面不一定馬上停——落點可能還在路上，
    // 所以要有一個「停止中」讓玩家知道請求收到了，不然他會以為沒按到而狂點
    'arcade.stopSpin': { en: 'STOP', zh: '停止' },
    'arcade.stopping': { en: 'STOPPING…', zh: '停止中…' },
    'arcade.error.insufficient_balance': { en: 'Insufficient balance', zh: '餘額不足' },
    'arcade.error.invalid_bet': { en: 'Invalid bet', zh: '押注金額無效' },
    'arcade.error.bet_closed': { en: 'Betting is closed', zh: '已封盤，來不及了' },
    // 起轉演法：純表演，不影響結果。兩種轉法只差起轉前那 0.2 秒，講不清楚，要按過才知道
    'arcade.spinStyle': { en: 'Spin-up', zh: '起轉' },
    'arcade.style.direct': { en: 'Direct', zh: '直接' },
    'arcade.style.windup': { en: 'Wind-up', zh: '蓄力' },
    // 停軸順序：一樣是純表演。換順序不會換掉盤面，五格內容在收到封包當下就定了
    'arcade.stopOrder': { en: 'Stop order', zh: '停軸順序' },
    // 窄畫面把表演選項與說明收進抽屜的那一行（見 arcade/ui/Hud.tsx 的 OptionsDrawer）。
    // 用「更多」而不是「設定」：抽屜裡沒有任何會改變輸贏或會被記住的東西
    'arcade.moreOptions': { en: 'More', zh: '更多' },
    // 語言切換在牌桌上收進了那顆齒輪裡（見 games/baccarat/index.ts 的 menuSections）：
    // 桌上每一格都在跟「這一手要押多少」搶位置，而語言是一場只會按一次的東西
    'arcade.language': { en: 'Language', zh: '語言' },
    'arcade.order.left': { en: 'Left to right', zh: '由左到右' },
    'arcade.order.center': { en: 'Centre out', zh: '中間先停' },
    'arcade.order.random': { en: 'Random', zh: '隨機' },
    // 轉速：也是純表演。快速模式把時序與滑行距離一起壓（只壓時間會讓符號糊成一團），
    // 但五根軸仍然逐根停——那個「差一格就中了」的張力是這款玩法的重點，不能為了快而砍掉
    'arcade.tempo': { en: 'Speed', zh: '轉速' },
    'arcade.speed.normal': { en: 'Standard', zh: '標準' },
    'arcade.speed.turbo': { en: 'Turbo', zh: '快速' },
    // 自動轉動。沒有「無限」那一檔：無限自動只會讓分頁在背景默默跑到餘額見底
    'arcade.auto': { en: 'Auto', zh: '自動' },
    'arcade.auto.off': { en: 'Off', zh: '關' },
    /*
     * 四款玩法的說明，一律寫給要玩的人看。
     *
     * ⚠️ **這份字典是純文字，畫面上沒有 Markdown 渲染器。** Pixi 的 `Text` 與 DOM 的
     * `<p>` 都會把 `**粗體**` 原封不動地印出來——星號會直接出現在玩家眼前（踩過一次）。
     * 要強調就用「」括起來，或把重點寫到句首。註解裡可以用 Markdown，字典的值不行。
     *
     * ⚠️ **畫在畫布裡的中文長段落不要用半形空格**，中英文之間、數字與量詞之間都不要。
     * （DOM 那側不受影響——瀏覽器對中文的斷行是逐字的，那裡的空格照慣例留著就好。）
     *
     * 面板那段說明有 `wordWrap`，而 Pixi 是**先照空白切 token、整個 token 放不下才換行**，
     * 塞不進去的 token 只有比整行還寬時才會逐字切。中文整段沒有空格時它是一個超長 token，
     * 逐字排下來每一行都填滿；一旦中間插進一個空格，後半段就變成獨立 token，
     * 於是**上一行會空掉一大截**（「右上角 LIVE」後面整行留白就是這樣來的）。
     * 「賠 35 倍」則更明顯，會在行尾拆成「賠 35」跟「倍」兩行。
     *
     * 寫成「賠35倍」「右上角LIVE標籤」，或改用中文數字（「接近九」）就都不會。
     * 英文版照常用空格——它本來就是照單字斷行的。
     *
     * 這幾格原本放的是技術說明（自己餵 fMP4 給 MediaSource、球的軌跡是反解的…），
     * 那是寫給讀原始碼的人看的東西，而**打開齒輪選單的人想知道的是「這個怎麼玩、
     * 押這裡賠多少」**。技術那一份沒有刪，它搬到了 src/arcade/README.md——
     * 那裡本來就是它該在的地方，而且講得比一格面板能容納的多。
     *
     * 賠率與數字全部照實寫（老虎機 93% 的回報率也照寫）：**說明頁一旦有一個數字
     * 跟程式不符，其他每一個數字就都不能信了**。改 PAYOUTS 要回來改這裡。
     */
    'arcade.slot.help': {
        en: 'Five reels, three rows, five fixed paylines (top, middle, bottom and two zigzags) — your stake is split evenly across them. Three or more matching symbols counting from the leftmost reel pays, and longer runs pay far more. Wild substitutes for anything but Scatter. This machine is tuned to a 93% long-run return. The result comes from the server, which is why the button waits a moment.',
        zh: '五軸三列，五條固定賠付線（上、中、下與兩條折線），押注會平均分到五條線上。中獎要從最左邊那一軸算起，同一條線上連三格相同符號才算數，連得越長賠得越多。百搭可以替代除了散佈符號以外的任何一種。這台機的長期回報率配在93%。按下去會頓一下，是因為結果要等伺服器算完才送過來。',
    },
    'arcade.bac.help': {
        en: 'Bet on Player or Banker — whichever hand lands closer to nine. Tens and face cards count as zero and only the last digit of the total counts; whether a third card comes is fixed by the rules, nobody chooses. Player pays 1:1, Banker pays 0.95:1 (5% commission), and a tie returns both stakes. Side bets: Tie pays 8:1, either Pair pays 11:1.',
        zh: '押閒或押莊，比誰的點數接近九。10與花牌算0點，兩張相加只取個位數；要不要補第三張由固定規則決定，玩家沒有選擇權。閒贏賠1倍，莊贏賠0.95倍（抽5%水），和局時莊閒的注退還本金。另外可以押和（8倍）或對子（11倍）。',
    },
    'arcade.live.help': {
        en: 'Same game as Baccarat — the difference is that the cards are dealt on camera. Your video runs a little behind the table (the LIVE badge shows by how much), so what decides whether you can still bet is the countdown above the betting spots: that one comes from the server. The board beside the dealer shows his clock, and the two do not have to agree.',
        zh: '玩法跟百家樂完全一樣，差別在牌是荷官在鏡頭前發的。你的畫面會比桌上慢一點，右上角LIVE標籤顯示的就是慢幾秒；所以能不能下注要看注區上方那個倒數，那一份是伺服器給的。影片裡桌邊那塊牌子走的是荷官端的時間，兩者不一定同步。',
    },

    // ---- 百家樂 ----
    // 注區名稱。中文用單字是桌台慣例（桌面上位置有限，也讓路圖上的字跟注區對得起來）
    'arcade.bac.player': { en: 'Player', zh: '閒' },
    'arcade.bac.banker': { en: 'Banker', zh: '莊' },
    'arcade.bac.tie': { en: 'Tie', zh: '和' },
    'arcade.bac.playerPair': { en: 'P Pair', zh: '閒對' },
    'arcade.bac.bankerPair': { en: 'B Pair', zh: '莊對' },
    // 珠盤路格子裡的字。英文用單字母是國際牌桌的通用寫法
    'arcade.bac.short.player': { en: 'P', zh: '閒' },
    'arcade.bac.short.banker': { en: 'B', zh: '莊' },
    'arcade.bac.short.tie': { en: 'T', zh: '和' },
    'arcade.bac.chip': { en: 'Chip', zh: '籌碼' },
    'arcade.bac.actions': { en: 'Table', zh: '桌面' },
    'arcade.bac.repeat': { en: 'Repeat', zh: '重複下注' },
    'arcade.bac.totalBet': { en: 'This hand', zh: '本局押注' },

    // 多人桌的四個階段。桌子自己會跑，所以這幾個字是玩家判斷「現在能不能押」的唯一依據
    'arcade.bac.phase.betting': { en: 'Place your bets', zh: '下注中' },
    'arcade.bac.phase.dealing': { en: 'Dealing', zh: '開牌中' },
    'arcade.bac.phase.result': { en: 'Paying out', zh: '結算中' },
    'arcade.bac.phase.shuffle': { en: 'Shuffling', zh: '洗牌中' },
    'arcade.bac.phase.connecting': { en: 'Joining table', zh: '進桌中' },
    'arcade.bac.betClosed': { en: 'Betting is closed for this hand', zh: '這一局已經封盤了' },
    'arcade.bac.net': { en: 'Last hand', zh: '上一局' },
    'arcade.bac.shoe': { en: 'Shoe', zh: '牌靴' },
    // 籌碼設置：從十種面額裡挑手邊那五顆，收在右上角的「更多」裡。
    // 真實桌台的籌碼架就那麼大，你挑常用的放上去——全部攤出來反而找不到要的那顆
    'arcade.bac.chipSet': { en: 'Chip tray', zh: '籌碼設置' },
    'arcade.bac.chipSetHint': {
        en: 'Pick up to five denominations to keep at the table.',
        zh: '挑最多五種面額擺在桌邊，其餘收進池子裡。',
    },
    'arcade.error.no_bet': { en: 'Place a bet first', zh: '請先下注' },

    // ---- 大廳與資源核對 ----
    /*
     * 三張能玩的卡片，副標一律**用玩家的話講玩家會遇到的事**。
     *
     * 這幾行原本是規格表：「五軸三列 · 伺服器停軸」「五張路圖 · 八副牌靴」
     * 「真實視訊串流 · 延遲不到一秒」。那是寫給工程師看的——「伺服器停軸」講的是
     * 誰決定結果（重要，但那件事屬於 README 而不是大廳卡片），「延遲不到一秒」則是
     * 只有做過串流的人才知道好在哪。**站在大廳前面的人要的是「這款怎麼玩、跟隔壁
     * 那款差在哪」**，行話用博弈桌上通行的那套（百搭、路單、閒莊），不是技術名詞。
     *
     * 但通俗不等於吹噓：能寫的只有真的做出來的東西。所以老虎機不提免費遊戲
     * （Scatter 目前不觸發任何東西，見 games/slot/rules.ts 的 PAYOUTS），
     * 視訊桌台的荷官前面留著「模擬」兩個字——那是預錄的片子，不是真的有人在發牌。
     *
     * **英文那半邊有長度上限：27 個字元左右。** 卡片在 390 寬的手機上只有 113px，
     * 超過就會被 fitText 壓字級（見 lobby/rail.ts）。第一版寫成
     * 'Simulated live dealer · dealt on camera'，39 個字元，在手機上被壓到 5.67px——
     * 那已經不是「小字」是「看不到的字」。中文一個字抵兩個字元，所以中文那半邊
     * 十一個字就是同一條線。
     */
    'arcade.lobby.slot': { en: 'Slot', zh: '老虎機' },
    'arcade.lobby.slotDesc': { en: 'Classic 777 · wild reels', zh: '經典 777 · 五線百搭' },
    'arcade.lobby.baccarat': { en: 'Baccarat', zh: '百家樂' },
    'arcade.lobby.baccaratDesc': { en: 'Player vs banker · roadmaps', zh: '閒莊對決 · 五張路單' },
    'arcade.lobby.baccaratLive': { en: 'Live Baccarat', zh: '視訊百家樂' },
    'arcade.lobby.baccaratLiveDesc': { en: 'Simulated dealer · on video', zh: '模擬真人荷官 · 視訊發牌' },

    // 視訊桌台
    'arcade.live.source': { en: 'Feed', zh: '線路' },
    // 更多選單裡串流讀數那一區的標題。不能跟線路切換共用 'Feed'——兩區疊在一起時
    // 會出現兩個一模一樣的標題，看起來像同一區被畫了兩次
    'arcade.live.stream': { en: 'Stream', zh: '串流' },
    'arcade.live.sourceDealer': { en: 'Dealer', zh: '荷官桌' },
    'arcade.live.sourcePublic': { en: 'Public live', zh: '公開直播' },
    'arcade.live.latency': { en: 'Latency', zh: '延遲' },
    'arcade.live.buffered': { en: 'Buffer', zh: '緩衝' },
    'arcade.live.rate': { en: 'Rate', zh: '倍速' },
    'arcade.live.stalls': { en: 'Stalls', zh: '卡頓' },
    'arcade.live.statusLoading': { en: 'connecting…', zh: '連線中…' },
    'arcade.live.statusStalled': { en: 'buffering…', zh: '緩衝中…' },
    'arcade.live.statusFailed': { en: 'feed unavailable', zh: '線路中斷' },

    // 視訊桌台自己的階段字。跟數位桌台分開一組是因為它少了換靴、多了收牌——
    // 那兩段的差別正是「牌是誰在處理」：一邊是程式換一副新牌，一邊是有人把牌收走
    'arcade.live.phase.betting': { en: 'Place your bets', zh: '下注中' },
    'arcade.live.phase.dealing': { en: 'Dealing', zh: '開牌中' },
    'arcade.live.phase.result': { en: 'Paying out', zh: '結算中' },
    'arcade.live.phase.clearing': { en: 'Clearing table', zh: '收牌中' },

    // 延遲吃掉下注時間的兩句提示。`{s}` 由呼叫端換成秒數——
    // 下注期間講「你少了幾秒」，截止之後講「你看到的那段已經過去了」
    'arcade.live.lagAhead': {
        en: 'your feed is {s}s behind',
        zh: '你的畫面慢 {s} 秒',
    },
    'arcade.live.lagLocked': {
        en: 'Feed is {s}s behind — betting already closed',
        zh: '畫面落後 {s} 秒，已停止下注',
    },
    // ---- 輪盤 ----
    'arcade.lobby.rouletteDesc': { en: 'Bet the layout · 35:1 top', zh: '押滿桌布 · 最高 35 倍' },

    // 三個階段。`spinning` 用真桌荷官喊的那句話——那是全世界的輪盤桌都聽得懂的一句
    'arcade.rou.phase.betting': { en: 'Place your bets', zh: '下注中' },
    'arcade.rou.phase.spinning': { en: 'No more bets', zh: '停止下注' },
    'arcade.rou.phase.result': { en: 'Paying out', zh: '結算中' },

    // 桌布上的外注。紅與黑不在這裡——那兩格畫的是菱形色塊，是這張桌上唯一不必翻譯的注
    'arcade.rou.dozen1': { en: '1st 12', zh: '第一打' },
    'arcade.rou.dozen2': { en: '2nd 12', zh: '第二打' },
    'arcade.rou.dozen3': { en: '3rd 12', zh: '第三打' },
    'arcade.rou.even': { en: 'EVEN', zh: '雙' },
    'arcade.rou.odd': { en: 'ODD', zh: '單' },
    // 比例條的標籤（桌布上那兩格寫的是 1-18／19-36，數字不必翻譯）
    'arcade.rou.low': { en: 'LOW', zh: '小' },
    'arcade.rou.high': { en: 'HIGH', zh: '大' },
    'arcade.rou.red': { en: 'RED', zh: '紅' },
    'arcade.rou.black': { en: 'BLACK', zh: '黑' },
    'arcade.rou.recent': { en: 'Recent numbers', zh: '最近開出' },
    'arcade.rou.noHistory': { en: 'Waiting for the first spin', zh: '等這張桌開出第一局' },

    'arcade.rou.round': { en: 'Round', zh: '局號' },
    'arcade.rou.table': { en: 'Table', zh: '桌台' },
    // 齒輪選單裡玩法說明那一區的標題，四款共用
    'arcade.howToPlay': { en: 'How to play', zh: '玩法說明' },
    'arcade.rou.wheelType': { en: 'Wheel', zh: '輪盤' },
    'arcade.rou.european': { en: 'European · single 0', zh: '歐式 · 單零' },
    'arcade.rou.edge': { en: 'House edge', zh: '莊家優勢' },
    'arcade.rou.maxPayout': { en: 'Top payout', zh: '最高賠率' },
    'arcade.rou.help': {
        en: 'Bet on which pocket the ball drops into. Thirty-seven of them: 1 to 36 plus a green zero. Inside the number grid, position is the bet — dead centre of a number is a straight-up (35:1), on the line between two numbers is a split (17:1), on the point where four meet is a corner (8:1). Hover first and the covered numbers light up. The two rows below are outside bets: red/black, odd/even and high/low pay 1:1, dozens and columns pay 2:1. When zero comes up every outside bet loses — that single pocket is the whole house edge.',
        zh: '押球會停在哪一格。轉盤上有37格：1到36，加一個綠色的零。中間那片號碼格是「位置決定注別」——籌碼壓在格子正中央是直注，賠35倍；壓在兩格之間的線上是分注，賠17倍；壓在四格交會的那個點是角注，賠8倍。滑過去會先亮出你押到哪幾格。下面兩排是外注：紅黑、單雙、大小賠1倍，十二數與縱列賠2倍。開出零的時候外注全部落空，莊家的優勢就只在這一格。',
    },

    // 還沒做的那幾款。名字用真實桌台的叫法，因為它們是接下來要做的東西，不是佔位的假名
    'arcade.lobby.dragontiger': { en: 'Dragon Tiger', zh: '龍虎' },
    'arcade.lobby.sicbo': { en: 'Sic Bo', zh: '骰寶' },
    'arcade.lobby.roulette': { en: 'Roulette', zh: '輪盤' },
    'arcade.lobby.ox28': { en: 'Ox 28', zh: '二八槓' },
    'arcade.lobby.paigow': { en: 'Pai Gow', zh: '牌九' },
    'arcade.lobby.goldenflower': { en: 'Golden Flower', zh: '炸金花' },
    'arcade.lobby.sangong': { en: 'San Gong', zh: '三公' },
    'arcade.lobby.fruit': { en: 'Fruit Slot', zh: '水果盤' },
    'arcade.lobby.soon': { en: 'SOON', zh: '規劃中' },
    'arcade.lobby.soonDesc': { en: 'Not built yet', zh: '尚未實作' },
    'arcade.lobby.badge.hot': { en: 'HOT', zh: '熱門' },
    'arcade.lobby.badge.new': { en: 'NEW', zh: '新上架' },
    'arcade.lobby.categories': { en: 'Game categories', zh: '遊戲分類' },
    'arcade.lobby.tab.all': { en: 'All', zh: '全部' },
    'arcade.lobby.tab.electronic': { en: 'Slots', zh: '電子' },
    'arcade.lobby.tab.table': { en: 'Table', zh: '桌台' },
    'arcade.lobby.tab.card': { en: 'Cards', zh: '棋牌' },
    'arcade.notice.comingSoon': { en: 'Not built yet — on the roadmap', zh: '這款還在規劃中，敬請期待' },
    'arcade.backLobby': { en: '← Lobby', zh: '← 大廳' },

    // 營運後台的入口。放在遊樂場這一頁是因為兩者要**同時開著**才看得出重點：
    // 後台改一個限紅，這一頁下一次下注就會被擋，中間不必重整。
    'arcade.adminLink': { en: 'Back Office ↗', zh: '營運後台 ↗' },

    // ---- 活動 banner ----
    // 版面照真實大廳做（那個位置就是放廣告的），但**活動是假的**：沒有優惠、沒有東西可以領。
    // 所以每張都掛著 DEMO 角標，頁腳也寫了一行。作品集裡放看起來像真的促銷而不標明，
    // 是會被誤讀的那種東西（見 arcade.foot.demo）。
    'arcade.promo.cta': { en: 'View', zh: '看看' },
    'arcade.promo.topup.kicker': { en: 'FIRST DEPOSIT', zh: '首儲加碼' },
    'arcade.promo.topup.headline': { en: '100%', zh: '100%' },
    'arcade.promo.topup.sub': { en: 'Matched on your first top-up', zh: '首次儲值等額回饋' },
    'arcade.promo.rakeback.kicker': { en: 'WEEKLY', zh: '每週結算' },
    'arcade.promo.rakeback.headline': { en: '1.2%', zh: '1.2%' },
    'arcade.promo.rakeback.sub': { en: 'Rakeback, paid every Monday', zh: '週週返水，逢週一入帳' },
    'arcade.promo.newgame.kicker': { en: 'NEW TABLE', zh: '新機台' },
    'arcade.promo.newgame.headline': { en: 'Baccarat', zh: '百家樂' },
    'arcade.promo.newgame.sub': { en: 'Five roadmaps, now live', zh: '五張路圖，現已上線' },

    // ---- 頁腳 ----
    'arcade.foot.service': { en: 'Support', zh: '客服' },
    'arcade.foot.news': { en: 'News', zh: '公告' },
    'arcade.foot.campaign': { en: 'Events', zh: '活動' },
    'arcade.foot.demo': {
        en: 'Portfolio demo. The promos are mock-ups — nothing here is a real service, and no money of any kind is involved.',
        zh: '作品集展示。活動內容為模擬視覺，本頁非真實服務，不涉及任何金流。',
    },
    // 資源核對：這一頁在架構上想證明的事就是這一塊，所以它一直掛在畫面上。
    // 收合時只講結論，數字與解釋要點開才出現——一串沒有標題的數字等於沒做（見 ui/TopBar.tsx）
    'arcade.meter.title': { en: 'GPU audit', zh: '資源核對' },
    'arcade.meter.clean': { en: 'no leaks', zh: '零洩漏' },
    'arcade.meter.dirty': { en: 'leaking', zh: '有洩漏' },
    'arcade.meter.idle': { en: 'idle', zh: '待機' },
    'arcade.meter.idleHint': {
        en: 'Enter a game and come back — the audit runs when a scene is unloaded.',
        zh: '進一款遊戲再回來，這裡就會顯示那個場景卸載後的核對結果。',
    },
    'arcade.meter.cachedHint': {
        en: 'The increase is the shared font atlas — global on purpose, and correctly never returned. A real leak climbs on every single visit to the same scene.',
        zh: '這次的增加是共用的字體 atlas——那是刻意全域的，本來就不該還。真的漏會在同一個場景每進出一次就漲一階，永遠停不下來。',
    },
    'arcade.meter.label': { en: 'tracked', zh: '登記資源' },
    'arcade.meter.leaked': { en: 'leaked', zh: '未回收' },
    'arcade.meter.texture': { en: 'GPU textures', zh: 'GPU 貼圖' },
    'arcade.meter.hint': {
        en: 'Resources the last module registered, how many were still alive after unmount, and the renderer’s texture-source count compared with the previous time that same scene was unloaded. A one-off increase is the shared font atlas, which is global on purpose; a leak would climb on every single visit.',
        zh: '上一個模組登記了幾個資源、卸載後還有幾個沒回收，以及 renderer 的 texture source 數對照「同一個場景上一次」的值。一次性的增加是共用的字體 atlas（那是刻意全域的）；真的漏會每進出一次就漲一階。',
    },
};

const STORAGE_KEY = 'site-lang';
const listeners = new Set<(l: Lang) => void>();
let current: Lang = readLang();

/**
 * 語言判定：使用者選過就照他的選擇，沒選過則跟隨系統語言（zh-TW / zh-CN… 一律視為中文）。
 * webpack 的 i18nHead / i18nBoot 內聯腳本必須用同一套判定，否則會先畫錯語言再換一次。
 */
function readLang(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'zh') return v;
    } catch { /* localStorage 不可用時往下走系統語言 */ }
    try {
        if (/^zh/i.test(navigator.language || '')) return 'zh';
    } catch { /* navigator 不可用就退回英文 */ }
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
        // 吃變數＋fallback：只有把 --lang-* 設起來的頁（首頁會隨天色翻面）才會變，
        // 其餘各頁沒設變數就落回原本這組深色，不必逐頁改
        background: 'var(--lang-bg, rgba(0,0,0,0.35))',
        border: '1px solid var(--lang-border, rgba(255,255,255,0.12))',
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
            fontSize: '13px', background: 'transparent',
            color: 'var(--lang-muted, #a1a1aa)', transition: 'all 0.15s',
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
            // 中性配色：新首頁與各舊頁的深色背景都合用（原本寫死 cyan 只配舊主題）
            b.style.background = active ? 'var(--lang-active, rgba(255,255,255,0.16))' : 'transparent';
            b.style.color = active ? 'var(--lang-fg, #f4f4f5)' : 'var(--lang-muted, #a1a1aa)';
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

    // 在專案頁切換語言後按返回，首頁是從 bfcache 還原的：DOM 與這個模組的 current
    // 都停在離開前的狀態，不會反映剛剛的選擇。還原時重讀一次 storage，有變才套用
    // （setLang 會一併更新 <html lang>、靜態 DOM 與所有 onLangChange 監聽者，
    // 例如首頁 Pixi 的節點標籤與語言切換鈕的選中狀態）。
    window.addEventListener('pageshow', () => {
        const stored = readLang();
        if (stored !== current) setLang(stored);
    });
}
