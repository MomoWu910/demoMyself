import type { VideoSource, VideoStats } from './types';

/**
 * 把視訊放進版面的合成層——**`<video>` 是一塊 DOM 矩形，不是畫進畫布裡的貼圖。**
 *
 * ## 為什麼是疊，不是畫
 *
 * 一開始選的是另一條：把 video 當成貼圖交給 Pixi 畫。理由看起來很充分——畫面只有
 * 640×360，每幀上傳的成本可以忽略，換來的是視訊能參與 Pixi 的排序、遮罩與濾鏡。
 *
 * **那條路實測走不通。** Pixi v8 的 `VideoSource` 拿不到由 `MediaSource` 餵資料的
 * video 的畫面幀：貼圖建得起來、`isValid` 是 true、尺寸也對（640×360）、
 * `uploadMethodId` 是 `'video'`，但畫出來整片全黑。同一個 video 用 2D canvas 的
 * `drawImage` 抓得到完整畫面——**畫面確實在那裡，只是 `texImage2D` 那條路徑取不到。**
 * headless 與真實視窗結果一樣，拿掉遮罩、每幀手動推 `update()`、把 CSS 尺寸從
 * 2px 改成實際大小，全都沒有差別。
 *
 * 於是回到商用視訊桌台一直在用的做法：`<video>` 用 CSS 跟畫布疊在一起，兩邊各畫各的。
 * 這條路本來就有自己的好處，只是原本被評估成「這個場景用不到」：
 *
 * - **不必每幀把畫面上傳到 GPU**，解碼出來的畫面由瀏覽器直接合成，手機上省電
 * - 走的是瀏覽器最佳化過的硬解路徑
 *
 * 代價也要誠實記著：視訊是一塊 DOM 矩形，**參與不了 Pixi 的合成**——想讓某個 Pixi
 * 元素鑽到視訊底下、或給視訊上一層 shader，都做不到。這一頁目前不需要那些，
 * 真的需要時得先解決上面那個貼圖問題。
 *
 * ## 疊法：視訊沉在畫布**底下**
 *
 * ```text
 * #stage
 *   .live-video     ← 這一層：只有 <video>（z-index 0）
 *   canvas          Pixi 的世界（z-index 1，背景設成透明）
 * #hud-root         React 的 HUD（z-index 6）
 * ```
 *
 * 第一版是反過來的——視訊疊在畫布**之上**，疊層 UI 用 DOM 掛在視訊裡。那在「只看桌」
 * 的版本成立：要疊的只有倒數與結果兩行字，用 DOM 寫還比較快。
 *
 * 接上下注就不成立了。注區要有籌碼飛進來、中獎要發亮、路圖要能捲動，那些是
 * `common/chips` 與 `common/roadmap` 已經寫好的 Pixi 元件——**而它們畫在畫布上，
 * 會整片被視訊蓋掉。** 要嘛把整套元件庫用 DOM 重寫一次，要嘛把視訊沉下去。
 *
 * 沉下去只要兩件事：這一層的 `z-index` 讓給畫布，畫布的背景設成透明
 * （見 games/baccaratLive/index.ts 的 mount）。代價是**視訊變成畫面的最底層**，
 * 沒有任何 Pixi 元素能鑽到它下面——但視訊本來就是背景，這個限制在這一頁沒有成本。
 *
 * 換來的是疊層全部歸 Pixi：倒數、延遲區、結果、注區、路圖用同一套座標與同一個 ticker，
 * 不必再讓 DOM 與 canvas 兩套座標系互相追。所以這一層不再提供 overlay 插槽——
 * **它現在只負責一塊會播放的矩形。**
 */

export interface VideoLayerOptions {
    /** 面板要掛進哪個容器。通常是 canvas 的父層 */
    parent: HTMLElement;
}

export interface VideoLayer {
    /** 面板的 DOM 根 */
    root: HTMLDivElement;
    /** 版面決定視訊佔哪一塊。座標用 CSS 像素，跟 Pixi 的 screen 座標同一套 */
    setRect(x: number, y: number, width: number, height: number): void;
    /** 每幀。回傳來源的統計，順手往上傳給延遲儀表 */
    tick(): VideoStats;
    /** 換來源。舊的會被卸乾淨——切桌、切線路都走這裡 */
    swap(next: VideoSource): Promise<void>;
    destroy(): void;
}

export function createVideoLayer(source: VideoSource, opts: VideoLayerOptions): VideoLayer {
    const root = document.createElement('div');
    root.className = 'live-video';

    const frame = document.createElement('div');
    frame.className = 'live-video__frame';
    root.appendChild(frame);

    opts.parent.appendChild(root);

    let current = source;
    let disposed = false;

    function attach(src: VideoSource): void {
        src.element.className = 'live-video__el';
        // 清掉來源自己可能留下的行內樣式，改由 class 決定尺寸
        src.element.removeAttribute('style');
        frame.appendChild(src.element);
    }

    attach(source);

    return {
        root,

        setRect(x, y, width, height): void {
            // Pixi 開了 autoDensity，它的 screen 座標本來就是 CSS 像素，
            // 這裡不必再換算一次 devicePixelRatio
            root.style.transform = `translate(${x}px, ${y}px)`;
            root.style.width = `${width}px`;
            root.style.height = `${height}px`;
        },

        tick(): VideoStats {
            return current.tick();
        },

        async swap(next): Promise<void> {
            if (disposed) return;
            current.destroy();
            current = next;
            attach(next);
            await next.start();
        },

        destroy(): void {
            disposed = true;
            current.destroy();
            root.remove();
        },
    };
}
