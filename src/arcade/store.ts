import { create } from 'zustand';
import type { SpinStyle } from './games/slot/reel';
import type { SocketState } from './net/fakeSocket';
import type { WinLine } from './net/protocol';

/**
 * 遊樂場的共享狀態——**canvas 外的 React 面板與 canvas 內的 Pixi 玩法之間唯一的橋**。
 *
 * 分工跟 Shader Lab 同一套：React 管 canvas 外（餘額、押注、按鈕、連線狀態），
 * Pixi 管 canvas 內（轉軸、中獎演出）。兩邊都只跟這個 store 說話，不互相持有參考——
 * 玩法模組被卸載時，React 那半邊不需要知道，也不會抓著死掉的 Pixi 物件。
 *
 * 餘額**只由伺服器封包寫入**，介面上的任何操作都不直接改它（見 net/protocol.ts）。
 */

export interface ArcadeState {
    connection: SocketState;
    /** 餘額。唯一的寫入來源是 server 封包。 */
    balance: number;
    /** 這一把押多少 */
    bet: number;
    /** 轉軸是否正在轉（含等待封包與煞停）。按鈕靠它上鎖，避免連按送出兩次 spin。 */
    spinning: boolean;
    /** 上一把贏多少。0 = 沒中。 */
    lastWin: number;
    lastWins: WinLine[];
    /** 伺服器回的錯誤（餘額不足等），顯示完就清掉 */
    error: string | null;

    /**
     * 起轉的演法。**純粹是表演，不影響任何結果**——盤面照樣是 server 算的。
     *
     * 放在共享狀態而不是玩法內部，是因為它要能在面板上當場切換來對比手感。
     * 型別直接沿用轉軸自己的定義（type-only import，不會產生執行期相依）：
     * 這種選項最怕兩邊各寫一份字串常數，加第三種轉法時漏改一邊就會靜默失效。
     */
    spinStyle: SpinStyle;

    /**
     * 目前掛載的玩法向 store 註冊的「請轉一把」入口。
     *
     * 用 handler 而不是用旗標，是因為 spin 是**動作**不是狀態：用旗標的話 React 設 true、
     * 玩法看到後要記得設回 false，中間任何一次沒對上就會變成連轉兩把或轉不動。
     * 玩法卸載時把它設回 null，按鈕自動失效。
     */
    spinHandler: (() => void) | null;

    setConnection: (s: SocketState) => void;
    setBalance: (n: number) => void;
    setBet: (n: number) => void;
    setSpinning: (v: boolean) => void;
    setResult: (win: number, wins: WinLine[]) => void;
    setError: (msg: string | null) => void;
    setSpinHandler: (fn: (() => void) | null) => void;
    setSpinStyle: (s: SpinStyle) => void;
}

/** 可選的押注額。 */
export const BETS = [50, 100, 250, 500, 1000];

/** 面板上可選的起轉演法。加第三種轉法時只要動這裡與 reel.ts 的 SpinStyle。 */
export const SPIN_STYLES: SpinStyle[] = ['direct', 'windup'];

export const useArcadeStore = create<ArcadeState>((set) => ({
    connection: 'connecting',
    balance: 0,
    bet: BETS[1],
    spinning: false,
    lastWin: 0,
    lastWins: [],
    error: null,
    spinHandler: null,
    spinStyle: 'windup',

    setConnection: (connection) => set({ connection }),
    setBalance: (balance) => set({ balance }),
    setBet: (bet) => set({ bet }),
    setSpinning: (spinning) => set({ spinning }),
    setResult: (lastWin, lastWins) => set({ lastWin, lastWins }),
    setError: (error) => set({ error }),
    setSpinHandler: (spinHandler) => set({ spinHandler }),
    setSpinStyle: (spinStyle) => set({ spinStyle }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const arcadeState = () => useArcadeStore.getState();
