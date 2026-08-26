import type Hls from 'hls.js';
import { bufferedAhead } from './timeline';
import type { VideoSource, VideoSourceHandlers, VideoStats, VideoStatus } from './types';

/**
 * 吃真實 HLS 直播的來源——**另一條路線，證明的是另一件事。**
 *
 * `MseFeeder` 證明得出「延遲是可以被設計的」，但它餵的是我們自己切的靜態片段，
 * 沒有滾動的 playlist、沒有真的 CDN、沒有網路抖動。這一條補上那些：接一支真的
 * 24/7 直播，playlist 每兩秒換一次、`MEDIA-SEQUENCE` 一直在跑、前緣一直在動。
 *
 * 兩條並存還帶出一個沒辦法用嘴講清楚的對比：**同一個延遲儀表下，這一條的數字是
 * 那一條的十倍以上。** 那正是視訊博弈不用 HLS 的全部理由——下注截止在十秒之內，
 * 而你看到的荷官已經是十秒前的荷官了。
 *
 * hls.js 是**動態載入**的：它有 200KB 上下，而大部分玩家從頭到尾只會看自製的那條流。
 * 讓每個進遊樂場的人都先付這 200KB，只為了一個可能不會被點開的切換選項，不划算。
 */

/** hls.js 的低延遲設定。跟自寫那條走同一組哲學：緩衝深度就是延遲 */
const HLS_CONFIG = {
    // 從 playlist 的哪裡進場。真實 live 的最後幾段還沒被所有 CDN 節點取得，
    // 抓太靠前緣會一直卡；三段是實務上的折衷
    liveSyncDurationCount: 3,
    // 落後超過這麼多段就跳，對應 MseFeeder 的 flushAt
    liveMaxLatencyDurationCount: 10,
    // 倍速追趕整個交給 hls.js。上限跟自寫那條的 maxRate 取同一個值，
    // 兩邊的儀表讀數才比得出意義
    maxLiveSyncPlaybackRate: 1.5,
    lowLatencyMode: true,
    backBufferLength: 30,
    enableWorker: true,
};

/** 連續幾次錯誤就放棄。hls.js 自己會重試網路錯誤，這是它重試完還是不行的計數 */
const FATAL_LIMIT = 3;

export class HlsSource implements VideoSource {
    readonly kind = 'hls' as const;
    readonly element: HTMLVideoElement;

    private _status: VideoStatus = 'idle';
    get status(): VideoStatus {
        return this._status;
    }

    private readonly url: string;
    private readonly handlers: VideoSourceHandlers;

    private hls: Hls | null = null;
    /** 舊 iOS 走原生 HLS，沒有 hls.js 實例——延遲與緩衝只能從 video 自己推 */
    private native = false;
    private disposed = false;

    private stalls = 0;
    /** 這一條不自己跳，所以恆為 0。欄位留著是因為儀表兩條線路共用同一組讀數 */
    private readonly jumps = 0;
    private fatals = 0;

    constructor(url: string, handlers: VideoSourceHandlers = {}) {
        this.url = url;
        this.handlers = handlers;

        const v = document.createElement('video');
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        v.setAttribute('playsinline', 'true');
        v.setAttribute('webkit-playsinline', 'true');
        v.disablePictureInPicture = true;
        v.crossOrigin = 'anonymous';
        v.addEventListener('waiting', this.onWaiting);
        v.addEventListener('playing', this.onPlaying);
        v.addEventListener('loadedmetadata', () => this.handlers.onMetadata?.(v.videoWidth, v.videoHeight));
        this.element = v;
    }

