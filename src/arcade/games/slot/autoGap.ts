import { HIGHLIGHT_SEC, TEMPO, type SpinTempo } from './reel';

/**
 * 自動連轉時，這一把停穩到下一把起轉之間要等多久。
 *
 * 單獨一支檔案而不是塞在 index.ts 裡，是因為它同時牽著三個地方的時序（轉軸的脈動、
 * 贏分數字、自動連轉的節奏），而且它是**純函式**——只有這樣才測得動。
 */

/** 贏分數字淡入與彈出的時長。定義在這裡而不是 index.ts：整段演出要多久由這支檔案負責回答。 */
export const WIN_TEXT_FADE = 0.22;
export const WIN_TEXT_POP = 0.5;

/** 中獎演出整段要播多久——所有同時開跑的動畫裡最長的那個。 */
const WIN_FX_SEC = Math.max(HIGHLIGHT_SEC, WIN_TEXT_FADE, WIN_TEXT_POP);

/** 沒中獎時的空檔。純粹是節奏上的留白，所以跟著快慢檔一起縮。 */
const GAP_IDLE = 0.35;

/** 中獎演出播完之後再多留這麼久，讓玩家把數字看完。 */
const GAP_AFTER_WIN = 0.35;

/**
 * 中獎那一把要等的是「演出播完」，**不是一段跟快慢檔成比例的時間**。
 *
 * 這是快速模式很容易踩到的坑：時序係數會把等待縮到 0.3 秒，但中獎的脈動要 1.28 秒
 * ——動畫本身並沒有跟著變快。於是玩家還在看連線亮，下一把已經轉起來了，
 * 那一把到底中了什麼永遠看不清楚。
 *
 * 所以演出時長原樣保留，只有**演出之後的留白**跟著快慢檔縮。
 */
export function autoGapSec(won: boolean, tempo: SpinTempo): number {
    const t = TEMPO[tempo].time;
    return won ? WIN_FX_SEC + GAP_AFTER_WIN * t : GAP_IDLE * t;
}
