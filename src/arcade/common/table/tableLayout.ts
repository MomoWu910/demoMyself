import { uiScale } from '../../core/layout';

/**
 * 兩張百家樂桌台共用的版面計算。
 *
 * 這支檔案是這次改版的核心，而它會存在本身就是結論之一：數位桌台與視訊桌台的版面
 * **只差中間那一塊是什麼**（Pixi 畫的牌，或是沉在畫布底下的 `<video>`），其餘七、八個
 * 區塊的位置與尺寸邏輯一模一樣。原本兩支檔案各自維護一份複製貼上的排版，改一個數字
 * 要改兩遍——而兩遍之間只要漏一次，兩張桌子就會慢慢長成兩個樣子。
 *
 * ---
 *
 * **版面的骨架，由下往上：**
 *
 * ```
 *  ┌──────────────────────────────────────────┐
 *  │ 讀數                                  [⚙] │  讀數左上，齒輪切進頂列的右端
 *  │   ●        ┌────────────┐          ●     │
 *  │   ●        │ 發牌／視訊 │          ●     │  座位左三右三夾住中央
 *  │   ●        └────────────┘          ●     │
 *  │              [ 下注中 · 12 ]              │  狀態條（全桌唯一一份）
 *  │        ┌────────────────────┐             │
 *  │        │  閒對   和   莊對  │             │  注區
 *  │        │   閒    │    莊    │             │
 *  │        └────────────────────┘             │
 *  │ [我]   ◎ ◎ ◎ ◎ ◎ →              [重複]   │  籌碼架那一條
 *  │                                  [線上]   │
 *  │ ┌──────────────────────────────────────┐ │
 *  │ │ 珠盤 │ 大路 │ 大眼 │ 小路 │ 曱甴     │ │  路單貼底
 *  │ └──────────────────────────────────────┘ │
 *  └──────────────────────────────────────────┘
 * ```
 *
 * 順序是照**看的頻率**排的，不是照原本的習慣：路單是整局唯一會被反覆盯著看的參考資訊，
 * 所以給它最穩定、最不會被其他東西擠掉的位置——畫面最底下那一整條。發牌區反過來，
 * 它每局只有幾秒鐘是主角，但那幾秒需要最大的面積，所以它拿走上半部整片。
 *
 * ---
 *
 * **高度怎麼分：先講理想，再講底線。**
 *
 * 每一段都有 `ideal` 與 `min` 兩個數字。空間夠就照理想值擺，不夠就從**最捨得讓的那一段
 * 開始壓**（見 SHRINK_ORDER）。這比「每段乘一個係數等比縮小」好：等比縮小會讓所有東西
 * 同時變得半殘——路單的格子小到看不出顏色、注區矮到按不準、籌碼小到看不出面額，
 * 而玩家一次只會需要其中一樣。
 */

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface BetLayout {
    x: number;
    width: number;
    smallY: number;
    bigY: number;
    smallH: number;
    bigH: number;
    gap: number;
}

export interface LayoutOptions {
    /**
     * 中央區的理想高度上限。
     *
     * 給**內容有固定大小**的桌台用：數位百家樂的牌最大就是 96px 寬（貼圖解析度決定的），
     * 中央區再高也只是讓那幾張牌浮在一片空地中間。傳了這個值之後，多出來的高度會轉給
     * 路單——它是這張桌上唯一「越高越好讀」的東西。
     *
     * 視訊桌台不傳：那塊畫面吃多少面積都不嫌多。
     */
    stageMax?: number;
}

