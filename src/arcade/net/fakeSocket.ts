import type { CommonC2S, GameId } from './protocol';
import type { SlotC2S, SlotS2C } from './games/slot';
import type { BaccaratC2S, BaccaratS2C } from './games/baccarat';
import type { BaccaratLiveC2S, BaccaratLiveS2C } from './games/baccaratLive';
import type { GameServer } from '../server/gameServer';
import { SlotServer } from '../server/slotServer';
import { baccaratTable } from '../server/baccaratServer';
import { liveTable } from '../server/baccaratLiveServer';
import { sessionWallet } from '../server/wallet';

/**
 * 假的遊戲連線：把玩法 server 藏在一層仿 WebSocket 的介面後面。
 *
 * **為什麼要繞這一圈**，而不是讓前端直接呼叫 `slotServer.spin()`：
 *
 * 1. **輸贏的決定權要在前端之外**（見 protocol.ts）。介面隔開之後，前端連 server 的參考
 *    都拿不到，就不可能寫出「先偷看結果再決定怎麼轉」的程式碼。
 * 2. **延遲是真實存在的**。真的機台按下 spin 到收到結果之間有 RTT，這段時間 UI 必須有
 *    明確狀態：按鈕鎖住、轉軸先空轉、不能連按兩次。把延遲做進來，前端就被迫處理這些，
 *    而不是寫成同步呼叫、上線才發現整套互動要重做。
 * 3. **失敗是常態**。餘額不足、封包錯誤都走同一條 error 路徑回來，前端只有一個地方要處理。
 *
 * **一條連線對一張桌**：玩法掛載時開，卸載時關（見 core/module.ts 的資源契約）。
 * 這跟真的大廳一樣——進桌開一條 game 連線，離桌就斷。跨桌延續的只有錢包，而錢包
 * 活在連線之外（server/wallet.ts），所以從老虎機贏的錢走到百家樂桌還在。
 *
 * 沒有做的是重連與封包佇列——那是真專案的事，這裡做了只會讓 demo 的重點模糊掉。
 */

export type SocketState = 'connecting' | 'open' | 'closed';

/** 模擬的來回延遲（毫秒）。抓 180~320ms，接近一般玩家連到境外機房的手感。 */
const RTT_MIN = 180;
const RTT_MAX = 320;

/** 連線握手要多久。比一般封包久一點，開場才看得到「連線中」這個狀態。 */
const CONNECT_MS = 420;

export interface FakeSocketHandlers<Out> {
    onOpen?: () => void;
    onMessage: (packet: Out) => void;
    onStateChange?: (state: SocketState) => void;
}

/**
 * 玩法 id → 那款玩法的封包型別。
 *
 * 有了這張表，玩法端只要寫 `new FakeSocket('slot', …)`，收發的封包型別就自己推出來了，
 * 不必手動帶兩個型別參數（帶錯了還是會編譯過，那種錯最難查）。加一款玩法時這裡補一列，
 * 忘了補就會在 `createServer` 的 switch 上編譯失敗。
 */
export interface GameProtocols {
    slot: { c2s: SlotC2S; s2c: SlotS2C };
    baccarat: { c2s: BaccaratC2S; s2c: BaccaratS2C };
    baccaratLive: { c2s: BaccaratLiveC2S; s2c: BaccaratLiveS2C };
}

export type C2SOf<G extends GameId> = GameProtocols[G]['c2s'];
export type S2COf<G extends GameId> = GameProtocols[G]['s2c'];

/**
 * 握手回覆。每款玩法的 `S2COf<G>` 都含 CommonS2C，所以這個封包對每一款都成立，
 * 但 TS 沒辦法從泛型參數推導出這件事，只能在這裡宣告一次。
 */
function welcome<G extends GameId>(): S2COf<G> {
    return { type: 'welcome', balance: sessionWallet.get() } as S2COf<G>;
}

/**
 * 開哪一款玩法就接哪一個 server。
 *
 * 共用的那個錢包在這裡才被傳進去——玩法 server 自己不知道要去哪裡拿錢包，
 * 也就不可能繞過它私自加減餘額。
 *
 * **兩款的生命週期不一樣**，這不是疏忽：
 *
 * - 老虎機是請求驅動的，每次進場 `new` 一台是對的——沒人按它就不該存在。
 * - 百家樂是**一張一直在跑的桌子**，所以接的是 module-level 的那一張
 *   （`baccaratTable`）。每次進桌 new 一張新桌的話，路圖與桌上的人會跟著玩家走，
 *   那就不是多人桌了。
 *
 * 回傳值需要一次 cast：`game` 的值是**執行期**才知道的，而回傳型別由**編譯期**的 `G`
 * 決定，這個接縫沒辦法讓 TS 自己對上。整支檔案就只有這裡一處，換來的是外面所有
 * 玩法程式碼都拿得到精確型別。
 */
function createServer<G extends GameId>(game: G): GameServer<C2SOf<G>, S2COf<G>> {
    switch (game) {
        case 'slot':
            return new SlotServer(sessionWallet) as unknown as GameServer<C2SOf<G>, S2COf<G>>;
        case 'baccarat':
            return baccaratTable as unknown as GameServer<C2SOf<G>, S2COf<G>>;
        case 'baccaratLive':
            // 跟百家樂同理，是 module-level 的一張桌：它照著影片一局一局跑，
            // 沒人在看的時候也一樣在跑（差別只在沒有 listener 就不推播）
            return liveTable as unknown as GameServer<C2SOf<G>, S2COf<G>>;
        default:
            throw new Error(`[arcade] 未知的玩法：${String(game)}`);
    }
}

