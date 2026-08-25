import { create } from 'zustand';
import type { ChipValue } from '../../common/chips/atlas';
import type { Phase, SeatInfo, ShoeInfo, TableSnapshot } from '../../net/games/baccarat';
import type { RoadRound } from './roadmap';
import { BET_SPOTS, type BetSpot, type Bets, type Round } from './rules';

/**
 * 百家樂這張桌的狀態。
 *
 * 跟老虎機的 store 一樣，判準是**離桌時該不該被清掉**：籌碼面額是使用者偏好（留著），
 * 桌況、牌局、路圖都屬於這張桌（離桌清掉）。
 *
 * ---
 *
 * 這一份跟單機版最大的差別：**幾乎所有欄位都是 server 寫進來的，介面只讀不寫。**
 *
 * 單機版時 `addBet` 是在本地直接加一筆，畫面立刻更新；改成多人桌之後那樣做會出事——
 * 桌上的總額是所有人的，本地先加會跟下一則推播打架，而且**押出去不能撤**，本地先加
 * 就等於在 server 還沒確認前就宣稱錢已經押了。所以下注改成「送封包 → 等 `betOk`
 * → 照 server 給的值覆蓋」，中間那段延遲由畫面上的籌碼飛行動畫蓋掉。
 */

export interface BaccaratState {
    /** 目前選中的籌碼面額。點注區時押的就是這個金額。這是使用者偏好，離桌要記得 */
    chip: ChipValue;

    phase: Phase;
    /**
     * 這個階段什麼時候結束（**已經校正過時差**的本地時間戳）。
     *
     * 存截止時刻而不是「還剩幾秒」：分頁被切到背景時計時器會被節流，靠累減的版本
     * 切回來就停在錯的數字（見 net/games/baccarat.ts 的 `phase` 封包）。
     */
    endsAt: number;
    /** 倒數秒數。由 Pixi 那側的 ticker 算好寫進來，**只在整數變了才寫** */
    secondsLeft: number;
    /** 這是這一靴的第幾局 */
    roundNo: number;

    /** 我自己這一局押了什麼。唯一寫入來源是 server 的 betOk／快照 */
    myBets: Bets;
    /** 我這一局押注總額 */
    myTotal: number;
    /** 各注區的總押注（桌上所有人）。注區角落顯示的就是它 */
    totals: Record<BetSpot, number>;

    /** 桌上有誰。座位是位置不是身分，所以整份替換 */
    seats: SeatInfo[];

    /** 上一局的牌與點數。null = 還沒看到任何一局 */
    lastRound: Round | null;
    /** 上一局淨賺多少（拿回來的減掉押出去的）。負數就是輸 */
    lastNet: number;
    /** 上一局各注區拿回多少，用來標示哪一區中了 */
    lastPayouts: Record<BetSpot, number> | null;
    /** 有沒有真的參與過一局（用來分辨「還沒玩」與「這局沒押」） */
    played: boolean;

    shoe: ShoeInfo | null;
    /** 這一靴到目前為止的結果。路圖全部從這裡推出來 */
    history: RoadRound[];

    /** 上一局我押了什麼，給「重複下注」用。結算後才寫入 */
    lastBets: Bets;

    /**
     * 玩法註冊的下注入口。跟老虎機的 spinHandler 同一個道理：動作用 handler 不用旗標。
     *
     * 面板按下去時**不會**改任何狀態，只是請 Pixi 那側送封包出去——因為只有 server
     * 說了算。
     */
    betHandler: ((spot: BetSpot, amount: number) => void) | null;

    setChip: (c: ChipValue) => void;
    applySnapshot: (snap: TableSnapshot, skew: number) => void;
    setPhase: (phase: Phase, endsAt: number, roundNo: number) => void;
    setSecondsLeft: (n: number) => void;
    setTotals: (totals: Record<BetSpot, number>) => void;
    setMyBets: (bets: Bets, totals: Record<BetSpot, number>) => void;
    setSeats: (seats: SeatInfo[]) => void;
    setResult: (round: Round, payouts: Record<BetSpot, number>, net: number) => void;
    pushHistory: (round: RoadRound, shoe: ShoeInfo, shoeChanged: boolean) => void;
    setBetHandler: (fn: ((spot: BetSpot, amount: number) => void) | null) => void;
    reset: () => void;
}

