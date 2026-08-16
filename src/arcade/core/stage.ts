import { Application, Container, FillGradient, Graphics } from 'pixi.js';
import { ModuleHost, type GameModule, type ModuleId } from './module';
import { SlotModule } from '../games/slot';
import { BaccaratModule } from '../games/baccarat';
import { LobbyModule } from '../lobby';
import { useArcadeStore } from '../store';
import { sessionWallet } from '../server/wallet';
import { BG as THEME_BG } from '../theme';

/**
 * 遊樂場的舞台：一個 Application、一個 ModuleHost，玩法掛在上面換。
 *
 * 這一頁的視覺**刻意跟站台其他頁不同調**——其他頁是冷色極簡加一面水，
 * 這裡是暖色霓虹。理由不是換口味：作品集上一頁一個樣才看得出「能配合不同的美術方向」，
 * 全站長一樣只證明得了一種品味。共用的仍然是字體與版面節奏，所以不會散掉。
 */

/** 背景底色。近黑帶一點暖（見 theme.ts）——純黑會讓金色看起來髒。 */
const BG = THEME_BG;

export interface ArcadeStage {
    app: Application;
    host: ModuleHost;
    /** 換場景。會先把目前這個卸乾淨並核對資源，再掛下一個。 */
    enter: (id: ModuleId) => Promise<void>;
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
        // 是因為整片死平的黑會讓金色浮不起來，看起來像貼紙。
        //
        // 黑金版的中心只比背景亮一點點（0x171410 對 0x0a0908）——**這一層要幾乎看不見**。
        // 看得出來的漸層底就會變成一顆聚光燈，而聚光燈是舞台的長相，不是牌桌的
        const grad = new FillGradient({
            type: 'radial',
            center: { x: 0.5, y: 0.45 },
            innerRadius: 0,
            outerCenter: { x: 0.5, y: 0.45 },
            outerRadius: 0.68,
            colorStops: [
                { offset: 0, color: 0x171410 },
                { offset: 0.55, color: 0x100e0c },
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
     * 建一個場景。
     *
     * 用 switch 而不是查表，是為了讓 `ModuleId` 加一個而這裡忘了補時**編譯就失敗**——
     * 查表可以寫成 `map[id]?.()`，漏了一個會靜默地什麼都沒發生。
     */
    const create = (id: ModuleId): GameModule => {
        switch (id) {
            case 'lobby':
                return new LobbyModule((game) => void enter(game));
            case 'slot':
                return new SlotModule();
            case 'baccarat':
                return new BaccaratModule();
        }
    };

    /**
     * 換場景。
     *
     * 這是 store 的 `scene` 唯一的寫入點——**掛載完成才寫**，不是按下去就寫。
     * 提早寫的話，HUD 會在新玩法還沒把 handler 註冊好之前就把它的面板畫出來，
     * 玩家看得到一顆按下去沒反應的按鈕。
     *
     * 卸載的核對結果也一併送進 store，讓它出現在畫面上而不是只留在 console——
     * 這一頁在架構上想證明的事，藏在 console 裡等於沒做。
     */
    const enter = async (id: ModuleId): Promise<void> => {
        // 卸載的是「目前這個」，所以要在切換前記下它是誰——核對結果要掛在它頭上，
        // 而不是掛在即將進場的那個（見 store 的 textureBaselines）
        const leaving = host.getCurrent()?.id ?? null;

        await host.switchTo(create(id));

        const store = useArcadeStore.getState();
        const report = host.getLastReport();
        if (leaving && report) store.recordDispose(leaving, report);
        store.setScene(id);
    };

    useArcadeStore.getState().setEnter((id) => void enter(id));

    // 餘額在**進大廳之前**就要有值。連線是玩法自己開的（見 net/fakeSocket.ts），
    // 所以在大廳裡一個 socket 都沒有——照舊的寫法頂列的錢包會一路顯示 0，直到玩家
    // 進了某一款遊戲才突然跳出數字。錢包屬於帳號不屬於桌台（見 server/wallet.ts），
    // 這裡直接向共用錢包查一次，相當於真實平台登入後推的第一個餘額封包。
    useArcadeStore.getState().setBalance(sessionWallet.get());

    await enter('lobby');

    const stage: ArcadeStage = {
        app,
        host,
        enter,
        destroy: () => {
            ro.disconnect();
            document.removeEventListener('visibilitychange', onVisibility);
            host.disposeCurrent();
            const store = useArcadeStore.getState();
            store.setScene(null);
            store.setEnter(null);
            app.destroy(true, { children: true });
        },
    };

    // 除錯用的入口，跟上面的 __PIXI_APP__ 同一個用途：讓人（或驗證腳本）能在
    // console 裡直接切場景與讀 texture 數，不必真的去點畫面。
    // 驗「進出玩法幾次之後有沒有回到基線」時特別需要——那件事沒辦法用眼睛看。
    (globalThis as unknown as { __ARCADE__: ArcadeStage }).__ARCADE__ = stage;

    return stage;
}
