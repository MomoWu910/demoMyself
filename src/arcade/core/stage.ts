import { Application, Container, FillGradient, Graphics } from 'pixi.js';
import { ModuleHost, type GameModule } from './module';
import { SlotModule } from '../games/slot';
import { useArcadeStore } from '../store';

/**
 * 遊樂場的舞台：一個 Application、一個 ModuleHost，玩法掛在上面換。
 *
 * 這一頁的視覺**刻意跟站台其他頁不同調**——其他頁是冷色極簡加一面水，
 * 這裡是暖色霓虹。理由不是換口味：作品集上一頁一個樣才看得出「能配合不同的美術方向」，
 * 全站長一樣只證明得了一種品味。共用的仍然是字體與版面節奏，所以不會散掉。
 */

/** 背景底色。比站台其他頁更暖、更深一點，霓虹色壓在上面才亮得起來。 */
const BG = 0x120a1e;

export interface ArcadeStage {
    app: Application;
    host: ModuleHost;
    /** 換玩法。會先把目前這款卸乾淨並核對資源，再掛下一款。 */
    enter: (module: GameModule) => Promise<void>;
    /** 拆掉整個舞台。回上一頁時不必呼叫（整頁導覽會連 context 一起丟），提供給熱重載用。 */
    destroy: () => void;
}

export async function mountArcade(container: HTMLElement): Promise<ArcadeStage> {
    const params = new URLSearchParams(window.location.search);
    const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

    const app = new Application();
    await app.init({
        background: BG,
        resizeTo: container,
        preference,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
    });
    container.appendChild(app.canvas);
    (globalThis as any).__PIXI_APP__ = app;

    // ---- 背景層：玩法之上換來換去，這一層一直在 ----
    const bg = new Container();
    app.stage.addChild(bg);
    const glow = new Graphics();
    bg.addChild(glow);

    const drawBg = (w: number, h: number): void => {
        glow.clear();
        // 由中心往外的光暈，把視線壓在盤面所在的位置。用漸層而不是純色，
        // 是因為整片死平的深色會讓霓虹色浮不起來、看起來像貼紙
        const grad = new FillGradient({
            type: 'radial',
            center: { x: 0.5, y: 0.45 },
            innerRadius: 0,
            outerCenter: { x: 0.5, y: 0.45 },
            outerRadius: 0.62,
            colorStops: [
                { offset: 0, color: 0x2a1440 },
                { offset: 0.55, color: 0x1a0d2a },
                { offset: 1, color: BG },
            ],
        });
        glow.rect(0, 0, w, h).fill(grad);
    };
    drawBg(app.screen.width, app.screen.height);

    const host = new ModuleHost(app);

    // ---- 尺寸 ----
    // 用 ResizeObserver 而不是只靠 window resize：iOS 轉向時 resize 事件發出的當下
    // viewport 還沒穩定，量到的常是轉向前的值（首頁 graph/scene.ts 有同樣的處理）
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        const w = Math.round(r.width);
        const h = Math.round(r.height);
        if (w === lastW && h === lastH) return;
        lastW = w;
        lastH = h;
        app.resize();
    });
    ro.observe(container);

    app.renderer.on('resize', (w: number, h: number) => {
        drawBg(w, h);
        host.resize(w, h);
    });

    // ---- 省電：分頁切走就停 ticker ----
    const onVisibility = (): void => {
        if (document.hidden) app.ticker.stop();
        else app.ticker.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    /**
     * 進一款玩法。
     *
     * 這是 store 的 `game` 唯一的寫入點——**掛載完成才寫**，不是按下去就寫。
     * 提早寫的話，HUD 會在新玩法還沒把 handler 註冊好之前就把它的面板畫出來，
     * 玩家看得到一顆按下去沒反應的按鈕。
     *
     * 卸載的核對結果也一併送進 store，讓它出現在畫面上而不是只留在 console。
     */
    const enter = async (module: GameModule): Promise<void> => {
        await host.switchTo(module);
        const store = useArcadeStore.getState();
        store.setLastDispose(host.getLastReport());
        store.setGame(module.id);
    };

    await enter(new SlotModule());

    return {
        app,
        host,
        enter,
        destroy: () => {
            ro.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            host.disposeCurrent();
            useArcadeStore.getState().setGame(null);
            app.destroy(true, { children: true });
        },
    };
}
