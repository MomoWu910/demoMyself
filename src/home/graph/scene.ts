import { Application, Container, Graphics, Sprite, Text, Texture, TextStyle } from 'pixi.js';
import { EDGES, NODES, nodeById, type ProjectNode, type Tone } from '../projects';
import { useHomeStore, homeState, type Backend } from '../store';
import { createFieldFilter } from './field';
import { applyTheme, currentHour, foregroundFor, onSkyChange, onThemeChange, refreshSky, skyAt } from './sky';
import { enterProject, ENTER_MS } from '../enter';
import { t, onLangChange } from '../../i18n';

/**
 * 前景色不再是常數——天亮時整套翻成深字淺底（見 sky.ts 的 applyTheme）。
 * 這裡放的是「目前這一套」，主題翻面時整份換掉並重畫 canvas 上的東西。
 * canvas 裡的 Pixi 物件吃不到 CSS 變數，所以 sky.ts 得另外供一份數字色。
 */
let FG = foregroundFor(false);

/** canvas 上的文字也要那圈反色暈（見 sky.ts 的 halo）。distance 0 = 均勻外光暈，不是投影。 */
const halo = () => ({ color: FG.halo, alpha: 0.85, blur: FG.haloBlur, distance: 0, angle: 0 });
/** tone → 代表色（琥珀=GLSL/WebGL，紫=WGSL/WebGPU，藍=Pixi，灰=中性；亮版全部壓暗） */
let TONE: Record<Tone, number> = FG.tone;

/**
 * 節點漂浮的幅度。吃的是波的能量包絡（見 field.ts 的 WaterSample），遠端節點被波掃到時
 * 能量大約 0.25，所以這組係數換算出來是幾個像素、約 2 度——節點是導覽目標，晃太大會讓
 * 點擊變難、標籤文字晃久了也累，讀得出來就夠。
 */
const FLOAT_SHIFT = 0.025; // 位移 ×短邊
const FLOAT_TILT = 0.12; // 傾斜（弧度）
const FLOAT_LIFT = 0.1; // 浮起 → 縮放

interface NodeView {
    def: ProjectNode;
    container: Container;
    ring: Graphics;
    glyph: Text;
    label: Text;
    px: number;
    py: number;
    pr: number;
    /** 漂浮造成的位移（像素）。邊也讀這個，連線才不會跟節點脫開 */
    ox: number;
    oy: number;
    active: boolean; // 只在這個值變動時才重畫節點幾何，不必每幀
}

/** 二次貝茲取點——邊畫成微彎的弧，比直線有機。 */
function bezier(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number) {
    const mt = 1 - t;
    return {
        x: mt * mt * ax + 2 * mt * t * cx + t * t * bx,
        y: mt * mt * ay + 2 * mt * t * cy + t * t * by,
    };
}

