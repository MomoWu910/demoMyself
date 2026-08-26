import { bufferedAhead, globalStartOf, indexAt, lapDuration, segmentStarts, timestampOffsetFor, decideCatchUp } from './timeline';
import { DEFAULT_CATCH_UP, type CatchUpConfig, type VideoSource, type VideoSourceHandlers, type VideoStats, type VideoStatus } from './types';

/**
 * 自己寫的 MSE 餵流層——**這一頁在串流上真正要證明的東西。**
 *
 * 商用視訊桌台不用 HLS，因為 HLS 的延遲是 10~30 秒，而下注截止在那之前就到了。它們走的是
 * 長連線 + 自己排程解碼，把延遲壓進 1~3 秒。我們的站是純靜態託管，起不了長連線的
 * media server，但**播放層根本不在乎資料從哪來**：拿到編碼片段、自己決定什麼時候餵給
 * `SourceBuffer`、自己控制手上留多少緩衝——這才是那條路線的核心，而它跟資料是從長連線
 * 推來的還是從 CDN 拉來的無關。
 *
 * 所以這裡的做法是：荷官影片預先切成 fMP4 片段當靜態檔放著，播放器**照牆鐘算出「現在
 * 該播到哪」**再去拉對應的片段。素材播完就回到第一段接下去，時間軸靠 `timestampOffset`
 * 一圈一圈往後推。
 *
 * 這樣得到的東西跟真直播在行為上是同一個：
 *
 * - **所有人在同一時刻看到同一格畫面**（位置由牆鐘決定，不由誰何時打開頁面決定）
 * - **重整不會回到開頭**，切到背景再回來要追趕
 * - **延遲是可測量的真實量**，不是模擬出來的數字
 *
 * 唯一跟真直播不同的是內容會循環，而那正好是我們要的——牌序是生成素材時就跟著出來的，
 * 所以「荷官發什麼牌、server 就說什麼牌」這個真實架構得以成立（見 live/README）。
 */

/** 一段影片切片。`duration` 是切片的真實時長，不能假設等長——最後一段幾乎一定不是 */
export interface Segment {
    url: string;
    duration: number;
}

export interface StreamManifest {
    /** fMP4 的 init segment。沒有它 `SourceBuffer` 連 codec 都不知道 */
    initUrl: string;
    segments: Segment[];
    /**
     * `addSourceBuffer` 要的完整字串，例如 `video/mp4; codecs="avc1.64001f"`。
     *
     * 寫死在 manifest 裡而不是從 init segment 解析出來：解析 avcC 要自己走一次 MP4 box
     * 樹，那是打包時就知道的事，沒必要每個觀眾的瀏覽器各算一次。打包腳本負責填對。
     */
    mimeCodec: string;
    /**
     * 這條「直播」的紀元（毫秒時間戳）。
     *
     * 素材的第 0 秒對應的牆鐘時刻。**所有觀眾算出同一個播放位置靠的就是它**——
     * 它必須是寫死的常數，不能用「頁面載入的時間」，否則每個人都從自己的第 0 秒開始，
     * 那就退化成各看各的錄影帶了。
     */
    epoch: number;
}

/** 手上最多留多少秒的緩衝。超過就不再往前拉——**緩衝深度就是延遲**，這是低延遲路線的主要旋鈕 */
const MAX_AHEAD = 4;

/** 播過的東西留多久（秒）才回收。直播跑一小時不清 backward buffer 會把記憶體吃光 */
const KEEP_BEHIND = 20;

/** 連續卡頓幾次就放棄現在這個 MediaSource，整個重建 */
const STALL_LIMIT = 5;

/** 卡頓計數的觀察窗（毫秒）。超過這段時間沒再卡，計數歸零——偶爾卡一下不是故障 */
const STALL_WINDOW = 15_000;

export class MseFeeder implements VideoSource {
    readonly kind = 'mse' as const;
    readonly element: HTMLVideoElement;

    private _status: VideoStatus = 'idle';
    get status(): VideoStatus {
        return this._status;
    }

    private readonly manifest: StreamManifest;
    private readonly cfg: CatchUpConfig;
    private readonly handlers: VideoSourceHandlers;

    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private objectUrl: string | null = null;

    /** 每段在素材內的起始時間（累積表）。切片不等長，所以不能用乘的 */
    private readonly starts: number[];
    /** 素材一圈的總長 */
    private readonly lapDuration: number;

