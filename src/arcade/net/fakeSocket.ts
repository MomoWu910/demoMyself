import type { C2S, S2C } from './protocol';
import { SlotServer } from '../server/slotServer';

/**
 * 假的遊戲連線：把 server/slotServer.ts 藏在一層仿 WebSocket 的介面後面。
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
 * 沒有做的是重連與封包佇列——那是真專案的事，這裡做了只會讓 demo 的重點模糊掉。
 */

export type SocketState = 'connecting' | 'open' | 'closed';

/** 模擬的來回延遲（毫秒）。抓 180~320ms，接近一般玩家連到境外機房的手感。 */
const RTT_MIN = 180;
const RTT_MAX = 320;

/** 連線握手要多久。比一般封包久一點，開場才看得到「連線中」這個狀態。 */
const CONNECT_MS = 420;

export interface FakeSocketHandlers {
    onOpen?: () => void;
    onMessage: (packet: S2C) => void;
    onStateChange?: (state: SocketState) => void;
}

export class FakeSocket {
    private state: SocketState = 'connecting';
    private server = new SlotServer();
    private handlers: FakeSocketHandlers;

    /**
     * 所有排程中的 timer。close() 要能把它們全部清掉——
     * 玩法被卸載後還有 callback 醒過來，就會對著已經 destroy 的 Pixi 物件動手，
     * 那是這種「切換玩法」的頁面最典型的當機來源。
     */
    private timers = new Set<number>();

    constructor(handlers: FakeSocketHandlers) {
        this.handlers = handlers;
        this.later(() => {
            this.setState('open');
            this.handlers.onOpen?.();
            this.emit({ type: 'welcome', balance: this.server.getBalance() });
        }, CONNECT_MS);
    }

    public getState(): SocketState {
        return this.state;
    }

    public send(packet: C2S): void {
        if (this.state !== 'open') return;

        // 送出與回應各算一半 RTT，讓「送出去」與「收回來」都真的花時間
        const rtt = RTT_MIN + Math.random() * (RTT_MAX - RTT_MIN);
        this.later(() => this.handle(packet), rtt);
    }

    public close(): void {
        this.setState('closed');
        for (const id of this.timers) window.clearTimeout(id);
        this.timers.clear();
    }

    private handle(packet: C2S): void {
        if (this.state !== 'open') return;

        switch (packet.type) {
            case 'hello':
                this.emit({ type: 'welcome', balance: this.server.getBalance() });
                break;
            case 'spin': {
                const res = this.server.spin(packet.bet);
                if ('error' in res) this.emit({ type: 'error', reason: res.error });
                else this.emit({ type: 'spinResult', ...res });
                break;
            }
        }
    }

    private emit(packet: S2C): void {
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
