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
     * 對**請求驅動**的玩法（老虎機：按一下轉一次）這就是唯一的輸出管道，
     * 那是最好的情況——client 演的每一格都對得上某一個它自己送出的請求。
     */
    handle(packet: In): Out | null;

    /**
     * 訂閱 server 的**主動推播**。有實作才代表這款玩法會自己動。
     *
     * ---
     *
     * 這條管道原本不存在，而且註解裡明寫「回傳值是唯一的輸出管道，多一條非同步的通知
     * 路徑就等於多一個畫面跟結果對不上的來源」。那句話在只有老虎機的時候是對的，
     * **但它把一個實作細節誤當成了原則**。
     *
     * 多人桌台的本質就是 server 驅動時鐘：一張百家樂桌不管有沒有人在看都一局一局往下跑，
     * 玩家只是中途走過來坐下。這種玩法沒有「請求」可以對應——倒數開始、開牌、結算
     * 全都不是任何人按出來的。硬要用請求驅動去模擬，就得讓 client 自己排 timer 決定
     * 什麼時候該開牌，那才是真正把主導權交給了前端。
     *
     * 所以真正該守的原則不是「只能有一條管道」，而是**輸贏由 server 決定**。
     * 推播沒有違反它：推過來的一樣是已經定案的結果。
     *
     * @param emit 把封包送給這條連線。可以呼叫任意次。
     */
    attach?(emit: (packet: Out) => void): void;

    /** 取消訂閱。連線關掉時一定要呼叫，否則 server 會抓著已經死掉的 client callback。 */
    detach?(emit: (packet: Out) => void): void;
}

/** 建構玩法 server 時共用的參數。目前只有錢包，之後開桌參數（限紅、牌靴數）也走這裡。 */
export interface GameServerOptions {
    wallet: Wallet;
}