const sum = (bets: Bets): number => BET_SPOTS.reduce((n, spot) => n + (bets[spot] ?? 0), 0);

function zeroTotals(): Record<BetSpot, number> {
    const totals = {} as Record<BetSpot, number>;
    for (const spot of BET_SPOTS) totals[spot] = 0;
    return totals;
}

/** 每次進桌都從這裡開始。籌碼面額不在其中——那是使用者偏好，離桌再回來該記得。 */
const FRESH = {
    phase: 'betting' as Phase,
    endsAt: 0,
    secondsLeft: 0,
    roundNo: 0,
    myBets: {} as Bets,
    myTotal: 0,
    totals: zeroTotals(),
    seats: [] as SeatInfo[],
    lastRound: null,
    lastNet: 0,
    lastPayouts: null,
    played: false,
    shoe: null,
    history: [] as RoadRound[],
    lastBets: {} as Bets,
    betHandler: null,
};

export const useBaccaratStore = create<BaccaratState>((set, get) => ({
    ...FRESH,
    chip: 100,

    setChip: (chip) => set({ chip }),

    /**
     * 中途進桌：一次把整份桌況吃下去。
     *
     * `skew` 是 server 與本地的時差。我們的 server 就住在同一個分頁裡，這個值必定是 0——
     * 留著它是因為**換成真後端時這裡是唯一要改的地方**，而不是到時候才發現倒數全差三秒。
     */
    applySnapshot: (snap, skew) =>
        set({
            phase: snap.phase,
            endsAt: snap.endsAt - skew,
            roundNo: snap.round,
            history: snap.history,
            shoe: snap.shoe,
            seats: snap.seats,
            totals: snap.totals,
            myBets: snap.myBets,
            myTotal: sum(snap.myBets),
            lastRound: snap.openRound ?? null,
        }),

    setPhase: (phase, endsAt, roundNo) =>
        set((s) => ({
            phase,
            endsAt,
            roundNo,
            // 新的一局開始：把上一局的注與總額清掉。**不清的話注區角落會一直掛著
            // 上一局的數字**，而那個數字看起來完全合理，所以不會有人發現它是舊的
            ...(phase === 'betting' ? { myBets: {}, myTotal: 0, totals: zeroTotals() } : {}),
            // 上一局的牌留到下一局開牌前——結算後還要讓人看得到牌
            ...(phase === 'dealing' ? { lastPayouts: null } : {}),
            secondsLeft: s.secondsLeft,
        })),

    // 只有整數變了才會被呼叫（見 games/baccarat/index.ts 的 tickClock），
    // 所以這裡不必再比一次
    setSecondsLeft: (secondsLeft) => set({ secondsLeft }),

    setTotals: (totals) => set({ totals }),

    setMyBets: (myBets, totals) => set({ myBets, myTotal: sum(myBets), totals }),

    setSeats: (seats) => set({ seats }),

    setResult: (lastRound, lastPayouts, lastNet) =>
        set((s) => ({
            lastRound,
            lastPayouts,
            lastNet,
            // 「這一局我有沒有押」決定面板要顯示輸贏還是破折號。沒押的局顯示 0
            // 會被誤讀成「押了但平手」
            played: s.myTotal > 0 || s.played,
            lastBets: s.myTotal > 0 ? { ...s.myBets } : s.lastBets,
        })),

    pushHistory: (round, shoe, shoeChanged) =>
        // 換靴要把路圖清掉——路是「這一靴」的歷史，跨靴接下去沒有意義。
        // 用 server 給的旗標而不是自己從 shoe.remaining 推斷（見 net/games/baccarat.ts）
        set({ history: shoeChanged ? [] : [...get().history, round], shoe }),

    setBetHandler: (betHandler) => set({ betHandler }),

    reset: () => set({ ...FRESH, totals: zeroTotals() }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const baccaratState = () => useBaccaratStore.getState();
