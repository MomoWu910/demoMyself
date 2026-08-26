import { MseFeeder, type StreamManifest } from './MseFeeder';
import { HlsSource, PUBLIC_LIVE_URL } from './HlsSource';
import type { VideoSource, VideoSourceHandlers } from './types';

/**
 * 建立視訊來源，並在能力不足時退到下一條路。
 *
 * ## 為什麼是開場就選定，不是失敗才降級
 *
 * 商用播放器的做法是**開場用能力偵測選定一條路**（有 MSE 就走硬解，沒有就走軟解），
 * 而不是先試最好的、爆掉再換。理由在使用者那一端：先試再降級意味著玩家會先看到
 * 一段黑畫面或一次卡死，然後畫面才回來——而視訊桌台的黑畫面會被當成「這桌壞了」。
 * 能力偵測是同步的、零成本的，沒有理由不先問。
 *
 * 真正的失敗處置留給另一層：`onError` 之後由呼叫端決定換來源還是放棄，
 * 因為那時候要不要換、換去哪，是產品決定而不是播放器決定。
 */

export type SourceKind = 'dealer' | 'public';

/** 素材的位置。webpack 把 `public/` 整包複製到 `dist/public/`，所以路徑帶著 public */
const DEALER_BASE = 'public/live/table01';

/**
 * 荷官流的 manifest。
 *
 * 用 fetch 拉而不是 import 進 bundle：manifest 裡有 `epoch`，那個值在**生成素材時**
 * 就定了，重新生成一次就會變。編進 bundle 的話，換素材得重新打包整個站；放外面則是
 * 換完檔案重整就生效——而這正是真實直播的樣子，播放器不該知道內容什麼時候換。
 */
export async function loadDealerManifest(base = DEALER_BASE): Promise<StreamManifest> {
    const res = await fetch(`${base}/manifest.json`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const raw = (await res.json()) as StreamManifest;
    return {
        ...raw,
        initUrl: `${base}/${raw.initUrl}`,
        segments: raw.segments.map((s) => ({ ...s, url: `${base}/${s.url}` })),
    };
}

/** 這個瀏覽器能不能走自寫 MSE 那條路 */
export function canFeedMse(mimeCodec: string): boolean {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mimeCodec);
}

/**
 * 建一個來源。
 *
 * `dealer` 走自寫的 MSE 餵流；瀏覽器不支援時退到同一份素材的 HLS playlist
 * ——**切片是同一批**，只是換一個播放器去讀，所以退路不需要另一份素材。
 */
export async function createSource(kind: SourceKind, handlers: VideoSourceHandlers = {}): Promise<VideoSource> {
    if (kind === 'public') return new HlsSource(PUBLIC_LIVE_URL, handlers);

    const manifest = await loadDealerManifest();
    if (canFeedMse(manifest.mimeCodec)) return new MseFeeder(manifest, handlers);

    // 退路。畫面一樣，延遲會變差——延遲儀表會誠實地顯示這件事
    return new HlsSource(`${DEALER_BASE}/index.m3u8`, handlers);
}

export { PUBLIC_LIVE_URL };
