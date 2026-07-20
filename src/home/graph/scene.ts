import { Application, Container, Graphics, Sprite, Text, Texture, TextStyle } from 'pixi.js';
import { EDGES, NODES, nodeById, type ProjectNode, type Tone } from '../projects';
import { useHomeStore, homeState, type Backend } from '../store';
import { createFieldFilter, DROP_PERIOD } from './field';
import { enterProject, ENTER_MS } from '../enter';
import { t, onLangChange } from '../../i18n';

/** tone → 代表色（琥珀=GLSL/WebGL，紫=WGSL/WebGPU，藍=Pixi，灰=中性）。 */
const TONE: Record<Tone, number> = {
    glsl: 0xff8a3d,
    wgsl: 0xb57bff,
    dual: 0xd98ad6,
    pixi: 0x5aa9ff,
    neutral: 0x9aa0b2,
};

const AMBER = 0xff8a3d;
const VIOLET = 0xb57bff;

interface NodeView {
    def: ProjectNode;
    container: Container;
    ring: Graphics;
    glyph: Text;
    label: Text;
    px: number;
    py: number;
    pr: number;
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

export async function mountGraph(container: HTMLElement): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({
        background: 0x0b0c10,
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
    bg.filters = [field.filter];
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
                fill: 0xf2f4fa,
            }),
        });
        glyph.anchor.set(0.5);

        const label = new Text({
            text: t(`${def.i18nKey}.title`),
            style: new TextStyle({
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 12,
                fill: 0xc9cede,
                letterSpacing: 0.6,
            }),
        });
        label.anchor.set(0.5, 0);

        c.addChild(ring, glyph, label);
        nodeLayer.addChild(c);

        c.on('pointerover', () => {
            useHomeStore.getState().setActive(def.id);
            // 滑過＝手指碰到水面：一發細碎、稍快的小漣漪，讓 hover 有重量
            const v = nodeViews.get(def.id);
            if (v && !reduceMotion) field.emit({ ...dropAt(v), strength: 0.7, speed: 1.4, freq: 1.5 });
        });
        c.on('pointerout', () => {
            if (homeState().activeId === def.id) useHomeStore.getState().setActive(null);
        });
        c.on('pointertap', () => {
            // 進場＝整潭水被打了一記：又快又疏的大波，跟著純色圓一起把畫面推開
            const v = nodeViews.get(def.id);
            if (v && !reduceMotion) field.emit({ ...dropAt(v), strength: 2.6, speed: 5.0, freq: 0.45 });
            enterProject(def.id);
        });

        nodeViews.set(def.id, { def, container: c, ring, glyph, label, px: 0, py: 0, pr: 0, active: false });
    }

    // 每個節點下次該滴水的時間（秒，對齊動畫時鐘）。at <= 0 代表「還沒排」，會在下一幀隨機排一個
    // 初始時間——這樣五個節點不會在同一秒一起滴，水面才有自然的節奏。
    const dropSchedule = new Map<string, { at: number }>();
    for (const def of NODES) dropSchedule.set(def.id, { at: 0 });

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
        for (const s of dropSchedule.values()) s.at = 0;
    };

    const drawNode = (v: NodeView, active: boolean): void => {
        const r = v.pr;
        v.ring.clear();

        const dual = v.def.tone === 'dual';
        const base = TONE[v.def.tone];

        // 節點核心：深色玻璃底
        v.ring.circle(0, 0, r).fill({ color: 0x11141c, alpha: 0.92 });

        // 邊環：dual 節點畫成琥珀/紫兩半弧，其餘單色
        const ringW = active ? 3 : 2;
        if (dual) {
            // 先 moveTo 到弧的起點，否則 arc() 會從路徑預設起點 (0,0) 拉一條線到弧起點——
            // 那就是節點中央到頂端那條多餘的垂直線。
            v.ring.moveTo(0, -r).arc(0, 0, r, -Math.PI / 2, Math.PI / 2).stroke({ color: AMBER, width: ringW, alpha: active ? 1 : 0.85 });
            v.ring.moveTo(0, r).arc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2).stroke({ color: VIOLET, width: ringW, alpha: active ? 1 : 0.85 });
        } else {
            v.ring.circle(0, 0, r).stroke({ color: base, width: ringW, alpha: active ? 1 : 0.7 });
        }
    };

    layout();
    app.renderer.on('resize', layout);

    // ---- 動畫迴圈 ----
    let elapsed = 0;
    let enterStart = -1;
    app.ticker.add(({ deltaMS }) => {
        elapsed += deltaMS / 1000;
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

        // 節點常駐滴水：各自照自己的時鐘，間隔隨機抖動 ±30%，才不會拍成整齊的節拍。
        // reduce-motion 時整個水面是凍的，一滴也不排。
        if (!reduceMotion) {
            for (const v of nodeViews.values()) {
                const s = dropSchedule.get(v.def.id)!;
                if (activeId === v.def.id) {
                    // 滑鼠正停在這個節點上：這裡的水面歸 hover 那發管，隨機滴水會打架。
                    // 順手把下次時間往後推，移開後才不會立刻補一發。
                    s.at = elapsed + DROP_PERIOD * (0.7 + Math.random() * 0.6);
                } else if (s.at <= 0) {
                    s.at = elapsed + Math.random() * DROP_PERIOD; // 初次隨機錯開
                } else if (elapsed >= s.at) {
                    field.emit({ ...dropAt(v), strength: v.pr / (0.085 * short) });
                    s.at = elapsed + DROP_PERIOD * (0.7 + Math.random() * 0.6);
                }
            }
        }

        // 節點：呼吸 + 高亮/淡出
        for (const v of nodeViews.values()) {
            const isActive = activeId === v.def.id;
            const dim = activeId && !isActive && !isConnected(activeId, v.def.id);
            const targetAlpha = dim ? 0.35 : 1;
            v.container.alpha += (targetAlpha - v.container.alpha) * 0.15;
            const pulse = 1 + Math.sin(anim * 1.4 + v.px) * 0.015;
            const scale = (isActive ? 1.08 : 1) * pulse;
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

    const curveOf = (a: NodeView, b: NodeView) => {
        const mx = (a.px + b.px) / 2;
        const my = (a.py + b.py) / 2;
        const dx = b.px - a.px;
        const dy = b.py - a.py;
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
                const p = bezier(a.px, a.py, cx, cy, b.px, b.py, i / dots);
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
            edgeGfx.moveTo(a.px, a.py);
            for (let i = 1; i <= seg; i++) {
                const p = bezier(a.px, a.py, cx, cy, b.px, b.py, i / seg);
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
                    const p = bezier(a.px, a.py, cx, cy, b.px, b.py, tt);
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
        // 離開時打的那發轉場大波不該在返回後還掛在水面上
        field.clearDrops();
        for (const s of dropSchedule.values()) s.at = 0;
        if (!app.ticker.started && !document.hidden) app.ticker.start();
    });
}
