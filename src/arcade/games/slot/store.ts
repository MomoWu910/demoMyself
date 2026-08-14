import { create } from 'zustand';
import type { WinLine } from '../../net/games/slot';
import type { SpinStyle } from './reel';
import type { StopOrder } from './stopOrder';

/**
 * 老虎機自己的狀態。
 *
 * 跟外殼的 store（../../store.ts）分開，判準是**換玩法時它該不該被重設**：
 * 餘額與連線要延續，所以住在外殼；押注額、轉動中、起轉演法只在這張桌上有意義，
 * 所以住在這裡，玩法卸載時整份跟著失效。
 *
 * 這也是 canvas 內外的橋：React 面板（ui/SlotPanel.tsx）與 Pixi 玩法（index.ts）
 * 都只跟這份說話，彼此不持有參考。
 */

export interface SlotState {
    /** 這一把押多少 */
    bet: number;
    /** 轉軸是否正在轉（含等待封包與煞停）。按鈕靠它上鎖，避免連按送出兩次 spin。 */
    spinning: boolean;
    /** 上一把贏多少。0 = 沒中。 */
    lastWin: number;
    lastWins: WinLine[];

    /**
     * 起轉的演法。**純粹是表演，不影響任何結果**——盤面照樣是 server 算的。
     *
     * 放在共享狀態而不是玩法內部，是因為它要能在面板上當場切換來對比手感。
     * 型別直接沿用轉軸自己的定義（type-only import，不會產生執行期相依）：
     * 這種選項最怕兩邊各寫一份字串常數，加第三種轉法時漏改一邊就會靜默失效。
     */
    spinStyle: SpinStyle;

    /**
     * 停軸的順序演法。跟 spinStyle 一樣是**純表演**，換順序不會換掉盤面——
     * 五根軸的內容在收到封包的當下就定了，順序只決定它們用什麼次序演出來。
     */
    stopOrder: StopOrder;

    /**
     * 目前掛載的玩法向 store 註冊的「請轉一把」入口。
     *
     * 用 handler 而不是用旗標，是因為 spin 是**動作**不是狀態：用旗標的話 React 設 true、
     * 玩法看到後要記得設回 false，中間任何一次沒對上就會變成連轉兩把或轉不動。
     * 玩法卸載時把它設回 null，按鈕自動失效。
     */
    spinHandler: (() => void) | null;

    setBet: (n: number) => void;
    setSpinning: (v: boolean) => void;
    setResult: (win: number, wins: WinLine[]) => void;
    setSpinHandler: (fn: (() => void) | null) => void;
    setSpinStyle: (s: SpinStyle) => void;
    setStopOrder: (o: StopOrder) => void;
    /** 玩法卸載時把這張桌的狀態清乾淨，下次進來不會看到上一輪的殘影 */
    reset: () => void;
}

/** 可選的押注額。 */
export const BETS = [50, 100, 250, 500, 1000];

/** 面板上可選的起轉演法。加第三種轉法時只要動這裡與 reel.ts 的 SpinStyle。 */
export const SPIN_STYLES: SpinStyle[] = ['direct', 'windup'];

// 停軸順序的清單由 stopOrder.ts 自己維護（那裡才知道有哪幾種），這裡轉出去讓面板
// 跟 BETS、SPIN_STYLES 走同一個入口——面板不必知道每個選項各自住在哪支檔案。
export { STOP_ORDERS } from './stopOrder';

/** 每次進桌都從這裡開始。表演選項不在其中——那是使用者的偏好，離桌再回來該記得。 */
const FRESH = {
    bet: BETS[1],
    spinning: false,
    lastWin: 0,
    lastWins: [] as WinLine[],
    spinHandler: null,
};

export const useSlotStore = create<SlotState>((set) => ({
    ...FRESH,
    spinStyle: 'windup',
    stopOrder: 'left',

    setBet: (bet) => set({ bet }),
    setSpinning: (spinning) => set({ spinning }),
    setResult: (lastWin, lastWins) => set({ lastWin, lastWins }),
    setSpinHandler: (spinHandler) => set({ spinHandler }),
    setSpinStyle: (spinStyle) => set({ spinStyle }),
    setStopOrder: (stopOrder) => set({ stopOrder }),
    reset: () => set({ ...FRESH }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const slotState = () => useSlotStore.getState();
