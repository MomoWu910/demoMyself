import type { GameId } from '../arcade/net/protocol';

/**
 * 顯示格式的單一來源。
 *
 * 抽出來不是為了少寫幾個字，是因為**報表最怕同一個數字在兩頁長得不一樣**：
 * 儀表板的派彩率寫 96.8%、注單頁寫 0.968，看的人會以為那是兩個不同的指標。
 */

/** 金額。後台的錢一律千分位、不帶小數——注單金額是整數，加小數點只會讓表變難掃 */
export function money(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

/** 帶正負號的金額。輸贏欄用，讓人一眼看出方向 */
export function signedMoney(n: number): string {
    const v = Math.round(n);
    return v > 0 ? `+${money(v)}` : money(v);
}

/** 百分比。派彩率這種數字兩位小數就夠，多了是雜訊 */
export function percent(ratio: number, digits = 2): string {
    return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * 時間。後台一律顯示到秒。
 *
 * 注單的時間是拿來對帳的——「三點十二分那筆」跟「三點十二分三十秒那筆」
 * 在爭議單裡是兩件事，砍掉秒數等於把查詢用的資訊丟掉。
 */
export function dateTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 玩法的顯示名稱。key 是遊戲的識別碼，顯示名是給營運看的 */
export const GAME_LABEL: Record<GameId, string> = {
    slot: '幸運轉輪',
    baccarat: '百家樂',
    baccaratLive: '視訊百家樂',
    roulette: '輪盤',
};

export const GAME_IDS = Object.keys(GAME_LABEL) as GameId[];

/**
 * 注別的顯示名稱。
 *
 * 輪盤的注別有一百多種（`straight:17`、`split:17-18`、`corner:1-2-4-5`…），
 * 不可能列成一張對照表，所以是**解析**而不是查表。
 */
export function betTypeLabel(betType: string): string {
    const table: Record<string, string> = {
        spin: '轉一次',
        banker: '莊',
        player: '閒',
        tie: '和',
        bankerPair: '莊對',
        playerPair: '閒對',
    };
    if (table[betType]) return table[betType];

    const [kind, args] = betType.split(':');
    const nums = args ?? '';
    const kinds: Record<string, string> = {
        straight: '直注',
        split: '分注',
        street: '街注',
        corner: '角注',
        line: '線注',
        column: '列注',
        dozen: '打注',
        red: '紅',
        black: '黑',
        odd: '單',
        even: '雙',
        low: '小',
        high: '大',
    };
    const name = kinds[kind] ?? kind;
    return nums ? `${name} ${nums.replace(/-/g, '、')}` : name;
}