/**
 * 一條連線＝一張桌。型別參數是**玩法 id**，收發的封包型別由 GameProtocols 查出來——
 * 老虎機的 `onMessage` 若 switch 到百家樂才有的封包型別，會當場編譯失敗，
 * 而不是等到執行期靜默地什麼都不做。
 */
export class FakeSocket<G extends GameId> {
    private state: SocketState = 'connecting';
    private server: GameServer<C2SOf<G>, S2COf<G>>;
    private handlers: FakeSocketHandlers<S2COf<G>>;

    /**
     * 所有排程中的 timer。close() 要能把它們全部清掉——
     * 玩法被卸載後還有 callback 醒過來，就會對著已經 destroy 的 Pixi 物件動手，
     * 那是這種「切換玩法」的頁面最典型的當機來源。
     */
    private timers = new Set<number>();

    /**
     * server 主動推播時走的那條線。
     *
     * 存成欄位而不是每次現包一個，是因為 `detach` 要拿**同一個參考**才解得掉訂閱——
     * 傳一個新的箭頭函式進去，Set 會安靜地什麼都不刪，然後這條連線就永遠掛在
     * server 的訂閱名單上。桌台是 module-level 的，那等於漏到整頁結束為止。
     */
    private readonly push = (packet: S2COf<G>): void => {
        // 推播也要走 RTT。不走的話它會比玩家自己請求的回應更早到，
        // 開發時看起來很順，上線接真 WebSocket 才發現時序全變了
        const rtt = RTT_MIN + Math.random() * (RTT_MAX - RTT_MIN);
        this.deliver(packet, rtt * 0.5);
    };

    /**
     * 下一則封包最早可以在什麼時候送達。**這是為了保住順序。**
     *
     * 沒有它會出真的問題：桌台在同一個瞬間先推 `phase: 'dealing'` 再推 `deal`，
     * 兩則各自抽一個隨機延遲，於是有機會**牌先到、階段後到**——client 就會在還以為
     * 自己在下注階段的時候收到一整局的牌。TCP 不會這樣，真的 WebSocket 也不會，
     * 所以這個假的也不該這樣。
     */
    private lastDeliverAt = 0;

    constructor(game: G, handlers: FakeSocketHandlers<S2COf<G>>) {
        this.server = createServer(game);
        this.handlers = handlers;
        this.later(() => {
            this.setState('open');
            this.handlers.onOpen?.();
            this.emit(welcome());
            // 握手完成才訂閱推播。提早訂的話，桌台的階段封包會比 welcome 先到，
            // client 那側就得處理「還不知道自己是誰卻收到桌況」的狀態
            this.server.attach?.(this.push);
        }, CONNECT_MS);
    }

    public getState(): SocketState {
        return this.state;
    }

    public send(packet: C2SOf<G>): void {
        if (this.state !== 'open') return;

        // 送出與回應各算一半 RTT，讓「送出去」與「收回來」都真的花時間
        const rtt = RTT_MIN + Math.random() * (RTT_MAX - RTT_MIN);
        this.later(() => this.handle(packet), rtt);
    }

    public close(): void {
        this.setState('closed');
        // 先退訂再清 timer。反過來的話，退訂之前 server 還可能再推一則進來排新的 timer，
        // 那一則就會活過這次 close
        this.server.detach?.(this.push);
        for (const id of this.timers) window.clearTimeout(id);
        this.timers.clear();
    }

    /**
     * 握手在這裡就地回覆，其餘轉給玩法 server。
     *
     * 這樣切是為了讓「加一款玩法」的成本只剩玩法本身：hello/welcome 是每款都一樣的樣板，
     * 抄第二遍就會有第二個地方可以寫錯。
     */
    private handle(packet: C2SOf<G>): void {
        if (this.state !== 'open') return;

        if ((packet as CommonC2S).type === 'hello') {
            this.emit(welcome());
            return;
        }

        const reply = this.server.handle(packet);
        // 回應也走同一個佇列。只讓推播排隊、回應插隊的話，順序照樣會亂——
        // 「我押了一注」的確認可能跑到下一秒的別人下注前面去
        if (reply) this.deliver(reply, 0);
    }

    /** 照先進先出送達，且不早於 `delayMs` 之後。同一毫秒的兩則會被拉開 1ms，順序才穩 */
    private deliver(packet: S2COf<G>, delayMs: number): void {
        const now = Date.now();
        const at = Math.max(this.lastDeliverAt + 1, now + delayMs);
        this.lastDeliverAt = at;
        this.later(() => this.emit(packet), at - now);
    }

    private emit(packet: S2COf<G>): void {
        if (this.state !== 'open') return;
        this.handlers.onMessage(packet);
    }

    private setState(next: SocketState): void {
        if (this.state === next) return;
        this.state = next;
        this.handlers.onStateChange?.(next);
    }

    /** setTimeout 的包裝，順便把 id 記進 timers，close() 才清得掉 */
    private later(fn: () => void, ms: number): void {
        const id = window.setTimeout(() => {
            this.timers.delete(id);
            fn();
        }, ms);
        this.timers.add(id);
    }
}