export interface TableLayout {
    scale: number;
    /** `flank` = 座位左三右三夾住中央；`row` = 窄畫面退回一列橫排 */
    variant: 'flank' | 'row';
    /**
     * 其他玩家的座位要不要畫。
     *
     * 手機橫放（390 高）是唯一會關掉的情況：那裡扣掉頂列只剩兩百多 px，要塞下視訊、
     * 注區、籌碼架與路單，六張椅子怎麼擺都會壓到別人身上。**關掉的是頭像不是座位**——
     * 籌碼照樣從那幾個座標飛出來，只是玩家看不到是誰押的。
     */
    showSeats: boolean;
    /**
     * 讀數那一列要不要畫。
     *
     * 手機橫放關掉——那裡頂列與畫面上緣之間根本沒有一條 26px 的空帶可用，硬放會壓在
     * 玩家膠囊上。關掉之後那些數字仍然拿得到：延遲燒在視訊的 LIVE 標籤上，
     * 押注與輸贏在注區角落，牌靴在更多選單裡。
     */
    showStats: boolean;
    /** 中央那一塊：數位桌台放牌，視訊桌台放播放器 */
    stage: Rect;
    /** 六個座位的**中心點**（SeatView 的錨點在頭像圓心） */
    seats: Array<{ x: number; y: number }>;
    seatSize: number;
    seatCompact: boolean;
    banner: Rect;
    bets: BetLayout;
    /** 籌碼架的可視範圍 */
    chipRail: Rect;
    /** 我自己的座位（左偏下） */
    mySeat: Rect;
    /** 重複下注（右偏下，線上人數上面） */
    repeat: Rect;
    /** 線上人數膠囊的左上角 */
    online: { x: number; y: number };
    /** 讀數區的左上角 */
    stats: { x: number; y: number };
    /**
     * 更多鈕（齒輪）的**右上角**（它靠右對齊）。
     *
     * 它比 `stats` 高一整列：讀數讓開整條頂列，齒輪則跟頂列右側的核對徽章並排。
     * 那顆徽章是 DOM，讓位寫在 style.css 的 `.top-right--gear`。
     */
    more: { x: number; y: number };
    /** 路單整條 */
    roads: Rect;
}

/** 邊界留白。手機上再小就會貼到螢幕圓角 */
const PAD = 12;

/**
 * 頂列實際佔住的高度。
 *
 * 這個數字一度是 92——那是為了讓開右上角錯開一列的語言鈕。**但牌桌上根本沒有那顆鈕**：
 * 語言切換在這兩張桌上收進了齒輪選單，DOM 那顆進桌就被藏起來（見 ui/Hud.tsx 的
 * `useHideLangToggle`）。於是那 34px 是讓給一個不存在的東西，代價是齒輪懸在半空、
 * 讀數與中央區跟著往下掉一整列。
 *
 * 現在取的是頂列自己的高度加一點呼吸：`.top` 從 16px 開始，右邊那顆玩家膠囊實測收在 57
 * （頭像 28 + 上下 padding + 框線），所以 56 會**正好壓到它 1px**——那種重疊在截圖上看不出來，
 * 只有把讀數的字放大才發現。取 64 讓兩者之間留得下一道看得見的間隙。
 */
const TOP_BAR_SAFE = 64;

/**
 * 齒輪的上緣。**它不跟讀數同一列**——讀數讓開整條頂列，齒輪則是切進頂列的右端，
 * 跟那顆資源核對徽章並排。
 *
 * 那一段畫布在牌桌上是空的：頂列右側只剩核對徽章，而它靠 `.top-right` 的 padding
 * 讓開了齒輪的寬度（見 style.css 的 `.top-right--gear`）。**兩邊的讓位要一起改**，
 * 少讓一邊就會疊在一起。
 *
 * 值取 12 而不是頂列的 16：齒輪比徽章高一截，齊中心比齊上緣好看。
 */
const MORE_TOP = 12;

/** 座位那一欄佔多寬（flank 版）。頭像 + 名字 + 餘額三行的寬度 */
const SEAT_COL_W = 104;
/** 窄畫面橫排時每張椅子的上限寬度 */
const SEAT_ROW_MAX = 76;

/** 我的座位那一格。窄畫面砍到只剩頭像與餘額 */
const MY_SEAT_W = 116;
const MY_SEAT_W_COMPACT = 84;

/** 右下角那一欄（重複下注 + 線上人數） */
const RIGHT_COL_W = 132;
const RIGHT_COL_W_COMPACT = 96;

/** 讀數區的寬度。中央區左右要讓開它與座位欄裡較寬的那個 */
const STATS_W = 96;

/**
 * 頭像圓佔座位寬度的比例。**跟 seatView.ts 的 AVATAR_RATIO 是同一個數字**，
 * 因為這裡要從「間距夠不夠」反推圓能多大。
 */
