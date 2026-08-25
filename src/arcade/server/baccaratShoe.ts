import type { ShoeInfo } from '../net/games/baccarat';
import type { RoadRound } from '../games/baccarat/roadmap';
import { MAX_CARDS_PER_ROUND, SUITS, settleRound, type Card, type Round } from '../games/baccarat/rules';

/**
 * 牌靴：管牌、發牌、記這一靴的歷史。**沒有時鐘，也沒有錢包。**
 *
 * 這一層是從桌台裡拆出來的。原本兩件事寫在同一個 class 裡，桌台改成多人自動開局
 * 之後就出事了——桌台的每一局都要等 setTimeout，而長期回報率的驗證要在幾秒內
 * 同步跑完五十萬局（見 baccarat-check.mjs）。**時鐘一旦混進來，那支腳本就再也跑不動。**
 *
 * 拆開之後兩邊各自單純：這裡是「給我下一局」的純粹計算，桌台則只管什麼時候該叫它。
 * 驗證腳本測的是這一層，也就是真正決定輸贏的那一層。
 */

/** 幾副牌一靴。八副是最常見的配置，對子與和局的機率都是照這個數字算的。 */
const DECKS = 8;

/**
 * 剩幾張就換靴（切牌位置）。
 *
 * 真實桌台會插一張切牌卡在末尾前若干張，抽到它就打完這局換靴。留這麼多張沒發完
 * 不是浪費——**牌靴剩得越少，算牌越準**，切掉尾巴等於把算牌的價值砍掉大半。
 * 這裡照抄這個設計，順帶讓「換靴清路圖」這件事在 demo 裡真的會發生。
 */
const CUT_AT = 16;

export interface DrawResult {
    round: Round;
    shoe: ShoeInfo;
    /** 這一局打完之後換了新靴。這一局本身算數，路圖從下一局重新開始 */
    shoeChanged: boolean;
    /** 這一局要接上路圖的那一顆 */
    road: RoadRound;
}

export class BaccaratShoe {
    /** 這一靴剩下的牌。發牌從尾端取，pop 是 O(1)。 */
    private cards: Card[] = [];
    private size = 0;

    /** 這一靴到目前為止的結果。換靴時清空——路圖是「這一靴」的歷史。 */
    private history: RoadRound[] = [];

    /** 抽牌用的亂數。抽出來成一個欄位是為了讓驗證腳本能換成固定序列。 */
    private readonly random: () => number;

    constructor(random: () => number = Math.random) {
        this.random = random;
        this.reshuffle();
    }

    public getHistory(): RoadRound[] {
        return this.history;
    }

    public info(): ShoeInfo {
        return { remaining: this.cards.length, total: this.size };
    }

    /** 發一局。牌不夠就先換靴——中途缺牌是最難處理的錯誤狀態。 */
    public draw(): DrawResult {
        if (this.cards.length < MAX_CARDS_PER_ROUND) this.reshuffle();

        const deal: Card[] = [];
        for (let i = 0; i < MAX_CARDS_PER_ROUND; i++) deal.push(this.cards.pop() as Card);
        const round = settleRound(deal);

        // settleRound 只會用掉四到六張，沒用到的放回去——**發牌不是每局固定六張**，
        // 多抽的牌若不歸位，牌靴會消耗得比真實情況快，對子與和局的頻率也會跟著偏
        const used = round.player.length + round.banker.length;
        for (let i = MAX_CARDS_PER_ROUND - 1; i >= used; i--) this.cards.push(deal[i]);

        const road: RoadRound = {
            outcome: round.outcome,
            playerPair: round.playerPair,
            bankerPair: round.bankerPair,
        };
        this.history.push(road);

        // 切牌位置到了：這一局算數，下一局換新靴
        const shoeChanged = this.cards.length <= CUT_AT;
        if (shoeChanged) this.reshuffle();

        return { round, shoe: this.info(), shoeChanged, road };
    }

    /** 洗一副新靴，順便把這一靴的歷史清掉（路圖跟著換靴重來）。 */
    private reshuffle(): void {
        const cards: Card[] = [];
        for (let d = 0; d < DECKS; d++) {
            for (const suit of SUITS) {
                for (let rank = 1; rank <= 13; rank++) cards.push({ rank, suit });
            }
        }

        // Fisher-Yates。**由後往前**且每次從 0..i 取——寫成 0..length 的版本
        // 會讓某些排列的機率比其他的高，那種偏差在牌局統計上看得出來
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        this.cards = cards;
        this.size = cards.length;
        this.history = [];
    }
}