    /**
     * 開始播。
     *
     * 分流的順序是**先問 hls.js 能不能用，不能才退回原生**，而不是反過來。
     * iOS Safari 兩條路都走得通（它原生支援 HLS，也支援 MSE），但走 hls.js 才拿得到
     * 統計數字與延遲控制——原生播放器把這些全藏起來了，延遲儀表會變成一片空白。
     */
    async start(): Promise<void> {
        if (this.disposed) return;
        this.setStatus('loading');

        try {
            const { default: HlsCtor } = await import('hls.js');
            if (this.disposed) return;

            if (HlsCtor.isSupported()) {
                const hls = new HlsCtor(HLS_CONFIG);
                this.hls = hls;
                hls.on(HlsCtor.Events.ERROR, (_e, data) => {
                    if (!data.fatal) return;
                    this.fatals++;
                    if (this.fatals >= FATAL_LIMIT) {
                        this.fail(new Error(`hls fatal: ${data.type} / ${data.details}`));
                        return;
                    }
                    // hls.js 的復原路徑只有兩條，照它文件的分類走。
                    // 其他型別的 fatal 沒有復原手段，只能重建
                    if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) hls.startLoad();
                    else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
                    else this.fail(new Error(`hls fatal: ${data.type} / ${data.details}`));
                });
                hls.loadSource(this.url);
                hls.attachMedia(this.element);
            } else if (this.element.canPlayType('application/vnd.apple.mpegurl')) {
                // 舊 iOS 沒有 MSE，只剩原生這條路。延遲控制交給系統，我們只讀得到 currentTime
                this.native = true;
                this.element.src = this.url;
            } else {
                this.fail(new Error('HLS unsupported'));
                return;
            }

            void this.element.play().catch(() => {
                const retry = (): void => {
                    void this.element.play().catch(() => {});
                    window.removeEventListener('pointerdown', retry);
                };
                window.addEventListener('pointerdown', retry);
            });
        } catch (e) {
            this.fail(e instanceof Error ? e : new Error(String(e)));
        }
    }

    /**
     * 每幀。**這一條只讀數字，不介入追趕。**
     *
     * 原本這裡也照 `decideCatchUp` 的決定去跳，結果是九秒內跳了一百多次——
     * hls.js 自己就在做倍速追趕與跳轉（`liveSyncDurationCount` / `liveMaxLatencyDurationCount`），
     * 我們每幀再依自己算的延遲跳一次，兩邊互相把播放位置推來推去，誰都收斂不了。
     *
     * 追趕策略要展示的地方是自己寫的那一條（`MseFeeder`），那裡從 buffer 深度到跳轉
     * 門檻都是我們的。這一條的價值在別的地方：**它接的是真實 CDN 的滾動 playlist**，
     * 而同一個儀表下它的延遲是那一條的好幾倍——那個對比才是重點。
     */
    tick(): VideoStats {
        const v = this.element;
        const latency = this.currentLatency();

        return {
            latency: Number.isFinite(latency) ? latency : 0,
            buffered: this.bufferedAhead(),
            playbackRate: v.playbackRate,
            stalls: this.stalls,
            jumps: this.jumps,
        };
    }

    destroy(): void {
        this.disposed = true;
        this.element.removeEventListener('waiting', this.onWaiting);
        this.element.removeEventListener('playing', this.onPlaying);
        this.element.pause();
        // destroy() 會把 media 卸掉並停掉所有 loader。少了它，切走之後那條流還在背景
        // 吃頻寬——真實桌台切桌切個幾次就會發現網路被吃光
        this.hls?.destroy();
        this.hls = null;
        this.element.removeAttribute('src');
        this.element.load();
        this.element.remove();
    }

    // ---- 統計 ------------------------------------------------------------

    /** playlist 的前緣在哪一秒。原生路徑拿不到 hls.js 的數字，只好退回 seekable 的尾端 */
    private liveEdge(): number {
        if (!this.native && this.hls?.liveSyncPosition != null) {
            const buffered = this.element.buffered;
            return buffered.length ? buffered.end(buffered.length - 1) : this.hls.liveSyncPosition;
        }
        const s = this.element.seekable;
        return s.length ? s.end(s.length - 1) : NaN;
    }

    private currentLatency(): number {
        // hls.js 直接給得出來，而且它算的是「playlist 前緣 - 播放位置」，
        // 比我們自己從 buffered 推更準（它知道還沒下載的那幾段有多長）
        if (this.hls && typeof this.hls.latency === 'number' && this.hls.latency > 0) return this.hls.latency;
        const edge = this.liveEdge();
        return Number.isFinite(edge) ? edge - this.element.currentTime : NaN;
    }

    /** 跟自寫那條共用同一支計算——`pts offset` 那個坑兩邊都會踩（見 timeline.ts） */
    private bufferedAhead(): number {
        const b = this.element.buffered;
        const ranges = [];
        for (let i = 0; i < b.length; i++) ranges.push({ start: b.start(i), end: b.end(i) });
        return bufferedAhead(ranges, this.element.currentTime);
    }

    private onWaiting = (): void => {
        if (this.disposed) return;
        this.stalls++;
        this.setStatus('stalled');
    };

    private onPlaying = (): void => {
        if (!this.disposed) this.setStatus('playing');
    };

    private setStatus(s: VideoStatus): void {
        if (this._status === s) return;
        this._status = s;
        this.handlers.onStatus?.(s);
    }

    private fail(err: Error): void {
        this.setStatus('failed');
        this.handlers.onError?.(err);
    }
}

/**
 * 公開的真實直播來源。
 *
 * 挑選的條件只有兩個，而且都是硬條件：**授權明確**、**真的是 live**。
 * 這一支是串流廠商自己掛著給人測試的 demo endpoint，playlist 沒有 `EXT-X-ENDLIST`、
 * `MEDIA-SEQUENCE` 一直在跑、帶 `PROGRAM-DATE-TIME`——是真的直播，不是循環播放的錄影。
 *
 * 明確**不能**碰的：把 Twitch／YouTube 的流拉出來自己播（違反服務條款，只能用官方
 * iframe），以及任何真實賭場的荷官視訊（那是商業授權內容）。
 */
export const PUBLIC_LIVE_URL = 'https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8';