const AVATAR_RATIO = 0.62;

/**
 * 頭像圓下面那兩行字（名字 + 餘額）佔多高。
 *
 * 來自 seatView.ts：NAME_GAP 4 + 名字 12 + BALANCE_GAP 2 + 餘額 12 = 30，
 * 這裡取 30 不含呼吸空間，呼吸另外加（見 flank 分支）。**改那邊的字級要回來改這個數字**，
 * 不然座位又會開始互相壓到。
 */
const SEAT_TEXT_H = 30;

/**
 * 各段的理想高度與底線。
 *
 * 路單的理想值（132）比改版前的上限（172）矮，但它**佔的比例反而變高**——因為它不再
 * 跟牌區搶同一塊垂直空間，而是獨佔畫面最底下那一條。矮一點的五路並排，比高一點卻
 * 每隔幾局就被牌區擠掉一半來得有用。
 *
 * 三個數字而不是兩個：`soft` 是「讓到這裡還好用」，`min` 是「再小就沒有功能了」。
 * 空間不夠時**先讓每一段各走到 soft，不夠才動 min**（見 SHRINK_ORDER）。
 */
const BANDS = {
    road: { ideal: 132, soft: 96, min: 62 },
    rail: { ideal: 76, soft: 60, min: 46 },
    big: { ideal: 84, soft: 70, min: 40 },
    small: { ideal: 56, soft: 44, min: 28 },
    banner: { ideal: 34, soft: 28, min: 24 },
    stage: { ideal: 320, soft: 240, min: 96 },
} as const;

/**
 * 矮螢幕（手機橫放）專用的理想值。
 *
 * 不是把上面那組乘一個係數——**等比縮小會讓每一段同時變得半殘**。這一組是逐段重新
 * 決定的：路單壓到還讀得出走勢的下限、注區壓到拇指還按得準、籌碼架壓到還看得出面額，
 * 省下來的每一 px 全部給中央那塊。理由是這個尺寸下**只有中央區會因為變小而失去功能**
 * （荷官的手看不清就等於沒有視訊），其餘幾段只是變擠。
 */
const BANDS_SHORT: Record<BandKey, number> = {
    road: 62,
    rail: 52,
    big: 46,
    small: 30,
    banner: 26,
    stage: 320,
};

/** 路單分到多餘高度時能長到多高。再高格子就大得像棋盤，一屏也看不到更多局 */
const ROAD_BONUS_MAX = 190;

type BandKey = keyof typeof BANDS;

/**
 * 空間不夠時**照這個順序**把各段壓下去，而且**壓兩輪**。
 *
 * 兩輪是這裡唯一重要的設計。只壓一輪的話，排在前面的那一段會被一路壓到底線，
 * 後面的完全不動——1180×720 的筆電上就是這樣：中央區從 320 一路被壓到 96，
 * 三張椅子疊成一坨，而路單還維持著 132 的舒適高度。**沒有哪一段值得為了另一段
 * 犧牲到殘廢**，所以先讓每一段各讓一點（軟下限），真的還不夠才動硬下限。
 *
 * 順序的判準是「少掉的那幾 px 會讓這一段損失多少功能」：中央區在小尺寸上本來就
 * 看不清細節（先讓）；路單縮矮只是格子變小，還讀得出紅藍走勢；注區與籌碼架縮到
 * 底線就會開始按不準，那是**直接影響玩家會不會押錯**的東西，所以最後才動它們。
 */
const SHRINK_ORDER: BandKey[] = ['stage', 'road', 'small', 'rail', 'big', 'banner'];

/**
 * 座位排成左右兩欄至少需要多高。
 *
 * 三張椅子上下排開，每張是「頭像 + 名字 + 餘額」——擠不下就不是「小一點」而是
 * **疊在一起**，那比退回一列橫排難看得多。
 */
const FLANK_MIN_H = 220;

