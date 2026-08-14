import type { BaccaratC2S, BaccaratS2C, ShoeInfo } from '../net/games/baccarat';
import type { RoadRound } from '../games/baccarat/roadmap';
import {
    BET_SPOTS,
    MAX_CARDS_PER_ROUND,
    SUITS,
    settleBets,
    settleRound,
    type Bets,
    type Card,
} from '../games/baccarat/rules';
import type { GameServer } from './gameServer';
import { Wallet } from './wallet';

/**
 * 「伺服器」端的百家樂：管牌靴、發牌、結算、記這一靴的歷史。
 *
 * 跟 slotServer 同一個定位——跑在瀏覽器裡但**被當成遠端**，只有 net/fakeSocket.ts 碰得到。
 * 前端拿不到牌靴的參考，就不可能偷看下一張牌再決定怎麼演翻牌動畫。
 *
 * 這一款跟老虎機的結構差別值得注意：老虎機每一把都是獨立事件，這裡卻有**跨局的狀態**
 * （牌靴剩什麼、這一靴出過什麼）。所以它多了老虎機沒有的責任：換靴要清歷史、
 * 發牌前要確認牌夠、進桌的人要拿得到之前的歷史。
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

export class BaccaratServer implements GameServer<BaccaratC2S, BaccaratS2C> {
    public readonly id = 'baccarat' as const;

    private readonly wallet: Wallet;

    /** 這一靴剩下的牌。發牌從尾端取，pop 是 O(1)。 */
    private shoe: Card[] = [];
    private shoeSize = 0;

    /** 這一靴到目前為止的結果。換靴時清空——路圖是「這一靴」的歷史。 */
    private history: RoadRound[] = [];

    /** 抽牌用的亂數。抽出來成一個欄位是為了讓驗證腳本能換成固定序列。 */
    private readonly random: () => number;

    constructor(wallet: Wallet = new Wallet(), random: () => number = Math.random) {
        this.wallet = wallet;
        this.random = random;
        this.newShoe();
    }

    public getBalance(): number {
        return this.wallet.get();
    }

    public getHistory(): RoadRound[] {
        return this.history;
    }

    public handle(packet: BaccaratC2S): BaccaratS2C | null {
        switch (packet.type) {
            case 'sit':
                return { type: 'table', history: [...this.history], shoe: this.shoeInfo() };

            case 'deal':
                return this.deal(packet.bets);

            default:
                return null;
        }
    }

    /**
     * 發一局。
     *
     * 順序是**先請款、再發牌、最後入帳**，跟真實桌台一樣。反過來寫（先發牌再看錢夠不夠）
     * 就會出現「牌都翻完了才說你錢不夠」，那一局要嘛作廢要嘛認帳，兩種都是麻煩。
     */
    private deal(bets: Bets): BaccaratS2C {
        const total = BET_SPOTS.reduce((sum, spot) => sum + (bets[spot] ?? 0), 0);
        if (!Number.isFinite(total) || total <= 0) return { type: 'error', reason: 'invalid_bet' };
        for (const spot of BET_SPOTS) {
            const stake = bets[spot] ?? 0;
            if (!Number.isFinite(stake) || stake < 0) return { type: 'error', reason: 'invalid_bet' };
        }
        if (!this.wallet.debit(total)) return { type: 'error', reason: 'insufficient_balance' };

        // 一局最多六張，不夠就先換靴——中途缺牌是最難處理的錯誤狀態，
        // 與其寫一套「補牌時牌靴空了」的分支，不如保證它不會發生
        if (this.shoe.length < MAX_CARDS_PER_ROUND) this.newShoe();

        const deal: Card[] = [];
        for (let i = 0; i < MAX_CARDS_PER_ROUND; i++) deal.push(this.shoe.pop() as Card);
        const round = settleRound(deal);

        // settleRound 只會用掉四到六張，沒用到的放回去——**發牌不是每局固定六張**，
        // 多抽的牌若不歸位，牌靴會消耗得比真實情況快，對子與和局的頻率也會跟著偏
        const used = round.player.length + round.banker.length;
        for (let i = MAX_CARDS_PER_ROUND - 1; i >= used; i--) this.shoe.push(deal[i]);

        const payouts = settleBets(bets, round);
        const totalReturn = BET_SPOTS.reduce((sum, spot) => sum + payouts[spot], 0);
        this.wallet.credit(totalReturn);

        this.history.push({
            outcome: round.outcome,
            playerPair: round.playerPair,
            bankerPair: round.bankerPair,
        });

        // 切牌位置到了：這一局算數，下一局換新靴
        const shoeChanged = this.shoe.length <= CUT_AT;
        if (shoeChanged) this.newShoe();

        return {
            type: 'dealResult',
            round,
            payouts,
            totalReturn,
            balance: this.wallet.get(),
            shoe: this.shoeInfo(),
            shoeChanged,
        };
    }

    /** 洗一副新靴，順便把這一靴的歷史清掉（路圖跟著換靴重來）。 */
    private newShoe(): void {
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

        this.shoe = cards;
        this.shoeSize = cards.length;
        this.history = [];
    }

    private shoeInfo(): ShoeInfo {
        return { remaining: this.shoe.length, total: this.shoeSize };
    }
}
