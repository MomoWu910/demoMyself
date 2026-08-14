import { REELS } from '../../net/protocol';

/**
 * 停軸的順序演法。
 *
 * 為什麼值得抽成一支檔案：停軸順序在真的機台上是**表演參數**，不是實作細節。同一套轉軸
 * 換個順序，手感差很多——由左到右像在讀一行字，中間先停則會把注意力留在兩側。這種東西
 * 講不清楚，要當場切換來對比，所以它跟起轉演法（見 reel.ts 的 SpinStyle）一樣做成面板選項。
 *
 * 這裡只回「第幾個停」的名次，不碰時間也不碰轉軸。實際的延遲是名次乘上 STOP_STAGGER，
 * 由玩法那側決定（見 index.ts）。這樣切換順序完全不影響停軸本身的時序保證：每根軸的
 * 滑行時間都一樣，換的只是誰先排隊。
 */
export type StopOrder = 'left' | 'center' | 'random';

/** 面板上可選的順序。加第四種只要動這裡、StopOrder 與 i18n 的字串。 */
export const STOP_ORDERS: StopOrder[] = ['left', 'center', 'random'];

/**
 * 算出每根軸的停軸名次：`ranks[i]` = 第 i 根軸排第幾個停（0 起算）。
 *
 * 回傳的是「軸 → 名次」而不是「名次 → 軸」，因為呼叫端手上是軸的索引，要的是它該等多久。
 * 兩種表示法差一次反轉，但用錯方向在對稱的順序下**不會報錯、只會靜默演反**，
 * 所以這裡固定一種並在型別上寫清楚。
 */
export function stopRanks(order: StopOrder, count = REELS): number[] {
    const sequence = stopSequence(order, count);
    const ranks = new Array<number>(count);
    sequence.forEach((reel, rank) => {
        ranks[reel] = rank;
    });
    return ranks;
}

/** 停軸的先後序列：`sequence[rank]` = 排第 rank 個停的是哪根軸。 */
function stopSequence(order: StopOrder, count: number): number[] {
    const all = Array.from({ length: count }, (_, i) => i);

    switch (order) {
        case 'center': {
            // 從正中間往外交替。偶數根時沒有正中間，取偏左的那根當起點
            const mid = Math.floor((count - 1) / 2);
            return all
                .slice()
                .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
        }

        case 'random': {
            // Fisher-Yates。用 sort 配隨機比較子是常見的寫法，但那個分布是歪的
            const out = all.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        }

        case 'left':
        default:
            return all;
    }
}
