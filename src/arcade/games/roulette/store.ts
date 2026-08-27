import { create } from 'zustand';
import type { ChipValue } from '../../common/chips/atlas';
import type { SeatInfo } from '../../net/games/baccarat';
import type { Phase, SpinOutcome } from '../../net/games/roulette';
import type { Bets } from './rules';

/**
 * 輪盤桌的狀態。
 *
 * 跟另外兩張桌一樣：**桌況全部由 server 寫進來，介面只讀**。這一款多出來的是
 * `spin`——它是唯一一個「結果已經知道、但還不能給玩家看」的欄位。
 *
 * 它為什麼還是得住在 store：球要跑十秒，這十秒之內玩家可能切分頁、可能轉螢幕方向，
 * 畫面要能從任何一個時間點重建。把它藏在 Pixi 那側的區域變數裡，重排一次就沒了。
 * 「知道但不顯示」的責任因此落在畫面層——中獎號碼只有在球停下來之後才會被寫進 `winning`。
 */
export interface RouletteState {
    phase: Phase;
    endsAt: number;
    secondsLeft: number;
    roundNo: number;

    /** 這一趟的球（含 server 給的中獎號碼）。**不要拿它提前顯示答案** */
    spin: SpinOutcome | null;
    /** 球已經停下來、可以公布的號碼。結算封包到了才寫 */
    winning: number | null;
    /** 最近開出的號碼，新的在前。看板與冷熱統計吃它 */
    history: number[];

    chip: ChipValue;
    myBets: Bets;
    myTotal: number;
    /** 桌上所有人的注（含散客）。每個位置角落的數字 */
    totals: Bets;
    seats: SeatInfo[];

    lastNet: number;
    /** 上一局哪些注中了（含本金的回本額）。用來在桌布上標出中獎的位置 */
    lastPayouts: Bets | null;
    played: boolean;
    /** 上一局我押了什麼，給「重複下注」用 */
    lastBets: Bets;

    /** 下注入口。按下去不改任何狀態，只是請 Pixi 那側送封包——只有 server 說了算 */
    betHandler: ((key: string, amount: number) => void) | null;
    /** 重複上一局的注 */
    repeatHandler: (() => void) | null;
}

export const sumBets = (bets: Bets): number => Object.values(bets).reduce((n, v) => n + v, 0);

const FRESH = {
    phase: 'betting' as Phase,
    endsAt: 0,
    secondsLeft: 0,
    roundNo: 0,
    spin: null,
    winning: null,
    history: [] as number[],
    myBets: {} as Bets,
    myTotal: 0,
    totals: {} as Bets,
    seats: [] as SeatInfo[],
    lastNet: 0,
    lastPayouts: null,
    played: false,
    lastBets: {} as Bets,
    betHandler: null,
    repeatHandler: null,
};

export const useRouletteStore = create<RouletteState>(() => ({ ...FRESH, chip: 100 }));

export const rouletteState = {
    set: useRouletteStore.setState,
    get: useRouletteStore.getState,
    reset(): void {
        useRouletteStore.setState({ ...FRESH });
    },
};
