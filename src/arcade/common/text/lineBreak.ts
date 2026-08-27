import { CanvasTextMetrics } from 'pixi.js';

/**
 * 中文的行首行尾禁則。
 *
 * Pixi 斷行時把每個中文字都當成可斷點（`breakWords`），這對中文是對的——中文本來就
 * 逐字排。但它不知道**標點不能站在行首**：一段說明折下來，就會出現行首一個孤零零的
 * 「，」或「。」，那在中文排版裡是明顯的錯誤，讀起來像句子被切成兩半。
 *
 * 反過來也有一組：開括號、開引號不能落在行尾——那會讓下一行以被引號丟下的內容開頭。
 *
 * 修法是 Pixi 留的那個掛鉤 `canBreakChars`：它問「這兩個字之間可不可以斷」，
 * 對禁則字元回 false，斷點就會自動往前挪一格。**這是全域設定**，所以掛在這裡由頁面
 * 入口呼叫一次，而不是每個 Text 各自處理——那種東西一定會漏掉某一個。
 *
 * 沒有做的是更講究的規則（懸掛標點、行末壓縮），那需要自己量測與排字。對一段面板說明
 * 來說，把標點留在上一行就已經解決了肉眼看得出來的那個問題。
 */

/** 不能出現在行首的字元（避頭點） */
const NO_LINE_START = new Set([...'，。、；：！？）」』】〉》〕｝·…—', ...',.;:!?)]}%']);

/** 不能出現在行尾的字元（避尾點） */
const NO_LINE_END = new Set([...'（「『【〈《〔｛', ...'([{']);

let installed = false;

/** 掛上禁則。重複呼叫沒有副作用，頁面入口叫一次就好 */
export function installCJKLineBreak(): void {
    if (installed) return;
    installed = true;

    CanvasTextMetrics.canBreakChars = (char, nextChar): boolean =>
        !NO_LINE_START.has(nextChar) && !NO_LINE_END.has(char);
}
