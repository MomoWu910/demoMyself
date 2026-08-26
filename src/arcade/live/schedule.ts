import type { Card, Round } from '../games/baccarat/rules';

/**
 * 荷官流的時間表——**這一份資料同時被兩邊讀，那正是它存在的理由。**
 *
 * 生成素材時照它畫（第 12.0 秒荷官把第一張牌放到閒家位），live server 也照它推封包
 * （第 12.0 秒送出「閒家第一張是紅心 7」）。兩邊讀同一份，所以畫面上的牌跟桌況裡的牌
 * 永遠是同一張——**不是靠對齊校正出來的，是靠沒有第二份資料。**
 *
 * 這跟真實視訊桌台的因果是同一個方向。那邊是荷官的實體動作經由讀牌器進 game server，
 * server 再廣播給所有人；我們沒有實體荷官，所以改成「先決定牌序，畫面與 server 各自
 * 照著演」。方向一樣：**畫面不是跟著遊戲邏輯跑的，兩者都是跟著同一個牌序跑的。**
 *
 * 反過來做——server 自己開局、畫面想辦法跟上——才需要把事件戳進流裡做時間軸對齊，
 * 那是被高延遲協定逼出來的補救，不是這個領域的正解。
 */

/** 一局固定多長（秒）。真實荷官不會這麼準，但循環素材的總長要能精確算出來 */
export const ROUND_DURATION = 22;

/** 下注期。真實桌台在 12~15 秒之間，取偏短的那頭，循環才不會太長 */
export const BETTING_DURATION = 11;

/** 「停止下注」到第一張牌落桌之間的空檔。荷官要把牌從牌靴抽出來 */
export const LOCK_DURATION = 1;

/** 發牌的間隔。比遊戲內的動畫慢得多——這是一雙手在動，不是 tween */
export const DEAL_GAP = 0.9;

/** 前四張發完到翻牌之間的停頓。荷官要把牌攤開，這個停頓是緊張感的來源 */
export const REVEAL_GAP = 0.9;

/** 補牌之間的間隔。補牌是逐張決定的，所以比前四張慢 */
export const DRAW_GAP = 0.8;

/** 結果亮出來之後留多久給玩家看，然後收牌 */
export const RESULT_HOLD = 2.4;

/** 荷官把牌收走的動作長度。收完就接下一局的下注期 */
export const CLEAR_DURATION = 1.2;

/** 一張牌落桌的事件 */
export interface DealCue {
    /** 相對於這一局開始的秒數 */
    at: number;
    side: 'player' | 'banker';
    /** 這是該側的第幾張（0-based）。補牌固定是 index 2 */
    index: number;
    card: Card;
}

/** 一局在素材裡的完整時間表 */
export interface RoundCue {
    /** 這一局在素材裡的起始秒數 */
    startAt: number;
    /** 停止下注的時刻（相對於 startAt） */
    lockAt: number;
    /** 每一張牌落桌的時刻 */
    deals: DealCue[];
    /** 前四張攤開的時刻 */
    revealAt: number;
    /** 結果亮出來的時刻（補牌都翻完之後） */
    resultAt: number;
    /** 荷官開始收牌的時刻 */
    clearAt: number;
    /** 這一局的牌與結果。server 直接照這個推 settle 封包 */
    round: Round;
}

/** 整份素材的時間表 */
export interface StreamCues {
    rounds: RoundCue[];
    /** 素材一圈的總長。等於 rounds.length * ROUND_DURATION */
    duration: number;
}

/**
 * 把一局的牌排成時間表。
 *
 * 補牌是逐張決定的，所以第五、六張的時刻取決於有沒有補——沒補的那一局就把省下來的時間
 * 留給結果展示。**局長固定**是刻意的：循環素材的總長要能精確算出來，切片邊界才對得齊，
 * 而牆鐘換算成素材位置也才不用查表。
 */
export function scheduleRound(round: Round, startAt: number): RoundCue {
    const lockAt = BETTING_DURATION;
    const firstDeal = lockAt + LOCK_DURATION;

    const deals: DealCue[] = [];

    // 前四張照真實桌台的順序：閒、莊、閒、莊
    const opening: Array<'player' | 'banker'> = ['player', 'banker', 'player', 'banker'];
    for (let i = 0; i < opening.length; i++) {
        const side = opening[i];
        const index = i < 2 ? 0 : 1;
        deals.push({ at: firstDeal + i * DEAL_GAP, side, index, card: side === 'player' ? round.player[index] : round.banker[index] });
    }

    const revealAt = firstDeal + opening.length * DEAL_GAP + REVEAL_GAP;

    // 補牌。閒家先補，莊家後補——順序不能顛倒，莊家的補牌規則要看閒家補到什麼
    let cursor = revealAt + DRAW_GAP;
    if (round.player.length > 2) {
        deals.push({ at: cursor, side: 'player', index: 2, card: round.player[2] });
        cursor += DRAW_GAP;
    }
    if (round.banker.length > 2) {
        deals.push({ at: cursor, side: 'banker', index: 2, card: round.banker[2] });
        cursor += DRAW_GAP;
    }

    const resultAt = cursor;
    const clearAt = ROUND_DURATION - CLEAR_DURATION;

    return { startAt, lockAt, deals, revealAt, resultAt, clearAt, round };
}

/** 把一串牌局排成整份素材的時間表 */
export function scheduleStream(rounds: readonly Round[]): StreamCues {
    return {
        rounds: rounds.map((r, i) => scheduleRound(r, i * ROUND_DURATION)),
        duration: rounds.length * ROUND_DURATION,
    };
}

/**
 * 素材內的某個時刻落在第幾局、局內第幾秒。
 *
 * 局長固定，所以是除法而不是查表——**這條路徑每幀都會走**（畫面要知道現在該畫什麼、
 * server 要知道現在該推什麼），線性掃過所有局在幾百局之後會開始出現在效能剖析裡。
 */
export function locate(cues: StreamCues, t: number): { index: number; local: number } {
    const wrapped = ((t % cues.duration) + cues.duration) % cues.duration;
    const index = Math.floor(wrapped / ROUND_DURATION);
    return { index, local: wrapped - index * ROUND_DURATION };
}

/** 一局在某個局內時刻的階段。畫面與 server 都照這個分支 */
export type LivePhase = 'betting' | 'dealing' | 'result' | 'clearing';

export function phaseAt(cue: RoundCue, local: number): LivePhase {
    if (local < cue.lockAt) return 'betting';
    if (local < cue.resultAt) return 'dealing';
    if (local < cue.clearAt) return 'result';
    return 'clearing';
}

/** 這一刻桌上已經有哪幾張牌落下了。畫面照它決定畫幾張，不必自己累計狀態 */
export function dealtBy(cue: RoundCue, local: number): DealCue[] {
    return cue.deals.filter((d) => d.at <= local);
}