export function computeTableLayout(w: number, h: number, opts: LayoutOptions = {}): TableLayout {
    const scale = uiScale(w, h);

    // 「窄」與「矮」是兩件不同的事（這條判準跟改版前一致）：窄要縮寬度與字，
    // 矮要縮高度。座位能不能左右分排是兩者一起說了算
    const narrow = w < 880;
    const short = h < 620;
    const tiny = h < 470;
    const compact = w < 620 || h < 520;

    // 每個尺寸都讓同一條：頂列只有一列高，而語言鈕在牌桌上不存在（見 TOP_BAR_SAFE）。
    // 矮螢幕原本另外讓到 66，是為了躲那個尺寸下被搬到頂列中間的語言鈕——同樣的理由，
    // 那顆鈕進桌就被藏起來了，躲的是空氣
    const top = TOP_BAR_SAFE * scale;
    const bottom = h - PAD;

    const gapY = compact ? 6 : 10;
    // 矮螢幕把狀態條併進籌碼架那一列（見下面的 banner），所以少一道間隙
    const gaps = gapY * (tiny ? 5 : 6);

    // 頂上那條給讀數（齒輪更高一列，切進頂列裡）。**它必須是獨立的一列**：讀數若貼在中央區的左上角，
    // 在寬螢幕上會正好落在左邊那三張椅子頭上——那一欄是座位的地盤，而椅子的位置
    // 是由「圍著桌子」決定的，讓不開
    const headH = tiny ? 0 : (short ? 26 : 34) * scale;
    const avail = bottom - top - gaps - headH;

    const bands = fitBands(avail, scale, short, opts.stageMax);

    // ---- 由下往上擺 ----
    const roadY = bottom - bands.road;
    const railY = roadY - gapY - bands.rail;
    const bigY = railY - gapY - bands.big;
    const smallY = bigY - gapY - bands.small;
    // 矮螢幕的狀態條**跟籌碼架同一列**：那個尺寸下每一列都要付 30px 的代價，
    // 而狀態條本來就只是一顆膠囊，它旁邊的空白比它自己還寬
    const bannerY = tiny ? railY + (bands.rail - bands.banner) / 2 : smallY - gapY - bands.banner;
    const stageTop = top + headH + gapY;
    const stageH = (tiny ? smallY : bannerY) - gapY - stageTop;

    // 座位分兩欄夾住中央區的條件，**要等中央區的高度算出來才問得了**。
    // 只看視窗寬高會誤判：1180×720 的筆電又寬又不矮，但扣掉路單、注區與籌碼架之後
    // 中央區只剩兩百出頭，三張椅子在那裡會疊成一坨
    const variant: TableLayout['variant'] = !narrow && !short && stageH >= FLANK_MIN_H * scale ? 'flank' : 'row';

    // ---- 注區 ----
    // 上限從 720 放寬到 900：注區是這張桌上唯一每一局都要被準確點到的東西，
    // 而它原本的寬度是為了讓開底部那塊面板才收窄的——面板已經不在了
    const betW = Math.min(w - PAD * 2, 900 * scale);
    const betX = (w - betW) / 2;

    // ---- 籌碼架那一條：我的座位 | 籌碼架 | 重複下注＋線上人數 ----
    const mySeatW = (compact ? MY_SEAT_W_COMPACT : MY_SEAT_W) * scale;
    const rightW = (compact ? RIGHT_COL_W_COMPACT : RIGHT_COL_W) * scale;
    const bannerW = tiny ? Math.min(150 * scale, w * 0.24) : Math.min(240 * scale, betW * 0.44);
    // 矮螢幕的狀態條插在我的座位與籌碼架之間，籌碼架要往右讓開它
    const railX = PAD + mySeatW + 10 + (tiny ? bannerW + 10 : 0);
    const railW = Math.max(120, w - PAD - rightW - 10 - railX);

    // 重複下注與線上人數共用右邊那一欄，上下疊。**線上人數在下**是刻意的：
    // 散客的籌碼從那顆膠囊飛出來（見 seatView.ts 的 OnlineBadge），
    // 起點低一點，飛向注區的軌跡就更像「從桌外遞進來」
    const repeatH = Math.min(34 * scale, bands.rail * 0.52);
    const repeat: Rect = { x: w - PAD - rightW, y: railY, w: rightW, h: repeatH };
    const online = { x: w - PAD - rightW, y: railY + bands.rail - 22 * scale };

    // ---- 頂上那一列 ----
    // 讀數靠左，落在頂列下面那一條；齒輪往上切進頂列的右端（見 MORE_TOP），
    // 那裡是這張桌上唯一真正的右上角
    const stats = { x: PAD, y: top };
    const more = { x: w - PAD, y: MORE_TOP * scale };

    const seats: Array<{ x: number; y: number }> = [];
    let stageInset = 0;
    let seatSize: number;
    let stageSpace = stageH;

    if (variant === 'flank') {
        const colW = SEAT_COL_W * scale;
        // 左邊要讓開兩樣東西裡較寬的那個——讀數區在最上面、座位欄在中段，
        // 但中央區是一整塊矩形，只能照最寬的讓
        stageInset = Math.max(colW, STATS_W * scale);

        // 三張椅子垂直排在中央區兩側。**間距是解出來的，不是猜的**：
        //
        // 一張椅子實際佔的高度是「頭像圓 + 名字 + 餘額」，圓下面那兩行字就是
        // `SEAT_TEXT_H`（見 seatView.ts 的 NAME_GAP / BALANCE_GAP 與兩個 10px 字級）。
        // 第一版用了一個估計值（26），結果餘額那行還是會壓到下一張椅子的頭像——
        // 那種重疊很難看出是版面問題，因為兩邊都是深色小字，疊起來像字糊掉。
        //
        // 條件有兩個，同時滿足才排得下：
        //   1. 不重疊：step ≥ d + 文字 + 呼吸
        //   2. 放得進中央區：2·step + d + 文字 ≤ 可用高度
        // 把 1 代進 2 反解 d（圓直徑），就得到下面這個上限。圓縮到上限之後，
        // step 取「填滿可用高度」的那個值，三張椅子自然散開。
        const textH = SEAT_TEXT_H * scale;
        const breath = 10 * scale;
        const dMax = (stageSpace - 3 * textH - 2 * breath) / 3;
        const d = Math.max(22, Math.min(colW * 0.82 * AVATAR_RATIO, dMax));
        // 上限避免在很高的畫面上三張椅子散到天涯海角，看起來不像圍著同一張桌子
        const step = Math.min(118 * scale, (stageSpace - d - textH) / 2);
        seatSize = d / AVATAR_RATIO;

        const used = step * 2 + d + textH;
        const startY = stageTop + Math.max(0, (stageSpace - used) / 2) + d / 2;
        for (let i = 0; i < 6; i++) {
            const left = i < 3;
            const row = left ? i : i - 3;
            // 中間那張往外推一點，三張連起來是一條弧而不是一條線
            const bulge = row === 1 ? 12 * scale : 0;
            seats.push({
                x: left ? PAD + colW / 2 - bulge : w - PAD - colW / 2 + bulge,
                y: startY + step * row,
            });
        }
    } else {
        /*
         * 窄畫面：座位收成一列橫排，貼在中央區下緣。矮到放不下時整列不畫，
         * 但**座標照給**——籌碼還是要從那幾個點飛出來。
         *
         * 這一列要讓出多高，**是由頭像加下面那兩行字反推的**，不是一個估計值。
         * 原本寫死 62，而 768 寬的直屏上頭像直徑就有 47、名字與餘額再吃 30——
         * 於是餘額那行落到中央區之外，被階段膠囊壓掉半個字。同一個錯在 flank 版
         * 修過一次（見上面 SEAT_TEXT_H 的說明），這裡漏了。
         */
        seatSize = Math.min((w - PAD * 2) / 6.4, SEAT_ROW_MAX);
        const avatarH = seatSize * AVATAR_RATIO;
        const seatH = tiny ? 0 : avatarH + SEAT_TEXT_H * scale + 6;
        stageSpace = Math.max(40, stageH - seatH - (tiny ? 0 : 4));
        // 頭像圓心：讓開一點呼吸之後，圓的上緣貼著中央區下緣
        const rowY = stageTop + stageSpace + 4 + avatarH / 2;
        const slot = (w - PAD * 2) / 6;
        for (let i = 0; i < 6; i++) seats.push({ x: PAD + slot * (i + 0.5), y: rowY });
    }

    return {
        scale,
        variant,
        showSeats: !tiny,
        showStats: !tiny,
        stage: { x: stageInset, y: stageTop, w: w - stageInset * 2, h: stageSpace },
        seats,
        seatSize,
        seatCompact: variant === 'row' && compact,
        banner: { x: tiny ? PAD + mySeatW + 10 : (w - bannerW) / 2, y: bannerY, w: bannerW, h: bands.banner },
        bets: {
            x: betX,
            width: betW,
            smallY,
            bigY,
            smallH: bands.small,
            bigH: bands.big,
            gap: compact ? 6 : 8,
        },
        chipRail: { x: railX, y: railY, w: railW, h: bands.rail },
        mySeat: { x: PAD, y: railY, w: mySeatW, h: bands.rail },
        repeat,
        online,
        stats,
        more,
        roads: { x: PAD, y: roadY, w: w - PAD * 2, h: bands.road },
    };
}

