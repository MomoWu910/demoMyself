/**
 * 視訊來源的共同契約。
 *
 * 這一層存在的理由跟 `core/module.ts` 是同一個家族的：**上層不該知道畫面是怎麼來的。**
 * 荷官桌只需要「一個會動的 `<video>`、一個能問的延遲、一個會出聲的錯誤」，至於底下是
 * 自己寫的 MSE 餵流還是包了一層 hls.js，是這一層的事。
 *
 * 為什麼要有兩種實作而不是挑一種做完：**它們證明的是不同的東西。**
 * 自寫的那條證明得出「延遲是可以被設計的」——buffer 深度、追趕策略、時間軸拼接
 * 全部在自己手上；包 hls.js 的那條證明得出「吃得下真實 CDN 的滾動 playlist」。
 * 少了任何一條，另一條都會被問「那換成真的呢／那你只是會用套件吧」。
 */

/**
 * 播放狀態。
 *
 * 只有四個，而且**沒有 `paused`**——直播沒有暫停這回事，玩家按下的暫停在真實桌台上
 * 對應的是「不看了」，那是卸載不是暫停。留一個永遠不會被正確處理的狀態，只會讓
 * 上層多寫一條死掉的分支。
 */
export type VideoStatus =
    /** 還沒開始要資料 */
    | 'idle'
    /** 要了但還沒能播（拉 init、等第一段、解碼器暖機） */
    | 'loading'
    /** 畫面在動 */
    | 'playing'
    /** 曾經在動，現在卡住等資料。跟 loading 分開是因為**處置方式不同**：
     *  loading 要等，stalled 要開始數次數，數超了就重建 */
    | 'stalled'
    /** 沒救了，要上層決定換來源還是放棄 */
    | 'failed';

/**
 * 來源回報的即時統計。
 *
 * 這些數字不是為了好看——**延遲儀表是這一頁要展示的主體之一**。一般播放器把延遲藏起來
 * 當實作細節，但在視訊博弈裡它是產品規格：延遲多少決定下注截止要提前幾秒。
 */
export interface VideoStats {
    /**
     * 目前落後直播前緣多少秒。
     *
     * 「前緣」對兩種來源的定義不同（自寫的是牆鐘算出來的位置，HLS 是 playlist 的最後一段），
     * 但**對上層一律是同一個意思**：畫面比現場慢了多少。
     */
    latency: number;
    /** 緩衝在手上還有幾秒。太小會卡，太大就是延遲的來源 */
    buffered: number;
    /** 現在的播放倍速。追趕時會 > 1，是策略正在生效的證據 */
    playbackRate: number;
    /** 累計卡頓次數。重建播放器後歸零 */
    stalls: number;
    /** 累計因為落後太多而硬跳的次數 */
    jumps: number;
}

/** 追趕策略的參數。兩種來源共用同一組，因為它們要展示的是同一件事。 */
export interface CatchUpConfig {
    /**
     * 想維持的延遲（秒）。
     *
     * 不是越小越好：緩衝深度就是抗抖動的本錢，壓到 0.5 秒以下時網路稍微一頓就卡給你看。
     * 商用視訊桌台實測落在 1~3 秒這個區間，我們取偏低的那頭。
     */
    target: number;
    /**
     * 開始追趕的門檻（秒）。
     *
     * 跟 `target` 分開是為了留一條**不動作帶**：只要落在 target~catchUpAt 之間就什麼都不做。
     * 沒有這條帶，playbackRate 會在 1.0 與 1.1 之間來回抖，畫面的節奏跟著忽快忽慢，
     * 比延遲本身還難看。
     */
    catchUpAt: number;
    /** 追趕時的最低倍速。低於這個追不動，玩家只覺得畫面怪 */
    minRate: number;
    /**
     * 追趕時的最高倍速。
     *
     * 1.5 是上限而不是「越快越好」：再高上去畫面會明顯像快轉，而荷官的手速一旦看起來
     * 不自然，玩家的第一個念頭是「這是假的／被動手腳」——在博弈場景裡那比延遲嚴重得多。
     */
    maxRate: number;
    /**
     * 放棄追趕、直接跳到前緣的門檻（秒）。
     *
     * 落後這麼多時用倍速追要等上十幾秒才追得回來，那段時間玩家看的是一個又慢又快轉的
     * 畫面，兩頭都不討好。**不如認賠跳過去**：跳一次是一瞬間的不連續，追一次是十幾秒的難受。
     */
    flushAt: number;
}

export const DEFAULT_CATCH_UP: CatchUpConfig = {
    target: 1.5,
    catchUpAt: 2.5,
    minRate: 1.1,
    maxRate: 1.5,
    flushAt: 6,
};

/** 來源丟出來的事件。用 callback 而不是 EventTarget，因為訂閱者只有一個（VideoLayer） */
export interface VideoSourceHandlers {
    onStatus?(status: VideoStatus): void;
    /** 拿到影像尺寸。要等到這時候才知道畫面該怎麼擺 */
    onMetadata?(width: number, height: number): void;
    onError?(err: Error): void;
}

/**
 * 一個視訊來源。
 *
 * 注意 `element` 是**來源自己建的**，不是外面塞進來的：自寫 MSE 那條要在 `<video>` 上
 * 掛一整套 MediaSource 的生命週期，HLS 那條在 iOS 上還可能整個換成原生播放路徑——
 * 讓外面持有一個它管不到生命週期的元素，等於把最容易漏的東西交給最不知情的人。
 */
export interface VideoSource {
    readonly kind: 'mse' | 'hls';
    /** 給 VideoLayer 貼進畫面用。整個生命週期由來源自己負責 */
    readonly element: HTMLVideoElement;
    readonly status: VideoStatus;

    start(): Promise<void>;
    /** 每幀被叫一次，追趕策略在這裡跑。回傳當下的統計，順便給延遲儀表 */
    tick(): VideoStats;
    destroy(): void;
}
