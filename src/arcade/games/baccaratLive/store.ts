import { create } from 'zustand';
import type { ChipValue } from '../../common/chips/atlas';
import type { SourceKind } from '../../common/video/sources';
import type { VideoStats, VideoStatus } from '../../common/video/types';
import type { LivePhase } from '../../live/schedule';
import type { RoadRound } from '../baccarat/roadmap';
import { BET_SPOTS, type BetSpot, type Bets, type Round } from '../baccarat/rules';

/**
 * 視訊桌台的狀態。
 *
 * 跟數位百家樂的 store 一樣，桌況全部由 server 寫進來，介面只讀。多出來的是
 * **串流的即時讀數**——延遲、緩衝、倍速、卡頓次數。
 *
 * 那些數字放進 store 而不是留在播放層裡，是因為它們是**這一頁要展示的主體之一**：
 * 一般播放器把延遲當實作細節藏起來，但在視訊博弈裡它是產品規格——延遲多少決定
 * 下注截止要提前幾秒。攤在畫面上才講得清楚兩條線路差在哪。
 *
 * 接上下注之後，`latency` 又多了一個身分：**它是唯一同時屬於播放層與玩法層的數字。**
 * 注區能不能點由 `phase` 決定（server 說了算），但玩家有沒有意識到自己快來不及了，
 * 只有延遲能回答（見 index.ts 的延遲區）。
 */
export interface LiveState {
    /** 現在接的是哪條線路 */
    source: SourceKind;
    status: VideoStatus;
    /** 串流讀數。**節流寫入**（見 index.ts 的 STAT_INTERVAL），不是每幀 */
    stats: VideoStats;
    /** 播放層報上來的錯誤，給面板顯示 */
    error: string | null;

    phase: LivePhase;
    /** 這個階段什麼時候結束（已校正時差的本地時間戳） */
    endsAt: number;
    /** 倒數秒數。整數變了才寫，否則每幀都會重繪整個 React 面板 */
    secondsLeft: number;
    /** 循環素材裡的第幾局 */
    roundNo: number;

    /** 這一局開完的結果。下一局開始時清掉 */
    result: Round | null;
    /** 路圖的歷史 */
    history: RoadRound[];

    /** 目前選中的籌碼面額。這是使用者偏好，離桌要記得 */
    chip: ChipValue;
    /** 我自己這一局押了什麼。唯一寫入來源是 server 的 betOk／快照 */
    myBets: Bets;
    /** 我這一局押注總額 */
    myTotal: number;
    /** 各注區的總押注（桌上所有人）。注區角落顯示的就是它 */
    totals: Record<BetSpot, number>;

    /** 上一局淨賺多少（拿回來的減掉押出去的）。負數就是輸 */
    lastNet: number;
    /** 上一局各注區拿回多少，用來標示哪一區中了 */
    lastPayouts: Record<BetSpot, number> | null;
    /** 有沒有真的參與過一局（用來分辨「還沒玩」與「這局沒押」） */
    played: boolean;
    /** 上一局我押了什麼，給「重複下注」用。結算後才寫入 */
    lastBets: Bets;

    /**
     * 玩法註冊的下注入口。跟老虎機的 spinHandler 同一個道理：動作用 handler 不用旗標。
     *
     * 面板按下去時**不會**改任何狀態，只是請 Pixi 那側送封包出去——因為只有 server
     * 說了算。
     */
    betHandler: ((spot: BetSpot, amount: number) => void) | null;
}

const EMPTY_STATS: VideoStats = { latency: 0, buffered: 0, playbackRate: 1, stalls: 0, jumps: 0 };

export function zeroTotals(): Record<BetSpot, number> {
    const totals = {} as Record<BetSpot, number>;
    for (const spot of BET_SPOTS) totals[spot] = 0;
    return totals;
}

export const sumBets = (bets: Bets): number => BET_SPOTS.reduce((n, spot) => n + (bets[spot] ?? 0), 0);

/** 每次進桌都從這裡開始。籌碼面額不在其中——那是使用者偏好，離桌再回來該記得 */
const FRESH = {
    status: 'idle' as VideoStatus,
    stats: EMPTY_STATS,
    error: null,
    phase: 'betting' as LivePhase,
    endsAt: 0,
    secondsLeft: 0,
    roundNo: 0,
    result: null,
    history: [] as RoadRound[],
    myBets: {} as Bets,
    myTotal: 0,
    lastNet: 0,
    lastPayouts: null,
    played: false,
    lastBets: {} as Bets,
    betHandler: null,
};

export const useLiveStore = create<LiveState>(() => ({
    ...FRESH,
    source: 'dealer',
    chip: 100,
    totals: zeroTotals(),
}));

/** Pixi 那側直接寫這裡。跟其他玩法一樣，繞開 React 的 setState 批次 */
export const liveState = {
    set: useLiveStore.setState,
    get: useLiveStore.getState,
    reset(): void {
        useLiveStore.setState({ ...FRESH, totals: zeroTotals() });
    },
};
