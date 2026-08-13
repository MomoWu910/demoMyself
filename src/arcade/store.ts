import { create } from 'zustand';
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
}

/** 可選的押注額。 */
export const BETS = [50, 100, 250, 500, 1000];

export const useArcadeStore = create<ArcadeState>((set) => ({
    connection: 'connecting',
    balance: 0,
    bet: BETS[1],
    spinning: false,
    lastWin: 0,
    lastWins: [],
    error: null,
    spinHandler: null,

    setConnection: (connection) => set({ connection }),
    setBalance: (balance) => set({ balance }),
    setBet: (bet) => set({ bet }),
    setSpinning: (spinning) => set({ spinning }),
    setResult: (lastWin, lastWins) => set({ lastWin, lastWins }),
    setError: (error) => set({ error }),
    setSpinHandler: (spinHandler) => set({ spinHandler }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const arcadeState = () => useArcadeStore.getState();