/**
 * 把可用高度分給各段。
 *
 * 先每段拿理想值（跟著 uiScale 放大），總和超過可用高度就照 SHRINK_ORDER 一段一段
 * 壓到底線。全部壓到底線還是不夠的話就讓中央區負到零：那時候畫面本來就已經小到不能玩，
 * 讓**底下那些按得到的東西**保住尺寸，比讓每一樣都糊掉有用。
 *
 * 空間有剩時的順序是另一個決定：**先餵飽中央區到它用得完的高度，剩下的給路單。**
 * 中央區給不出更多內容時（`stageMax`，數位桌台的牌就那麼大）繼續灌高度只是加空白，
 * 而路單每高一點格子就大一點——它是這一頁唯一會被反覆讀的東西。
 */
function fitBands(avail: number, scale: number, short: boolean, stageMax?: number): Record<BandKey, number> {
    const out = {} as Record<BandKey, number>;
    for (const key of Object.keys(BANDS) as BandKey[]) {
        out[key] = (short ? BANDS_SHORT[key] : BANDS[key].ideal) * scale;
    }

    let over = sum(out) - avail;
    if (over <= 0) {
        let spare = -over;
        // 1. 中央區先吃到它的上限（沒給上限就全吃）
        const room = stageMax === undefined ? spare : Math.max(0, stageMax * scale - out.stage);
        const toStage = Math.min(spare, room);
        out.stage += toStage;
        spare -= toStage;
        // 2. 剩下的給路單，一樣有上限——再高只是格子變大，一屏看到的局數沒變多
        const toRoad = Math.min(spare, Math.max(0, ROAD_BONUS_MAX * scale - out.road));
        out.road += toRoad;
        spare -= toRoad;
        // 3. 還有剩就回頭全給中央區。走到這裡表示螢幕真的很高，那時多留白比多格線好看
        out.stage += spare;
        return out;
    }

    // **中央區超過它用得完的高度時，那一截不算「壓縮」**——先無條件收回來，
    // 它不會讓任何東西變難看（數位桌台的牌就那麼大）
    if (stageMax !== undefined) {
        const excess = Math.max(0, out.stage - stageMax * scale);
        const cut = Math.min(excess, over);
        out.stage -= cut;
        over -= cut;
    }

    for (const floor of ['soft', 'min'] as const) {
        for (const key of SHRINK_ORDER) {
            if (over <= 0) return out;
            // 中央區的下限不跟著 uiScale 放大：它是「小到這裡就沒意義了」的絕對值，
            // 而大螢幕上根本走不到這一步
            const limit = BANDS[key][floor] * (key === 'stage' ? 1 : scale);
            const room = out[key] - limit;
            if (room <= 0) continue;
            const cut = Math.min(room, over);
            out[key] -= cut;
            over -= cut;
        }
    }

    if (over > 0) out.stage = Math.max(0, out.stage - over);
    return out;
}

function sum(bands: Record<BandKey, number>): number {
    let total = 0;
    for (const key of Object.keys(bands) as BandKey[]) total += bands[key];
    return total;
}
