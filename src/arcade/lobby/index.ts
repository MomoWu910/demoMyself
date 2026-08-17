import type { GameModule, ModuleContext, ModuleId } from '../core/module';
import { lobbyFooterH, lobbyTabH, topBarH, uiScale } from '../core/layout';
import { onLangChange } from '../../i18n';
import { arcadeState, useArcadeStore } from '../store';
import { entriesFor, type LobbyEntry } from './catalog';
import { BannerCarousel } from './banner';
import { GameRail } from './rail';
import type { GameId } from '../net/protocol';

/**
 * 大廳。
 *
 * 版面照真實博弈大廳的分區來：**頂部錢包、左側活動 banner、右側分類 tab 加一條可以
 * 左右滑的機台軌、底部功能列**。這個配置不是美術偏好，是這類產品共同收斂出來的結果——
 * 錢包要一直看得到、廣告要在視線起點、機台要能一路撥過去。
 *
 * 哪一塊歸誰畫，判準跟整頁一致：**要動、要 GPU、跟手指同步的歸 canvas；要能被鍵盤按到、
 * 要能翻譯、不必每幀重畫的歸 DOM。** 所以 banner 輪播與機台滑軌在這裡（Pixi），
 * 分類 tab、錢包、頁腳在 ui/LobbyChrome.tsx（React），兩邊只透過 store 說話。
 *
 * 它**也走 GameModule 契約**——不是因為大廳需要那些資源管理，而是因為這樣
 * 「大廳 → 玩法 → 回大廳」的每一步都真的會走一次卸載與核對。大廳如果只是 canvas 外的
 * 一層選單，舞台就永遠不會回到空的狀態，而「回到空舞台時 texture 有沒有回到基線」
 * 正是這一頁最想給人看的那個對照（見 core/module.ts）。
 */

/** 左右分欄的門檻。再窄下去 banner 與滑軌並排會各自剩不到 200px */
const SPLIT_MIN_W = 720;
/**
 * 左欄 banner 的寬度區間。
 *
 * 上限是**基準尺寸下**的上限，實際會再乘上 UI 縮放係數（見 core/layout.ts）。
 * 原本這裡是一個死的 300——於是 2560 寬的螢幕上，banner 仍然只有 300 寬、
 * 高度照直立比例也只有 415，整組內容縮在畫面左上角，右邊與下面各躺著一大片黑。
 * **「不隨螢幕變大」在小螢幕上是保護，在大螢幕上是壞掉。**
 */
const BANNER_MIN_W = 168;
const BANNER_MAX_W = 300;
/** banner 的寬高比。直立海報，比照真實大廳那張（261×361） */
const BANNER_ASPECT = 261 / 361;
const GUTTER = 18;

export class LobbyModule implements GameModule {
    public readonly id: ModuleId = 'lobby';

    private readonly onPick: (id: GameId) => void;
    private banner: BannerCarousel | null = null;
    private rail: GameRail | null = null;
    private dead = false;

    constructor(onPick: (id: GameId) => void) {
        this.onPick = onPick;
    }

    public mount(ctx: ModuleContext): void {
        const banner = new BannerCarousel();
        const rail = new GameRail((entry) => this.pick(entry));
        this.banner = banner;
        this.rail = rail;
        ctx.root.addChild(banner, rail);

        rail.setEntries(entriesFor(arcadeState().lobbyTab));

        // 慣性要有人推。元件自己不碰 ticker——每幀邏輯登記在 ctx.frame() 才會在卸載時
        // 被收回（見 core/module.ts），元件自己抓 ticker 等於開第二條沒人管的生命週期
        ctx.frame((ticker) => rail.update(ticker.deltaMS / 1000));

        // 分類是 React 那側切的，canvas 這側只認 store 裡的值
        const unsubTab = useArcadeStore.subscribe((s, prev) => {
            if (s.lobbyTab !== prev.lobbyTab && !this.dead) rail.setEntries(entriesFor(s.lobbyTab));
        });
        ctx.onDispose(unsubTab);

        // i18n 沒有取消訂閱（見 i18n/useT.ts），所以要自己擋——大廳卸載後切語言，
        // 這個 callback 還會醒過來對著已經 destroy 的 Text 動手
        onLangChange(() => {
            if (this.dead) return;
            banner.refreshText();
            rail.refreshText();
        });

        ctx.onDispose(() => {
            this.dead = true;
            banner.stop();
            rail.stop();
        });

        ctx.onResize((w, h) => this.layout(w, h));
        this.layout(ctx.screen.width, ctx.screen.height);
    }

