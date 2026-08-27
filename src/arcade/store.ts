import { create } from 'zustand';
import { CHIP_SLOTS, CHIP_VALUES, DEFAULT_CHIP_SET, type ChipValue } from './common/chips/atlas';
import type { DisposeReport, ModuleId } from './core/module';
import type { SocketState } from './net/fakeSocket';
import type { LobbyTab } from './lobby/catalog';

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

    /**
     * 提示訊息的 i18n 鍵。跟 `error` 分開是因為**語氣不一樣**。
     *
     * 「餘額不足」是操作失敗，該用紅色攔住視線；「這款還在規劃中」只是回答了一個問題，
     * 用同一個紅色提示會讓人以為自己弄壞了什麼。共用一個欄位再加個 level 也行，
     * 但那樣每個呼叫點都得多帶一個參數，而呼叫點分散在 server 封包與 UI 兩邊。
     */
    notice: string | null;

    /**
     * 這位訪客的身分。**純粹是門面**——真正的餘額在 server/wallet.ts，這裡只有顯示用的
     * 名字與頭像顏色。
     *
     * 存進 localStorage 是為了回訪時是同一個人。每次進站都換一組名字的話，頂列那個
     * 頭像就只是裝飾；記得住才像個帳號。
     */
    player: { name: string; tint: string };

    /**
     * 玩家挑出來擺在桌邊的那五個面額（由小到大）。
     *
     * 放在**外殼** store 而不是某一張桌子的 store，理由跟餘額一樣：它屬於這個人，
     * 不屬於這張桌。從數位百家樂換到視訊桌台時，手邊的籌碼不該被換掉。
     *
     * 跟著存進 localStorage——籌碼設置是那種「調一次用很久」的偏好，每次進站重設等於
     * 那個設置畫面白做（見 loadChipSet）。
     */
    chipSet: ChipValue[];

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
     * 大廳目前選的分類。
     *
     * 放在共享 store 而不是 React 的 useState：切 tab 的是 DOM 的膠囊按鈕，換卡片的是
     * canvas 裡的滑軌，**兩邊誰也不持有對方**。這是整頁那條分界的縮影——跨過 canvas 邊界的
     * 溝通一律走 store。
     */
    lobbyTab: LobbyTab;

    /**
     * 操作面板實際佔掉畫面哪一側、佔多少（像素，含它自己的外邊距）。兩個都是 0 = 沒有面板。
     *
     * 為什麼是**兩個方向**而不是單一高度：手機橫放時面板會整個移到畫面右側直排
     * （見 style.css 的橫版區塊）。那個尺寸下垂直空間是最稀缺的，面板橫躺在底下會把
     * 牌、注區、路單三段全部擠掉；移到右側之後，稀缺的高度就整段還給了玩法。
     *
     * 面板尺寸**不是常數**：中英文的行數不同、玩法的控制項數量不同、窄畫面還會堆疊起來。
     * 寫死的話總有一種組合會讓下注區被蓋掉一半。所以由 HUD 那側實測後寫進來
     * （見 ui/Hud.tsx 的 useDockMeasure）。這是 canvas 與 DOM 分兩層畫的必要代價。
     */
    dockInset: { bottom: number; right: number };

    setConnection: (s: SocketState) => void;
    setBalance: (n: number) => void;
    setError: (msg: string | null) => void;
    setNotice: (key: string | null) => void;
    setScene: (s: ModuleId | null) => void;
    /** 換掉手邊的籌碼。傳進來的順序不重要，這裡會排好並存檔 */
    setChipSet: (values: ChipValue[]) => void;
    setLobbyTab: (tab: LobbyTab) => void;
    /** 記一次卸載的結果，並把該場景的對照值更新成這次的數字。 */
    recordDispose: (scene: ModuleId, report: DisposeReport) => void;
    setEnter: (fn: ((id: ModuleId) => void) | null) => void;
    setDockInset: (bottom: number, right: number) => void;
}

/**
 * 訪客身分。名字是隨機的四位數，頭像顏色從一組固定的金屬色裡挑——**不用完全隨機的色相**，
 * 那樣總會抽到跟黑金調性打架的螢光色，或是在近黑背景上看不見的暗色。
 */
