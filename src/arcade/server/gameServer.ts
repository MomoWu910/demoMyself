import type { GameId } from '../net/protocol';
import type { Wallet } from './wallet';

/**
 * 玩法 server 的共同形狀。
 *
 * 每款玩法的規則差很遠（轉軸抽權重、百家樂要發牌補牌），共通的其實只有兩件事：
 * **收一個封包、回一個封包**，以及**動錢要透過錢包**。所以介面只約束這兩件，
 * 不去規定玩法內部長怎樣。
 *
 * 握手（hello / welcome）不在這裡——那是每款玩法都一樣的樣板，由 net/fakeSocket.ts
 * 統一處理。玩法 server 只管自己那組封包，加一款遊戲就不必再抄一次握手。
 */
export interface GameServer<In, Out> {
    readonly id: GameId;

    /**
     * 處理一個封包。回 `null` = 這個封包不需要回應。
     *
     * 回傳值是**唯一**的輸出管道（沒有 callback、沒有事件），因為 client 那側是
     * 照著封包演的，多一條非同步的通知路徑就等於多一個「畫面跟結果對不上」的來源。
     */
    handle(packet: In): Out | null;
}

/** 建構玩法 server 時共用的參數。目前只有錢包，之後開桌參數（限紅、牌靴數）也走這裡。 */
export interface GameServerOptions {
    wallet: Wallet;
}