/** [0..1]×3 → Pixi 吃的 0xRRGGBB */
function packRGB(c: readonly number[]): number {
    return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

export async function mountGraph(container: HTMLElement): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    // ---- 天色：所有顏色的起點，得在建任何東西之前定案 ----
    // 節點、標籤的色是在建構時就寫進 TextStyle 的，晚一步定天色會先用錯的色畫一次再翻面。
    const sky = skyAt(currentHour());
    FG = foregroundFor(sky.light);
    TONE = FG.tone;
    applyTheme(sky.light);

    const app = new Application();
    await app.init({
        // canvas 的底色＝水體色。它幾乎立刻被 bg sprite 蓋住，但第一幀還沒畫完的那一瞬看得到，
        // 用深墨會在白天閃一下黑
        background: packRGB(sky.water),
        resizeTo: container,
        preference,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
    });
    container.appendChild(app.canvas);
    (globalThis as any).__PIXI_APP__ = app;

    // 省電：全螢幕 shader 光場若在 120fps × retina 下永不停跑，會讓裝置發燙耗電。
    // 環境背景不需要那麼多幀——上限 30fps；尊重 reduce-motion 就幾乎凍結；分頁切走就停。
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    app.ticker.maxFPS = reduceMotion ? 8 : 30;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) app.ticker.stop();
        else app.ticker.start();
    });

    const backend: Backend = (app.renderer as any).gl ? 'webgl' : 'webgpu';
    (globalThis as any).__BACKEND__ = backend;
    useHomeStore.getState().setBackend(backend);

    // 讓 Pixi 的 Text 拿得到 Google Fonts 載入的 Archivo / JetBrains Mono
    try {
        await (document as any).fonts?.ready;
    } catch {
        /* 沒有 Font Loading API 就算了，會退回系統字 */
    }

    // ---- 背景光場 ----
    const bg = new Sprite(Texture.WHITE);
    const field = createFieldFilter();
    field.setSky(sky);
    bg.filters = [field.filter];

    // 之後的天色變更都從 sky.ts 廣播過來——ticker 每分鐘的例行重查，以及使用者撥動時刻軸。
    // 撥動要能即時反應，所以不能只靠 ticker 自己查。
    onSkyChange((p) => {
        field.setSky(p);
        app.renderer.background.color = packRGB(p.water);
    });
    app.stage.addChild(bg);

    // ---- 邊層（每幀重畫，讓資源封包會流動）＋ 標籤層 ----
    const edgeGfx = new Graphics();
    const edgeLabelLayer = new Container();
    app.stage.addChild(edgeGfx, edgeLabelLayer);

    const edgeLabels = EDGES.filter((e) => !e.meta).map((e) => {
        const label = new Text({
            text: e.resource,
            style: new TextStyle({
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 11,
                fill: TONE[e.tone],
                letterSpacing: 0.5,
                dropShadow: halo(),
            }),
        });
        label.anchor.set(0.5);
        label.alpha = 0.7;
        edgeLabelLayer.addChild(label);
        return { edge: e, label };
    });

    // ---- 節點層 ----
    const nodeLayer = new Container();
    app.stage.addChild(nodeLayer);

    const nodeViews = new Map<string, NodeView>();
    for (const def of NODES) {
        const c = new Container();
        c.eventMode = 'static';
        c.cursor = 'pointer';

        const ring = new Graphics();

        const glyph = new Text({
            text: def.glyph,
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: 26,
                fontWeight: '700',
                fill: FG.glyph,
            }),
        });
        glyph.anchor.set(0.5);

        const label = new Text({
            text: t(`${def.i18nKey}.title`),
            style: new TextStyle({
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 12,
                fill: FG.label,
                letterSpacing: 0.6,
                dropShadow: halo(),
            }),
        });
        label.anchor.set(0.5, 0);

        c.addChild(ring, glyph, label);
        nodeLayer.addChild(c);

        c.on('pointerover', () => {
            useHomeStore.getState().setActive(def.id);
            // 滑過＝手指碰到水面。這是現在**唯一**的漣漪來源：畫面上每一次晃動都對應使用者剛做的動作，
            // 沒有背景自己在動的東西。source 記著是誰打的，它自己就不會被這發推。
            const v = nodeViews.get(def.id);
            if (v && !reduceMotion) {
                field.emit({ ...dropAt(v), strength: 0.9, speed: 1.4, freq: 1.5, source: def.id });
            }
        });
        c.on('pointerout', () => {
            if (homeState().activeId === def.id) useHomeStore.getState().setActive(null);
        });
        c.on('pointertap', () => {
            // 進場＝整潭水被打了一記：又快又疏的大波，跟著純色圓一起把畫面推開
            const v = nodeViews.get(def.id);
            if (v && !reduceMotion) {
                field.emit({ ...dropAt(v), strength: 2.6, speed: 5.0, freq: 0.45, source: def.id });
            }
            enterProject(def.id);
        });

        nodeViews.set(def.id, {
            def,
            container: c,
            ring,
            glyph,
            label,
            px: 0,
            py: 0,
            pr: 0,
            ox: 0,
            oy: 0,
            active: false,
        });
    }

    /** 節點在水面上的正規化落點（0..1）。漣漪吃的是這套座標，不是像素。 */
    const dropAt = (v: NodeView): { x: number; y: number } => ({ x: v.px / W, y: v.py / H });

    // ---- 轉場層：點擊節點時，一團該節點顏色的圓從它身上長滿全螢幕 ----
    const fxLayer = new Graphics();
    app.stage.addChild(fxLayer);

    // ---- 版面：正規化座標 → 螢幕像素 ----
    let W = 0;
    let H = 0;
    let short = 0;
    let narrow = false;
    const layout = (): void => {
        W = app.screen.width;
        H = app.screen.height;
        short = Math.min(W, H);
        narrow = W < 520; // 窄手機換成直式 zig-zag 排版
        bg.width = W;
        bg.height = H;
        field.setAspect(W / H);

        for (const v of nodeViews.values()) {
            const pos = narrow ? v.def.narrow : v.def;
            v.px = pos.x * W;
            v.py = pos.y * H;
            v.pr = pos.r * short;
            v.container.position.set(v.px, v.py);
            v.glyph.style.fontSize = Math.round(Math.max(18, v.pr * 0.42)); // glyph 隨節點大小縮放
            v.label.position.set(0, v.pr + 12);
            v.active = false;
            drawNode(v, false);
        }

        // 版面一動，還在擴散的漣漪就對不上新的節點位置了——清掉重來
        field.clearDrops();
        for (const v of nodeViews.values()) {
            v.ox = 0;
            v.oy = 0;
            v.container.rotation = 0;
        }
    };

    const drawNode = (v: NodeView, active: boolean): void => {
        const r = v.pr;
        v.ring.clear();

        const dual = v.def.tone === 'dual';
        const base = TONE[v.def.tone];

        // 節點核心：一片玻璃。夜裡是深色、白天翻成淺色，才一直襯得住上面的 glyph
        v.ring.circle(0, 0, r).fill({ color: FG.core, alpha: 0.92 });

        // 邊環：dual 節點畫成琥珀/紫兩半弧，其餘單色
        const ringW = active ? 3 : 2;
        if (dual) {
            // 先 moveTo 到弧的起點，否則 arc() 會從路徑預設起點 (0,0) 拉一條線到弧起點——
            // 那就是節點中央到頂端那條多餘的垂直線。
            v.ring.moveTo(0, -r).arc(0, 0, r, -Math.PI / 2, Math.PI / 2).stroke({ color: TONE.glsl, width: ringW, alpha: active ? 1 : 0.85 });
            v.ring.moveTo(0, r).arc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2).stroke({ color: TONE.wgsl, width: ringW, alpha: active ? 1 : 0.85 });
        } else {
            v.ring.circle(0, 0, r).stroke({ color: base, width: ringW, alpha: active ? 1 : 0.7 });
        }
    };

    layout();
    app.renderer.on('resize', layout);

    // 天色翻面：背景是連續變的，前景則是整套跳過去（理由見 sky.ts 的 applyTheme）。
    // CSS 那半邊靠變數 + transition 自己接手，這裡只管 canvas 裡吃不到 CSS 的東西。
    onThemeChange((light) => {
        FG = foregroundFor(light);
        TONE = FG.tone;
        for (const v of nodeViews.values()) {
            v.glyph.style.fill = FG.glyph;
            v.label.style.fill = FG.label;
            v.label.style.dropShadow = halo();
            drawNode(v, v.active);
        }
        for (const { edge, label } of edgeLabels) {
            label.style.fill = TONE[edge.tone];
            label.style.dropShadow = halo();
        }
    });

    // ---- 動畫迴圈 ----
    let elapsed = 0;
    let enterStart = -1;
    let lastSkyCheck = 0;
    app.ticker.add(({ deltaMS }) => {
        elapsed += deltaMS / 1000;

        // 天色每分鐘對一次時鐘就夠。一天的色差攤到 1440 分鐘，單步的跳動遠在肉眼之下——
        // 逐幀重算是白花錢（每次要跑一輪 keyframe 查表 + 四次色彩插值）。
        if (elapsed - lastSkyCheck > 60) {
            lastSkyCheck = elapsed;
            refreshSky(); // 套用與廣播都在裡面（使用者撥過時刻軸的話，這裡拿到的仍是他撥的值）
        }
        // reduce-motion：凍結環境動畫（光場/呼吸/資源流動），ticker 仍以低幀跑著只為 hover 反應
        const anim = reduceMotion ? 0 : elapsed;
        field.setTime(anim);

        const enteringId = homeState().enteringId;
        if (enteringId) {
            if (enterStart < 0) enterStart = elapsed;
            const v = nodeViews.get(enteringId)!;
            const p = Math.min((elapsed - enterStart) / (ENTER_MS / 1000), 1);
            const ease = p * p * (3 - 2 * p);
            const r = v.pr + ease * Math.hypot(W, H) * 1.2;
            fxLayer.clear();
            fxLayer.circle(v.px, v.py, r).fill({ color: TONE[v.def.tone], alpha: Math.min(1, 0.35 + ease) });
            return; // 轉場中就不必再更新底下的圖了
        } else if (enterStart >= 0) {
            // 轉場結束（多半是按返回、bfcache 把首頁還原到轉場最後一幀）：清掉那片純色覆蓋、回正常
            enterStart = -1;
            fxLayer.clear();
        }

        const activeId = homeState().activeId;

        // 節點：漂浮 + 呼吸 + 高亮/淡出
        for (const v of nodeViews.values()) {
            const isActive = activeId === v.def.id;
            const dim = activeId && !isActive && !isConnected(activeId, v.def.id);
            const targetAlpha = dim ? 0.35 : 1;
            v.container.alpha += (targetAlpha - v.container.alpha) * 0.15;

            // 浮在水面上的葉子：被別人的漣漪推著晃。
            // 兩條規則疊加——① 滑鼠正停著的節點完全不動，它是波源也是你要點的目標，得是靜止的錨點；
            // ② 任何節點都不受**自己發出**的那發影響，否則波源就在腳下、會被自己震飛。
            let wave = { energy: 0, pushX: 0, pushY: 0 };
            if (!reduceMotion && !isActive) {
                wave = field.sampleWater(v.px / W, v.py / H, v.def.id);
            }
            // 被波往外推，波過了就回到原位
            v.ox += (wave.pushX * short * FLOAT_SHIFT - v.ox) * 0.2;
            v.oy += (wave.pushY * short * FLOAT_SHIFT - v.oy) * 0.2;
            v.container.position.set(v.px + v.ox, v.py + v.oy);
            // 順著推力方向傾一點——這是「浮在水面上」最有效的線索，比浮起多高還明顯
            v.container.rotation += (wave.pushX * FLOAT_TILT - v.container.rotation) * 0.2;

            // 浮起的高度不用 y 位移表示（那會讀成「在跳」而不是「浮」，也會破壞版面精度），改用微幅縮放
            const pulse = 1 + Math.sin(anim * 1.4 + v.px) * 0.015;
            const lift = 1 + wave.energy * FLOAT_LIFT;
            const scale = (isActive ? 1.08 : 1) * pulse * lift;
            v.container.scale.set(v.container.scale.x + (scale - v.container.scale.x) * 0.15);
            // 幾何只在 active 變動時重畫；呼吸/淡出是 transform/alpha，不必重算幾何
            if (isActive !== v.active) {
                v.active = isActive;
                drawNode(v, isActive);
            }
        }

        drawEdges(anim, activeId);
    });

    const isConnected = (a: string, b: string): boolean =>
        EDGES.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

    // 邊要接在節點**漂浮後**的位置上，否則節點晃走了連線還釘在原處
    const ax = (v: NodeView): number => v.px + v.ox;
    const ay = (v: NodeView): number => v.py + v.oy;

    const curveOf = (a: NodeView, b: NodeView) => {
        const mx = (ax(a) + ax(b)) / 2;
        const my = (ay(a) + ay(b)) / 2;
        const dx = ax(b) - ax(a);
        const dy = ay(b) - ay(a);
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(len * 0.12, short * 0.08);
        return { cx: mx + (-dy / len) * bow, cy: my + (dx / len) * bow };
    };

    const drawEdges = (time: number, activeId: string | null): void => {
        edgeGfx.clear();

        // meta 邊（RWD「包住每一頁」）：很淡的虛線點，不搶戲，只示意關聯
        for (const edge of EDGES.filter((e) => e.meta)) {
            const a = nodeViews.get(edge.from)!;
            const b = nodeViews.get(edge.to)!;
            const { cx, cy } = curveOf(a, b);
            const involved = !activeId || activeId === edge.from || activeId === edge.to;
            const dots = 22;
            for (let i = 1; i < dots; i++) {
                const p = bezier(ax(a), ay(a), cx, cy, ax(b), ay(b), i / dots);
                edgeGfx.circle(p.x, p.y, 1).fill({ color: TONE[edge.tone], alpha: involved ? 0.28 : 0.1 });
            }
        }

        for (const { edge, label } of edgeLabels) {
            const a = nodeViews.get(edge.from)!;
            const b = nodeViews.get(edge.to)!;
            const { cx, cy } = curveOf(a, b);

            const involved = !activeId || activeId === edge.from || activeId === edge.to;
            const color = TONE[edge.tone];

            // 基底弧線
            const seg = 26;
            edgeGfx.moveTo(ax(a), ay(a));
            for (let i = 1; i <= seg; i++) {
                const p = bezier(ax(a), ay(a), cx, cy, ax(b), ay(b), i / seg);
                edgeGfx.lineTo(p.x, p.y);
            }
            edgeGfx.stroke({ color, width: involved ? 1.4 : 1, alpha: involved ? 0.5 : 0.18 });

            // 共用技術：小點從弧線中點朝「兩端」對稱散出、到端點淡出——
            // 表達「這項技術被兩個節點共用」，而不是 A 單向送給 B。
            for (let k = 0; k < 2; k++) {
                const beat = (time * 0.35 + k * 0.5) % 1;
                const fade = Math.sin(beat * Math.PI); // 中點亮、越靠端點越淡
                for (const dir of [-1, 1]) {
                    const tt = 0.5 + dir * 0.5 * beat;
                    const p = bezier(ax(a), ay(a), cx, cy, ax(b), ay(b), tt);
                    edgeGfx.circle(p.x, p.y, involved ? 2.4 : 1.7).fill({ color, alpha: (involved ? 0.9 : 0.38) * fade });
                }
            }

            // 標籤擺中點、微彎的外側
            label.position.set(cx, cy);
            label.alpha = involved ? 0.8 : 0.25;
        }
    };

    // 語言切換：更新節點標籤
    onLangChange(() => {
        for (const v of nodeViews.values()) v.label.text = t(`${v.def.i18nKey}.title`);
    });

    // 按返回回到首頁時，瀏覽器用 bfcache 還原成「離開時的畫面」＝zoom 轉場的最後一幀（純色屏）。
    // pageshow 時把轉場狀態清乾淨、確保 ticker 在跑，畫面才會回到 render graph。
    window.addEventListener('pageshow', () => {
        useHomeStore.getState().setEntering(null);
        enterStart = -1;
        fxLayer.clear();
        // 離開時打的那發轉場大波不該在返回後還掛在水面上，節點也要回到沒被推過的位置
        field.clearDrops();
        for (const v of nodeViews.values()) {
            v.ox = 0;
            v.oy = 0;
            v.container.rotation = 0;
        }
        if (!app.ticker.started && !document.hidden) app.ticker.start();
    });
}