    /**
     * media timeline 的原點對應的「全域時間」。
     *
     * 全域時間 = 從 epoch 起算這條直播已經播了幾秒（會一直長大，跨圈不歸零）。
     * `video.currentTime` 從 0 開始，所以兩者差一個固定的位移，就是它。
     */
    private baseGlobal = 0;

    /** 下一個要餵的片段，用全域序號表示（跨圈連續遞增） */
    private nextIndex = 0;

    /** 已經送出去還沒 append 完的操作。SourceBuffer 一次只吃一個，全部得排隊 */
    private queue: Promise<void> = Promise.resolve();
    private fetching = false;
    private disposed = false;

    private stalls = 0;
    private jumps = 0;
    private stallMarks: number[] = [];
    private lastRemoveAt = 0;
    private rebuilding = false;

    constructor(manifest: StreamManifest, handlers: VideoSourceHandlers = {}, cfg: CatchUpConfig = DEFAULT_CATCH_UP) {
        this.manifest = manifest;
        this.handlers = handlers;
        this.cfg = cfg;

        const durations = manifest.segments.map((s) => s.duration);
        this.starts = segmentStarts(durations);
        this.lapDuration = lapDuration(durations);

        const v = document.createElement('video');
        // muted 是硬需求不是偏好：沒有使用者手勢的自動播放，所有瀏覽器都只放行靜音的。
        // 荷官流本來就不帶音訊，所以這裡沒有任何損失
        v.muted = true;
        v.autoplay = true;
        v.playsInline = true;
        // iOS Safari 沒有這個屬性會在播放時搶成全螢幕原生播放器，整個 overlay 就蓋不上去了
        v.setAttribute('playsinline', 'true');
        v.setAttribute('webkit-playsinline', 'true');
        v.disablePictureInPicture = true;
        v.addEventListener('waiting', this.onWaiting);
        v.addEventListener('playing', this.onPlaying);
        this.element = v;
    }

    // ---- 牆鐘 → 素材位置 -------------------------------------------------

    /** 從 epoch 起算，這條直播已經播了幾秒。這是唯一的時間權威 */
    private globalNow(): number {
        return (Date.now() - this.manifest.epoch) / 1000;
    }

    /** 全域序號 → 那一段在全域時間軸上的起點 */
    private globalStartOf(index: number): number {
        return globalStartOf(index, this.starts, this.lapDuration);
    }

    /** 全域時間落在第幾段（全域序號） */
    private indexAt(globalTime: number): number {
        return indexAt(globalTime, this.starts, this.lapDuration);
    }

    /** 現在「應該」播到 media timeline 的哪一秒。跟 `currentTime` 的差就是延遲 */
    private targetMediaTime(): number {
        return this.globalNow() - this.baseGlobal;
    }

    // ---- 生命週期 -------------------------------------------------------

    async start(): Promise<void> {
        if (this.disposed) return;
        this.setStatus('loading');

        if (!('MediaSource' in window)) {
            this.fail(new Error('MediaSource unavailable'));
            return;
        }
        if (!MediaSource.isTypeSupported(this.manifest.mimeCodec)) {
            this.fail(new Error(`codec unsupported: ${this.manifest.mimeCodec}`));
            return;
        }

        // 從牆鐘算出的位置開始，而不是從第 0 段——**這就是「加入一場正在進行的直播」**
        const now = this.globalNow();
        this.nextIndex = this.indexAt(now);
        this.baseGlobal = this.globalStartOf(this.nextIndex);

        const ms = new MediaSource();
        this.mediaSource = ms;
        this.objectUrl = URL.createObjectURL(ms);
        this.element.src = this.objectUrl;

        await new Promise<void>((resolve) => ms.addEventListener('sourceopen', () => resolve(), { once: true }));
        if (this.disposed) return;

        // 直播沒有終點。不設的話 duration 是 NaN，某些瀏覽器會拒絕 append
        ms.duration = Infinity;

        const sb = ms.addSourceBuffer(this.manifest.mimeCodec);
        // 'segments' 而不是 'sequence'：我們要自己用 timestampOffset 決定每一圈落在哪，
        // 交給 sequence 模式自動接續就失去了「畫面位置由牆鐘決定」這件事
        sb.mode = 'segments';
        sb.addEventListener('error', () => this.fail(new Error('SourceBuffer error')));
        this.sourceBuffer = sb;

        this.element.addEventListener(
            'loadedmetadata',
            () => this.handlers.onMetadata?.(this.element.videoWidth, this.element.videoHeight),
            { once: true },
        );

        const init = await this.fetchBuffer(this.manifest.initUrl);
        if (this.disposed || !init) return;
        await this.enqueue((buf) => buf.appendBuffer(init));

        await this.pump();
        void this.element.play().catch(() => {
            // 自動播放被拒是可以復原的：使用者第一次點畫面時再試一次。
            // 這裡不當成錯誤，因為畫面其實是好的，只是還沒動
            const retry = () => {
                void this.element.play().catch(() => {});
                window.removeEventListener('pointerdown', retry);
            };
            window.addEventListener('pointerdown', retry);
        });
    }

