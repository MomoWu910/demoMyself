import { create } from 'zustand';
import type { DisposeReport } from './core/module';
import type { SocketState } from './net/fakeSocket';
import type { GameId } from './net/protocol';

/**
 * 遊樂場的**外殼**狀態：跟玩哪一款無關的那些東西。
 *
 * 分工跟 Shader Lab 同一套：React 管 canvas 外，Pixi 管 canvas 內，兩邊都只跟 store
 * 說話、不互相持有參考——玩法模組被卸載時，React 那半邊不需要知道，也不會抓著死掉的
 * Pixi 物件。
 *
 * **玩法自己的狀態不放這裡**（老虎機的押注、轉動中、起轉演法住在 games/slot/store.ts）。
 * 這個切法的理由跟協定分家一樣：全塞在同一份 store 的話，百家樂的面板看得到
 * `spinStyle`、老虎機看得到牌桌的欄位，久了就會有人「順手」讀對面的欄位，
 * 兩款玩法從此拆不開。留在這裡的判準只有一個——**換玩法時它不該被重設**。
 *
 * 餘額**只由伺服器封包寫入**，介面上的任何操作都不直接改它（見 net/protocol.ts）。
 */

export interface ArcadeState {
    connection: SocketState;
    /** 餘額。唯一的寫入來源是 server 封包。跨玩法延續，因為它屬於帳號不屬於桌台。 */
    balance: number;
    /** 伺服器回的錯誤代碼（餘額不足等），顯示完就清掉。翻譯在 UI 那側才發生。 */
    error: string | null;

    /** 目前在玩哪一款；`null` = 在大廳。HUD 靠它決定要掛哪一組面板。 */
    game: GameId | null;

    /**
     * 上一次卸載玩法的資源核對結果（見 core/module.ts）。
     *
     * 放進共享狀態是因為**這一頁最該被看見的就是這個數字**：切了幾輪玩法之後
     * texture 有沒有回到基線、有沒有東西沒還。藏在 console 裡等於沒做。
     */
    lastDispose: DisposeReport | null;

    setConnection: (s: SocketState) => void;
    setBalance: (n: number) => void;
    setError: (msg: string | null) => void;
    setGame: (g: GameId | null) => void;
    setLastDispose: (r: DisposeReport | null) => void;
}

export const useArcadeStore = create<ArcadeState>((set) => ({
    connection: 'connecting',
    balance: 0,
    error: null,
    game: null,
    lastDispose: null,

    setConnection: (connection) => set({ connection }),
    setBalance: (balance) => set({ balance }),
    setError: (error) => set({ error }),
    setGame: (game) => set({ game }),
    setLastDispose: (lastDispose) => set({ lastDispose }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const arcadeState = () => useArcadeStore.getState();
