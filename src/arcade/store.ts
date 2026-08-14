import { create } from 'zustand';
import type { DisposeReport, ModuleId } from './core/module';
import type { SocketState } from './net/fakeSocket';

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

    /** 目前掛著的是哪一個模組（含大廳）。HUD 靠它決定要掛哪一組面板。 */
    scene: ModuleId | null;

    /**
     * 上一次卸載模組的資源核對結果（見 core/module.ts）。
     *
     * 放進共享狀態是因為**這一頁最該被看見的就是這個數字**：切了幾輪玩法之後
     * texture 有沒有回到基線、有沒有東西沒還。藏在 console 裡等於沒做。
     */
    lastDispose: DisposeReport | null;
    /** 上一次被卸載的是哪個場景。核對數字要跟**它自己**的基線比，見 textureBaselines */
    lastDisposedScene: ModuleId | null;

    /**
     * 每個場景**上一次**卸載後的 texture source 數。
     *
     * 這個對照要這樣設計，是被實測逼出來的三段推理：
     *
     * 1. 開站當下量一次當基線 → 錯。Pixi 畫文字會在字體 atlas 上開頁，那是**全域快取**，
     *    模組卸載不會（也不該）還回去——下一個模組還要用同一套字。
     * 2. 每個場景記自己的第一次 → 還是會誤報。每款玩法用到的字不同、開的頁數也不同
     *    （實測離開百家樂是 60、離開老虎機是 62），所以「先進百家樂、再進老虎機、
     *    再回百家樂」時，百家樂會因為老虎機開的那兩頁而被算成漲了 2。
     * 3. 記**上一次**的值，比相鄰兩次 → 對。全域快取的增長是一次性的，
     *    比相鄰兩次就只會在交叉的那一次顯示 +2，之後一路是 0。
     *
     * 真正的漏長什麼樣：**同一個場景每進出一次就漲一階，永遠停不下來。**
     */
    lastTextureByScene: Partial<Record<ModuleId, number>>;
    /** 這次卸載的場景「上一次」是多少。null = 這個場景第一次卸載，沒得比 */
    previousTexture: number | null;

    /** 切換場景的入口，由 stage 註冊。HUD 的「回大廳」與大廳的機台卡片都走它。 */
    enter: ((id: ModuleId) => void) | null;

    /**
     * 底部操作面板實際佔多高（畫面像素，含它自己的下邊距）。0 = 沒有面板。
     *
     * canvas 內的版面要讓開它，而**面板高度不是常數**：中英文的行數不同、玩法的
     * 控制項數量不同、窄畫面還會整個堆疊起來。寫死一個數字的話，總有一種組合會讓
     * 下注區被蓋掉一半。所以由 HUD 那側實測後寫進來（見 ui/Hud.tsx 的 DockMeasure）。
     *
     * 這也是這一頁 canvas 與 DOM 兩層分工的必要代價：分開畫就得有人負責對齊。
     */
    dockHeight: number;

    setConnection: (s: SocketState) => void;
    setBalance: (n: number) => void;
    setError: (msg: string | null) => void;
    setScene: (s: ModuleId | null) => void;
    /** 記一次卸載的結果，並把該場景的對照值更新成這次的數字。 */
    recordDispose: (scene: ModuleId, report: DisposeReport) => void;
    setEnter: (fn: ((id: ModuleId) => void) | null) => void;
    setDockHeight: (n: number) => void;
}

export const useArcadeStore = create<ArcadeState>((set) => ({
    connection: 'connecting',
    balance: 0,
    error: null,
    scene: null,
    lastDispose: null,
    lastDisposedScene: null,
    lastTextureByScene: {},
    previousTexture: null,
    enter: null,
    dockHeight: 0,

    setConnection: (connection) => set({ connection }),
    setBalance: (balance) => set({ balance }),
    setError: (error) => set({ error }),
    setScene: (scene) => set({ scene }),
    recordDispose: (scene, report) =>
        set((s) => ({
            lastDispose: report,
            lastDisposedScene: scene,
            previousTexture: s.lastTextureByScene[scene] ?? null,
            lastTextureByScene: { ...s.lastTextureByScene, [scene]: report.textureSources },
        })),
    setEnter: (enter) => set({ enter }),
    setDockHeight: (dockHeight) => set({ dockHeight }),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const arcadeState = () => useArcadeStore.getState();