    /**
     * 點卡片。
     *
     * 還沒做的那幾張點下去不是靜悄悄沒反應，也不是彈一個紅色錯誤——是一句「規劃中」的
     * 提示。**沒反應的按鈕是壞掉的按鈕**，而把「這款還沒做」講成錯誤又太重了，
     * 所以 store 裡的提示分成 error 與 notice 兩種語氣（見 store.ts）。
     */
    private pick(entry: LobbyEntry): void {
        if (!entry.playable) {
            arcadeState().setNotice('arcade.notice.comingSoon');
            return;
        }
        this.onPick(entry.gameId);
    }

    private layout(w: number, h: number): void {
        if (!this.banner || !this.rail) return;

        // 一個係數管到底：讓位的高度、留白、banner 上限、卡片與字級全部乘它。
        // DOM 那側吃的是同一個值（core/stage.ts 推成 CSS 變數），兩邊才不會錯開
        const s = uiScale(w, h);

        // 上下各讓給 DOM 那幾條。這些高度是算出來的不是量出來的——理由見 core/layout.ts
        const top = topBarH(s) + lobbyTabH(s);
        const bottom = lobbyFooterH(s);
        const innerH = Math.max(120, h - top - bottom);
        // 跟 style.css 的 `clamp(16px, 3vw, 32px)` 是同一條，差別只在這裡要再乘 scale
        const pad = Math.max(14, Math.min(w * 0.03, 32)) * s;
        const gutter = GUTTER * s;

        if (w >= SPLIT_MIN_W) {
            /*
             * banner 的寬度被三件事同時夾住：畫面寬的兩成四、放大後的絕對上限、
             * 以及**照直立比例算出來的高度不能超過可用高度**。
             *
             * 第三條是關鍵：banner 是直立海報（261×361），寬度一放大高度就跟著長，
             * 矮螢幕上很容易長到比整個內容區還高。與其事後把它壓扁破壞比例，
             * 不如一開始就從高度反推寬度的上限。
             */
            const bannerW = Math.max(
                BANNER_MIN_W,
                Math.min(w * 0.24, BANNER_MAX_W * s, innerH * BANNER_ASPECT)
            );
            const bannerH = Math.min(innerH, bannerW / BANNER_ASPECT);

            // banner 照自己的比例、在可用高度裡垂直置中；**滑軌則吃滿整段高度**。
            // 兩邊一起被 banner 的比例綁住，才是大螢幕上內容縮在左上角的第二個原因——
            // 廣告有它該有的形狀，機台區沒有，它就該把剩下的空間用完
            this.banner.visible = true;
            this.banner.position.set(pad, top + (innerH - bannerH) / 2);
            this.banner.setViewport(bannerW, bannerH);

            this.rail.position.set(pad + bannerW + gutter, top);
            this.rail.setViewport(Math.max(120, w - pad * 2 - bannerW - gutter), innerH, s);
            return;
        }

        // 窄畫面：banner 橫躺在上方。整個藏掉也是一種選擇，但那等於在最常見的
        // 尺寸上把版面的一半拿掉——真實大廳在手機上一樣留著它，只是壓扁
        const bannerH = Math.max(96, Math.min(innerH * 0.38, 168 * s));
        this.banner.visible = true;
        this.banner.position.set(pad, top);
        this.banner.setViewport(w - pad * 2, bannerH);

        // 滑軌不吃滿剩下的高度。吃滿的話卡片會被垂直置中在一大片空白的正中間，
        // 上下各留兩百多 px——那看起來不是「排版」，是「東西掉在畫面中間」。
        // 上限抓在「兩排卡片剛好放得下」，多的留白統一收在下方（見 rail 的 rows）
        const railH = Math.min(Math.max(96, innerH - bannerH - gutter), 430 * s);
        this.rail.position.set(pad, top + bannerH + gutter);
        this.rail.setViewport(w - pad * 2, railH, s);
    }
}
