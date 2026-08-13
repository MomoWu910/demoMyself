/**
 * 老虎機的規則數值：符號、權重、賠付表、賠付線。
 *
 * 這裡**只有數字，沒有判定邏輯也沒有外觀**。三邊各取所需：
 *   - 假 server（server/slotServer.ts）拿權重抽盤面、拿賠付表算錢
 *   - 前端拿賠付表顯示 paytable，拿賠付線畫中獎動線
 *   - 符號的長相另外畫在 symbols.ts，跟數值完全分開
 *
 * 前端也拿得到賠付表**不代表前端在算輸贏**——它只是為了把規則顯示給玩家看。
 * 判定永遠只在 server 那一側跑一次（見 net/protocol.ts 的說明）。
 *
 * 數值是為了讓 demo 好看而配的，不是任何真實遊戲的參數。
 */

export enum Sym {
    Cherry = 0,
    Lemon = 1,
    Bell = 2,
    Bar = 3,
    Seven = 4,
    Wild = 5,
    Scatter = 6,
}

export const SYMBOLS: Sym[] = [Sym.Cherry, Sym.Lemon, Sym.Bell, Sym.Bar, Sym.Seven, Sym.Wild, Sym.Scatter];

/**
 * 抽符號的權重。越值錢的越稀有——這是老虎機期望值的來源，
 * 賠付表再漂亮，只要權重不配合，長期回報率就不對。
 */
export const WEIGHTS: Record<Sym, number> = {
    [Sym.Cherry]: 22,
    [Sym.Lemon]: 20,
    [Sym.Bell]: 15,
    [Sym.Bar]: 11,
    [Sym.Seven]: 6,
    [Sym.Wild]: 3,
    [Sym.Scatter]: 3,
};

/**
 * 賠付表：`PAYOUTS[symbol][n]` = 連 n 格的賠率（乘上單線押注）。
 * 索引 3/4/5 才有值，少於三連不賠——這是老虎機的通例。
 *
 * **這組數字是配出來的，不是憑感覺填的。** 賠付表與 WEIGHTS 一起決定 RTP
 * （Return To Player，長期回報率），而光看任一張表都看不出 RTP 是多少——它是兩者
 * 交互作用的結果。第一版配出來是 105.9%，也就是長期下來玩家淨賺，那是配置錯誤
 * 而不是慷慨；往下調之後現在是 **93.0%，中獎率 30%**，落在真實機台的區間內。
 *
 * **改這裡任何一個數字都要重跑 `npm run check:slot`**（十萬把取樣），
 * 否則很容易在不知情的情況下把機台配爆。
 */
export const PAYOUTS: Record<Sym, Record<number, number>> = {
    [Sym.Cherry]: { 3: 4, 4: 12, 5: 42 },
    [Sym.Lemon]: { 3: 6, 4: 17, 5: 52 },
    [Sym.Bell]: { 3: 9, 4: 27, 5: 96 },
    [Sym.Bar]: { 3: 14, 4: 45, 5: 190 },
    [Sym.Seven]: { 3: 22, 4: 90, 5: 440 },
    [Sym.Wild]: { 3: 44, 4: 175, 5: 880 },
    // Scatter 不走連線賠付（見 slotServer 的說明），列出來只是為了型別完整
    [Sym.Scatter]: { 3: 0, 4: 0, 5: 0 },
};

/**
 * 賠付線：每條線在 5 個轉軸上各取第幾列（0=上、1=中、2=下）。
 *
 * 五條是刻意的下限——線再多，畫面上的中獎動線就會糊成一團，
 * demo 要展示的是「怎麼判定與怎麼演出」，不是線的數量。
 */
export const PAYLINES: number[][] = [
    [1, 1, 1, 1, 1], // 中線
    [0, 0, 0, 0, 0], // 上線
    [2, 2, 2, 2, 2], // 下線
    [0, 1, 2, 1, 0], // V 形
    [2, 1, 0, 1, 2], // Λ 形
];

/** 一次 spin 押幾條線。押注額會平均分到每條線上。 */
export const LINE_COUNT = PAYLINES.length;

/**
 * Wild 能替代誰。
 *
 * 通例是「除了 Scatter 以外都能替」——Scatter 若也能被替代，
 * 免費遊戲的觸發率會失控（它本來就不看線，替代等於憑空多出觸發機會）。
 */
export function canSubstitute(target: Sym): boolean {
    return target !== Sym.Scatter && target !== Sym.Wild;
}
