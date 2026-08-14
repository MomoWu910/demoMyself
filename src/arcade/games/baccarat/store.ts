import { create } from 'zustand';
import type { ChipValue } from '../../common/chips/atlas';
import type { ShoeInfo } from '../../net/games/baccarat';
import type { RoadRound } from './roadmap';
import { BET_SPOTS, type BetSpot, type Bets, type Round } from './rules';

/**
 * 百家樂這張桌的狀態。
 *
 * 跟老虎機的 store 一樣，判準是**離桌時該不該被清掉**：籌碼面額是使用者偏好（留著），
 * 下注、牌局、這一靴的歷史都屬於這張桌（離桌清掉）。
 *
 * 這一款比老虎機多了一個東西：**局的階段**。老虎機只有「轉／沒轉」，百家樂有下注、
 * 發牌、結算三段，而且每一段能做的事不同。用一個 phase 而不是幾個布林，是因為
 * 布林組合會生出不存在的狀態（「正在發牌又可以下注」），那種狀態一旦被寫出來，
 * 就會有人在某個分支裡真的走到。
 */

export type Phase = 'betting' | 'dealing' | 'result';

export interface BaccaratState {
    /** 目前選中的籌碼面額。點注區時加的就是這個金額。 */
    chip: ChipValue;
    /** 各注區押了多少 */
    bets: Bets;
    /** 這一局押注總額。每次改注時一起算好，面板不必自己加總 */
    totalBet: number;

    phase: Phase;

    /** 上一局的牌與點數。null = 還沒打過 */
    lastRound: Round | null;
    /** 上一局淨賺多少（拿回來的減掉押出去的）。負數就是輸 */
    lastNet: number;
    /** 上一局各注區拿回多少，用來標示哪一區中了 */
    lastPayouts: Record<BetSpot, number> | null;

    shoe: ShoeInfo | null;
    /** 這一靴到目前為止的結果。路圖全部從這裡推出來 */
    history: RoadRound[];

    /** 上一局的押注，給「重複下注」用。結算後才寫入 */
    lastBets: Bets;

    /** 玩法註冊的「發牌」入口。跟老虎機的 spinHandler 同一個道理：動作用 handler 不用旗標 */
    dealHandler: (() => void) | null;

    setChip: (c: ChipValue) => void;
    addBet: (spot: BetSpot, amount: number) => void;
    clearBets: () => void;
    repeatBets: () => void;
    setPhase: (p: Phase) => void;
    setTable: (history: RoadRound[], shoe: ShoeInfo) => void;
    setResult: (round: Round, payouts: Record<BetSpot, number>, net: number) => void;
    pushHistory: (round: RoadRound, shoe: ShoeInfo, shoeChanged: boolean) => void;
    setDealHandler: (fn: (() => void) | null) => void;
    reset: () => void;
}

const sum = (bets: Bets): number => BET_SPOTS.reduce((n, spot) => n + (bets[spot] ?? 0), 0);

/** 每次進桌都從這裡開始。籌碼面額不在其中——那是使用者偏好，離桌再回來該記得。 */
const FRESH = {
    bets: {} as Bets,
    totalBet: 0,
    phase: 'betting' as Phase,
    lastRound: null,
    lastNet: 0,
    lastPayouts: null,
    shoe: null,
    history: [] as RoadRound[],
    lastBets: {} as Bets,
    dealHandler: null,
};

export const useBaccaratStore = create<BaccaratState>((set, get) => ({
    ...FRESH,
    chip: 100,

    setChip: (chip) => set({ chip }),

    addBet: (spot, amount) => {
        // 只有下注階段能改注。這一層擋住的是「結果都出來了還在加注」——
        // server 那邊當然也擋，但等 RTT 回來才說不行，體感上就像卡住
        if (get().phase !== 'betting') return;
        const bets = { ...get().bets, [spot]: (get().bets[spot] ?? 0) + amount };
        set({ bets, totalBet: sum(bets) });
    },

    clearBets: () => {
        if (get().phase !== 'betting') return;
        set({ bets: {}, totalBet: 0 });
    },

    repeatBets: () => {
        if (get().phase !== 'betting') return;
        const bets = { ...get().lastBets };
        set({ bets, totalBet: sum(bets) });
    },

    setPhase: (phase) => set({ phase }),

    setTable: (history, shoe) => set({ history, shoe }),

    setResult: (lastRound, lastPayouts, lastNet) =>
        set({ lastRound, lastPayouts, lastNet, lastBets: get().bets }),

    pushHistory: (round, shoe, shoeChanged) =>
        // 換靴要把路圖清掉——路是「這一靴」的歷史，跨靴接下去沒有意義。
        // 用 server 給的旗標而不是自己從 shoe.remaining 推斷（見 net/games/baccarat.ts）
        set({ history: shoeChanged ? [] : [...get().history, round], shoe }),

    setDealHandler: (dealHandler) => set({ dealHandler }),

    reset: () => set({ ...FRESH }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const baccaratState = () => useBaccaratStore.getState();
