import type { CatchUpConfig } from './types';

/**
 * 循環素材的時間軸換算，以及追趕策略的決策——**全部是純函式，不碰 DOM。**
 *
 * 抽出來不是為了好看：這些是「眼睛看不出來」的那一類東西。畫面上追趕生效與否只差
 * 那麼一點速度感，落後八秒該跳還是該磨更是完全看不出來，但算錯的後果是玩家的畫面
 * 永遠對不上桌況。**這種東西一律搬到 Node 驗**（見 video-check.mjs），跟老虎機的停軸
 * 落點、百家樂的 RTP 是同一個處置。
 *
 * 名詞先講定，底下三個時間軸很容易混：
 *
 * - **全域時間**：從這條直播的 epoch 起算過了幾秒。一直長大，跨圈不歸零。唯一的權威。
 * - **素材內位置**：全域時間對素材總長取餘數，落在 0 ~ lapDuration 之間。
 * - **media time**：`video.currentTime` 的空間。從觀眾自己接上的那一刻起算，所以
 *   跟全域時間差一個固定位移（`baseGlobal`）。
 */

/** 每段在素材內的起始時間。切片不等長（最後一段幾乎一定不是），所以得是累積表而非乘法 */
export function segmentStarts(durations: readonly number[]): number[] {
    const starts: number[] = [];
    let acc = 0;
    for (const d of durations) {
        starts.push(acc);
        acc += d;
    }
    return starts;
}

export function lapDuration(durations: readonly number[]): number {
    let acc = 0;
    for (const d of durations) acc += d;
    return acc;
}

/**
 * 全域序號 → 該段在全域時間軸上的起點。
 *
 * 序號跨圈遞增（第 n 段之後是第 n 段，不是回到 0），所以圈數是除出來的。
 */
export function globalStartOf(index: number, starts: readonly number[], lap: number): number {
    const n = starts.length;
    const laps = Math.floor(index / n);
    return laps * lap + starts[index % n];
}

/**
 * 全域時間落在第幾段（全域序號）。
 *
 * 這是「加入一場正在進行的直播」的關鍵一步：新觀眾不從第 0 段開始，而是從牆鐘算出來的
 * 那一段開始。**所有人算出同一個答案，所以所有人看到同一格畫面。**
 */
export function indexAt(globalTime: number, starts: readonly number[], lap: number): number {
    const n = starts.length;
    const laps = Math.floor(globalTime / lap);
    const inLap = globalTime - laps * lap;
    let i = 0;
    while (i + 1 < n && starts[i + 1] <= inLap) i++;
    return laps * n + i;
}

/**
 * 第 index 段要 append 時該設的 `timestampOffset`。
 *
 * 推導：這段在 media timeline 上該落的起點是 `globalStartOf(index) - baseGlobal`，
 * 而切片自己帶的時間戳是 `starts[index % n]`（ffmpeg 切片沿用原始 pts）。兩者相減，
 * `starts` 項消掉，只剩圈數——**所以循環播放的時間軸拼接只跟「第幾圈」有關**，
 * 跟切在哪裡、每段多長都無關。
 */
export function timestampOffsetFor(index: number, starts: readonly number[], lap: number, baseGlobal: number): number {
    const laps = Math.floor(index / starts.length);
    return laps * lap - baseGlobal;
}

/** 追趕策略這一幀的決定 */
export type CatchUpAction =
    /** 什麼都不做。落在不動作帶裡，或已經是 1.0 倍速 */
    | { kind: 'hold' }
    /** 調整倍速磨回來 */
    | { kind: 'rate'; rate: number }
    /** 落後太多，直接跳到目標點 */
    | { kind: 'jump'; to: number };

/**
 * 決定這一幀要怎麼追。
 *
 * 三段而不是兩段：`hold` 那一段（target ~ catchUpAt）是**刻意留的不動作帶**。
 * 沒有它，倍速會在 1.0 與 1.1 之間來回抖——延遲一降到門檻下就收回 1.0，收回之後
 * 延遲又慢慢爬過門檻，於是每隔一兩秒抖一次。畫面的節奏忽快忽慢比延遲本身還難看。
 *
 * @param latency    現在落後前緣幾秒
 * @param rate       目前的播放倍速，用來判斷「該不該收回 1.0」
 * @param targetTime 要跳的話跳到 media timeline 的哪一秒
 */
export function decideCatchUp(latency: number, rate: number, targetTime: number, cfg: CatchUpConfig): CatchUpAction {
    if (!Number.isFinite(latency)) return { kind: 'hold' };

    if (latency > cfg.flushAt) return { kind: 'jump', to: targetTime };

    if (latency > cfg.catchUpAt) {
        // 落後越多踩越快，但夾在 min~max 之間。線性而不是直接給 maxRate，是為了讓
        // 追趕結束時是慢慢收回 1.0，而不是一刀切回去——一刀切回去看得出來
        const over = latency - cfg.catchUpAt;
        const span = Math.max(1e-3, cfg.flushAt - cfg.catchUpAt);
        return { kind: 'rate', rate: cfg.minRate + (cfg.maxRate - cfg.minRate) * Math.min(1, over / span) };
    }

    if (latency < cfg.target && rate !== 1) return { kind: 'rate', rate: 1 };

    return { kind: 'hold' };
}

/** 一段連續的緩衝區間。`TimeRanges` 攤平成這個形狀才驗得動 */
export interface BufferRange {
    start: number;
    end: number;
}

/**
 * 播放位置之後手上還有幾秒沒播。
 *
 * 看起來只是一句減法，實際上有個很容易寫錯的邊：**播放位置可能還沒進入第一段緩衝。**
 * fMP4 切片的第一個 sample 時間戳通常不是精確的 0（編碼器會帶一點 pts offset），
 * 所以剛接上時 `buffered` 是 `[0.1, 2.1]` 而 `currentTime` 還是 0——用「哪一段涵蓋
 * currentTime」去找會一段都找不到，回傳 0。
 *
 * 這個 0 的後果不是少算一點：**餵料的上限是靠它擋的**，一直回 0 就等於沒有上限。
 * 實測是啟動那幾百毫秒內一口氣灌進 14 段、28 秒的緩衝，而設計值是 4 秒——
 * 緩衝深度就是延遲，那條線一旦破掉，低延遲這件事就不成立了。
 *
 * 所以三種情形都要算對：位置在某段之內、位置還在第一段之前、位置已經超過所有段。
 */
export function bufferedAhead(ranges: readonly BufferRange[], currentTime: number): number {
    for (const { start, end } of ranges) {
        if (end <= currentTime) continue; // 已經播過的段，跳過
        // 位置在段前面的話，整段都還沒播——這就是啟動瞬間的情形
        return end - Math.max(currentTime, start);
    }
    return 0;
}