const TINTS = ['#c9a227', '#e3c88f', '#c98f7a', '#a9714b', '#8c7853', '#b08d57'];
const PLAYER_KEY = 'arcade.player';

function loadPlayer(): { name: string; tint: string } {
    // localStorage 在無痕模式或關掉 cookie 的瀏覽器會直接丟例外，不是回傳 null。
    // 為了一個裝飾用的名字讓整頁掛掉不划算，所以整段包起來，失敗就用當場產的
    try {
        const raw = window.localStorage.getItem(PLAYER_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { name?: unknown; tint?: unknown };
            if (typeof parsed.name === 'string' && typeof parsed.tint === 'string') {
                return { name: parsed.name, tint: parsed.tint };
            }
        }
    } catch {
        /* 讀不到就當第一次來 */
    }

    const player = {
        name: `Guest${String(Math.floor(1000 + Math.random() * 9000))}`,
        tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    };
    try {
        window.localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
    } catch {
        /* 存不了也沒關係，這一輪還是有名字 */
    }
    return player;
}

const CHIP_SET_KEY = 'arcade.chipSet';

/**
 * 讀回上次挑的籌碼。
 *
 * 每一筆都要**驗證是不是還在面額池裡**，不是讀到陣列就照用：池子會改（這一版就從
 * 五種擴到十種），而 localStorage 裡躺著的是上一版的資料。存著一個已經不存在的面額，
 * 桌邊就會出現一顆沒有貼圖的籌碼——那種錯不會丟例外，只會靜靜地少畫一顆。
 */
function loadChipSet(): ChipValue[] {
    try {
        const raw = window.localStorage.getItem(CHIP_SET_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                const valid = parsed.filter((v): v is ChipValue => CHIP_VALUES.includes(v as ChipValue));
                // 去重之後還要夠五顆才算數。少了就整組退回預設——補齊會補出一組
                // 玩家沒挑過的組合，比直接給他認得的那五顆更費解
                const unique = [...new Set(valid)];
                if (unique.length === CHIP_SLOTS) return unique.sort((a, b) => a - b);
            }
        }
    } catch {
        /* 讀不到就用預設那五顆 */
    }
    return [...DEFAULT_CHIP_SET];
}

export const useArcadeStore = create<ArcadeState>((set) => ({
    connection: 'connecting',
    balance: 0,
    error: null,
    notice: null,
    player: loadPlayer(),
    chipSet: loadChipSet(),
    lobbyTab: 'all',
    scene: null,
    lastDispose: null,
    lastDisposedScene: null,
    lastTextureByScene: {},
    previousTexture: null,
    enter: null,
    dockInset: { bottom: 0, right: 0 },

    setConnection: (connection) => set({ connection }),
    setBalance: (balance) => set({ balance }),
    // 兩種提示互斥：後來的那個蓋掉前一個，不要讓兩張卡片同時浮在畫面中間
    setError: (error) => set({ error, notice: null }),
    setNotice: (notice) => set({ notice, error: null }),
    setScene: (scene) => set({ scene }),
    setChipSet: (values) => {
        const chipSet = [...new Set(values)].sort((a, b) => a - b);
        try {
            window.localStorage.setItem(CHIP_SET_KEY, JSON.stringify(chipSet));
        } catch {
            /* 存不了也沒關係，這一輪還是換得動 */
        }
        set({ chipSet });
    },
    setLobbyTab: (lobbyTab) => set({ lobbyTab }),
    recordDispose: (scene, report) =>
        set((s) => ({
            lastDispose: report,
            lastDisposedScene: scene,
            previousTexture: s.lastTextureByScene[scene] ?? null,
            lastTextureByScene: { ...s.lastTextureByScene, [scene]: report.textureSources },
        })),
    setEnter: (enter) => set({ enter }),
    // 值沒變就**回傳原本的 state**，物件參考才不會每次量測都換一個新的。
    // 訂閱端是靠比較參考來決定要不要重排的（見 games/*/index.ts），
    // 每次都給新物件的話，ResizeObserver 每觸發一次就會白排一次版
    setDockInset: (bottom, right) =>
        set((s) => (s.dockInset.bottom === bottom && s.dockInset.right === right ? s : { dockInset: { bottom, right } })),
}));

/** 在 React 之外讀當下狀態（Pixi 那半邊用）。 */
export const arcadeState = () => useArcadeStore.getState();