    /**
     * 每幀。追趕策略、餵料、回收都掛在這裡。
     *
     * 為什麼全部塞在同一個 tick 而不是各自開 timer：**它們讀的是同一份狀態**
     * （currentTime、buffered、牆鐘），分開跑就會出現「追趕依據的延遲是三十毫秒前算的」
     * 這種對不上的情況，而且分頁被節流時各個 timer 醒來的順序還不固定。
     */
    tick(): VideoStats {
        const v = this.element;
        const latency = this.targetMediaTime() - v.currentTime;
        const buffered = this.bufferedAhead();

        if (!this.disposed && this.status !== 'failed') {
            this.catchUp(latency);
            void this.pump();
            this.recycle();
        }

        return {
            latency: Number.isFinite(latency) ? latency : 0,
            buffered,
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

        try {
            if (this.mediaSource?.readyState === 'open') this.mediaSource.endOfStream();
        } catch {
            // endOfStream 在 SourceBuffer 還在 updating 時會丟。這裡已經在拆了，丟了也無所謂
        }
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.element.removeAttribute('src');
        this.element.load();
        this.element.remove();

        this.mediaSource = null;
        this.sourceBuffer = null;
        this.objectUrl = null;
    }

    // ---- 追趕 ------------------------------------------------------------

    /**
     * 兩段式追趕：小落後用倍速磨回來，大落後直接跳。
     *
     * 分成兩段的理由是**難受的形狀不同**。落後兩秒時用 1.2 倍速播個幾秒就追平了，
     * 玩家幾乎察覺不到；落後八秒時同樣的做法要磨上十幾秒，那十幾秒裡荷官的手一直
     * 在不自然地快動——在博弈場景裡「畫面看起來被動過手腳」比「畫面跳一下」嚴重得多。
     */
    private catchUp(latency: number): void {
        const v = this.element;
        // 跳的目標不是前緣本身而是「前緣往回一個 target」——跳到前緣等於把緩衝清成 0，
        // 下一個網路波動就再卡一次，於是變成跳、卡、跳的迴圈
        const action = decideCatchUp(latency, v.playbackRate, this.targetMediaTime() - this.cfg.target, this.cfg);

        if (action.kind === 'rate') {
            v.playbackRate = action.rate;
        } else if (action.kind === 'jump') {
            if (this.isBuffered(action.to)) {
                v.currentTime = action.to;
                v.playbackRate = 1;
                this.jumps++;
            } else {
                // 目標點還沒在手上——硬 seek 過去只會換來一次更長的空轉。
                // 讓 pump 先把料補到那裡，下一幀再跳
                this.nextIndex = this.indexAt(this.baseGlobal + action.to);
            }
        }
    }

    // ---- 餵料與回收 -------------------------------------------------------

    /** 手上還有幾秒沒播。判斷本身在 timeline.ts，那裡有它為什麼不是一句減法的說明 */
    private bufferedAhead(): number {
        const sb = this.sourceBuffer;
        if (!sb) return 0;
        try {
            const ranges = [];
            for (let i = 0; i < sb.buffered.length; i++) ranges.push({ start: sb.buffered.start(i), end: sb.buffered.end(i) });
            return bufferedAhead(ranges, this.element.currentTime);
        } catch {
            // buffered 在 MediaSource 關掉之後會丟 InvalidStateError
            return 0;
        }
    }

    private isBuffered(t: number): boolean {
        const sb = this.sourceBuffer;
        if (!sb) return false;
        try {
            for (let i = 0; i < sb.buffered.length; i++) {
                if (sb.buffered.start(i) <= t && t <= sb.buffered.end(i)) return true;
            }
        } catch {
            return false;
        }
        return false;
    }

    /**
     * 把緩衝補到 `MAX_AHEAD`，不多不少。
     *
     * **一次餵完是最容易犯的錯**：緩衝深度直接變成延遲，而且回收壓力全堆在後面。
     * 一次只補一段，補到夠就停，才有「延遲是設計出來的」這回事。
     */
    private async pump(): Promise<void> {
        if (this.disposed || this.fetching || !this.sourceBuffer) return;
        if (this.bufferedAhead() >= MAX_AHEAD) return;

        const n = this.manifest.segments.length;
        const index = this.nextIndex;
        const seg = this.manifest.segments[index % n];

        this.fetching = true;
        try {
            const buf = await this.fetchBuffer(seg.url);
            if (this.disposed || !buf) return;

            // 這一段在 media timeline 上該落在哪——推導見 timeline.ts 的 timestampOffsetFor
            await this.enqueue((sb) => {
                sb.timestampOffset = timestampOffsetFor(index, this.starts, this.lapDuration, this.baseGlobal);
                sb.appendBuffer(buf);
            });
            this.nextIndex = index + 1;
        } catch (e) {
            if (e instanceof Error && e.name === 'QuotaExceededError') {
                // 緩衝滿了。這不是故障，是該回收了——強制清一次再讓下一幀重試
                this.recycle(true);
            } else if (!this.disposed) {
                this.fail(e instanceof Error ? e : new Error(String(e)));
            }
        } finally {
            this.fetching = false;
        }
    }

    /** 丟掉播過的部分。`force` 是緩衝爆掉時的緊急回收，會連比較近的也清 */
    private recycle(force = false): void {
        const sb = this.sourceBuffer;
        const v = this.element;
        if (!sb || sb.updating) return;

        const now = performance.now();
        if (!force && now - this.lastRemoveAt < 5000) return;

        const keep = force ? 5 : KEEP_BEHIND;
        const cut = v.currentTime - keep;
        if (cut <= 0) return;

        try {
            if (sb.buffered.length && sb.buffered.start(0) < cut) {
                this.lastRemoveAt = now;
                void this.enqueue((buf) => buf.remove(0, cut));
            }
        } catch {
            // 同上，MediaSource 關掉之後讀 buffered 會丟
        }
    }

    // ---- 卡頓 ------------------------------------------------------------

    private onWaiting = (): void => {
        if (this.disposed) return;
        this.setStatus('stalled');
        this.stalls++;

        const now = performance.now();
        this.stallMarks = this.stallMarks.filter((t) => now - t < STALL_WINDOW);
        this.stallMarks.push(now);

        // 一直卡代表這個 MediaSource 已經進了壞掉的狀態（解碼器卡住、buffer 破洞）。
        // 商用播放器在這種時候一律重建而不是想辦法修——修的路徑太多而且每條都很少被走到，
        // 重建只有一條，而且天天在走
        if (this.stallMarks.length >= STALL_LIMIT) void this.rebuild();
    };

    private onPlaying = (): void => {
        if (!this.disposed) this.setStatus('playing');
    };

    private async rebuild(): Promise<void> {
        if (this.rebuilding || this.disposed) return;
        this.rebuilding = true;
        this.stallMarks = [];

        try {
            if (this.mediaSource?.readyState === 'open') this.mediaSource.endOfStream();
        } catch {
            /* 拆到一半的狀態，丟了無所謂 */
        }
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.objectUrl = null;
        this.queue = Promise.resolve();

        await this.start();
        this.rebuilding = false;
    }

    // ---- 雜項 ------------------------------------------------------------

    /** 所有 SourceBuffer 操作都得排隊：它一次只吃一個，updating 時再碰會丟 InvalidStateError */
    private enqueue(op: (sb: SourceBuffer) => void): Promise<void> {
        this.queue = this.queue.then(
            () =>
                new Promise<void>((resolve) => {
                    const sb = this.sourceBuffer;
                    if (!sb || this.disposed) return resolve();
                    const done = (): void => {
                        sb.removeEventListener('updateend', done);
                        resolve();
                    };
                    sb.addEventListener('updateend', done);
                    try {
                        op(sb);
                    } catch (e) {
                        sb.removeEventListener('updateend', done);
                        if (e instanceof Error && e.name === 'QuotaExceededError') this.recycle(true);
                        resolve();
                    }
                }),
        );
        return this.queue;
    }

    private async fetchBuffer(url: string): Promise<ArrayBuffer | null> {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${url}`);
            return await res.arrayBuffer();
        } catch (e) {
            if (!this.disposed) this.fail(e instanceof Error ? e : new Error(String(e)));
            return null;
        }
    }

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
