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

    // ---- 導覽 ----
    'nav.back': { en: '← Back', zh: '← 返回' },
    'nav.backHome': { en: '← Back to Home', zh: '← 返回首頁' },

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
        en: 'Babylon.js 3D product viewer: real-time material variants (glTF KHR_materials_variants), PBR + IBL studio lighting, soft shadows, post-processing, and turntable orbit controls.',
        zh: 'Babylon.js 3D 產品檢視器：即時材質變體（glTF KHR_materials_variants）、PBR + IBL 棚拍打光、柔和陰影、後製，與轉盤式 orbit 控制。',
    },
    'home.configurator.cta': { en: 'Configure →', zh: '進入配置 →' },
    'home.lab.title': { en: 'Rendering Performance Lab', zh: '渲染效能實驗室' },
    'home.lab.desc': {
        en: 'PixiJS v8 rendering optimization & stress testing — measuring FPS and draw calls under heavy sprite / particle loads.',
        zh: 'PixiJS v8 渲染最佳化與壓力測試 — 在大量 sprite / 粒子負載下量測 FPS 與 draw call。',
    },
    'home.lab.cta': { en: 'Explore →', zh: '探索 →' },

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
