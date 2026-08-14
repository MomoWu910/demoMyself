/**
 * 路圖推算的驗證。`npm run check:road`
 *
 * 為什麼需要它：路圖錯了**在畫面上很難看出來**。四張圖裡有三張是推導出來的，紅藍一顆
 * 畫反了，除非拿真實牌局逐顆核對，否則只會覺得「圖長得怪怪的」。而最容易錯的那個 bug
 * ——把拖尾過的長龍當成好幾條龍——只在出現超過六局同一邊時才發作，隨手測幾局根本碰不到。
 *
 * 判定用的是**手推的預期值**而不是拿另一份實作對答案：對答案只能證明兩份寫得一樣，
 * 證明不了兩份都對。每個案例下面都寫了為什麼預期是那樣。
 *
 * 跟 rtp-check.mjs、reel-check.mjs 一樣不引進測試框架：一支腳本、一個離開碼。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

const out = buildSync({
    entryPoints: [path.join(ROOT, 'src/arcade/games/baccarat/roadmap.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { buildBigRoad, buildDerivedRoad, packDerivedColumns, layoutColumns, layoutBeadPlate } = mod.exports;

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}\n      預期 ${e}\n      實得 ${a}`);
    }
}

function ok(name, condition) {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}`);
    }
}

/** 把 'PPBT' 這種字串轉成牌局歷史，測資才讀得懂。大寫 = 有對子。 */
function rounds(str) {
    const map = { P: 'player', B: 'banker', T: 'tie' };
    return [...str].map((ch) => ({
        outcome: map[ch.toUpperCase()],
        playerPair: false,
        bankerPair: false,
    }));
}

/** 大路的欄長度序列——衍生路只看得到這個，所以測資大多用它表達 */
const lengths = (road) => road.columns.map((c) => c.length);

/** 直接指定欄長度造一條大路，不必反推出對應的牌局字串 */
function roadOfLengths(lens) {
    let s = '';
    let side = 'P';
    for (const n of lens) {
        s += side.repeat(n);
        side = side === 'P' ? 'B' : 'P';
    }
    return buildBigRoad(rounds(s));
}

console.log('\n== 大路：分欄 ==');
{
    const road = buildBigRoad(rounds('PPBP'));
    check('連續同結果疊在同一欄', lengths(road), [2, 1, 1]);
    check('每欄的結果', road.columns.map((c) => c[0].outcome), ['player', 'banker', 'player']);
}

console.log('\n== 大路：和局 ==');
{
    // 和局不佔新位，掛在最後一顆上——所以 P T P 的兩顆 P 仍是同一條龍
    const road = buildBigRoad(rounds('PTP'));
    check('和局不開新欄', lengths(road), [2]);
    check('和局掛在前一顆上', road.columns[0][0].ties, 1);
    check('和局不影響後面那顆', road.columns[0][1].ties, 0);
}
{
    const road = buildBigRoad(rounds('PTTB'));
    check('連開兩次和累加在同一顆', road.columns[0][0].ties, 2);
    check('和局不打斷「換邊要開新欄」', lengths(road), [1, 1]);
}
{
    // 開局就和：還沒有莊閒可以掛，只能單獨記著
    const road = buildBigRoad(rounds('TTP'));
    check('開局的和記在 leadingTies', road.leadingTies, 2);
    check('開局的和不產生欄', lengths(road), [1]);
}
{
    const road = buildBigRoad(rounds('PTP'));
    check('中途的和不算 leadingTies', road.leadingTies, 0);
}

console.log('\n== 大路：對子標記 ==');
{
    const rs = rounds('PB');
    rs[0].playerPair = true;
    rs[1].bankerPair = true;
    const road = buildBigRoad(rs);
    check('閒對記在那一顆上', road.columns[0][0].playerPair, true);
    check('莊對記在那一顆上', road.columns[1][0].bankerPair, true);
}

console.log('\n== 排版：六列與拖尾 ==');
{
    // 一條八顆的長龍：前六顆往下填滿，第七、八顆從最後一列往右拖
    const road = roadOfLengths([8]);
    const cells = layoutColumns(road.columns, 6);
    check('八顆都放得下', cells.length, 8);
    check(
        '前六顆往下填滿第一欄',
        cells.slice(0, 6).map((c) => [c.col, c.row]),
        [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]
    );
    check(
        '第七、八顆沿著最後一列往右拖尾',
        cells.slice(6).map((c) => [c.col, c.row]),
        [[1, 5], [2, 5]]
    );
    ok('拖尾的珠子仍屬於同一條龍', cells.every((c) => c.columnIndex === 0));
}
{
    // 拖尾佔走了第 1、2 欄，所以下一條龍只能從第 3 欄開始——
    // 這正是「不能用欄索引 × 欄寬算座標」的原因
    const road = roadOfLengths([8, 3]);
    const cells = layoutColumns(road.columns, 6);
    const second = cells.filter((c) => c.columnIndex === 1);
    check(
        '下一條龍讓開拖尾佔走的欄',
        second.map((c) => [c.col, c.row]),
        [[3, 0], [3, 1], [3, 2]]
    );
}
{
    const road = roadOfLengths([2, 2]);
    const cells = layoutColumns(road.columns, 6);
    check(
        '沒有拖尾時就是一欄接一欄',
        cells.map((c) => [c.col, c.row]),
        [[0, 0], [0, 1], [1, 0], [1, 1]]
    );
}

console.log('\n== 衍生路：起算點 ==');
{
    // 賭場的說法是「大眼仔從大路第二欄第二行開始」——也就是 c=1, r=1
    const marks = buildDerivedRoad(roadOfLengths([1, 2]), 'bigEye');
    check('第二欄第二行產生第一顆', marks.length, 1);
}
{
    // 「若第二欄只有一顆，則從第三欄第一行開始」——同一條公式自然長出來的，不是特例
    const marks = buildDerivedRoad(roadOfLengths([1, 1, 1]), 'bigEye');
    check('第二欄只有一顆時改從第三欄第一行開始', marks.length, 1);
}
{
    const marks = buildDerivedRoad(roadOfLengths([1, 1]), 'bigEye');
    check('還沒到起算點就沒有任何一顆', marks.length, 0);
}
{
    // 一條長龍還沒有前一欄可以比，所以大眼仔是空的
    const marks = buildDerivedRoad(roadOfLengths([9]), 'bigEye');
    check('只有一條龍時大眼仔是空的', marks.length, 0);
}
{
    check('小路的起算點比大眼仔晚一欄', buildDerivedRoad(roadOfLengths([1, 1, 1]), 'small').length, 0);
    check('小路在第三欄第二行產生第一顆', buildDerivedRoad(roadOfLengths([1, 1, 2]), 'small').length, 1);
    check('曱甴路再晚一欄', buildDerivedRoad(roadOfLengths([1, 1, 2]), 'cockroach').length, 0);
    check('曱甴路在第四欄第二行產生第一顆', buildDerivedRoad(roadOfLengths([1, 1, 1, 2]), 'cockroach').length, 1);
}

console.log('\n== 衍生路：紅藍判定 ==');
{
    // 完全交錯（每欄一顆）是最規律的形態：每次換龍時，前兩欄一樣長 → 全紅
    const marks = buildDerivedRoad(roadOfLengths([1, 1, 1, 1, 1, 1]), 'bigEye');
    ok('交錯盤有產生判定（不是空陣列假通過）', marks.length === 4);
    ok('交錯盤全紅', marks.every((m) => m === 'red'));
}
{
    // 手推 [1,2,2,1] 的大眼仔（k=1）：
    //   c=1,r=1 → 比第 0 欄深度：len(0)=1，要 2 才夠 → 差一格 → blue
    //   c=2,r=0 → 比 len(0)=1 與 len(1)=2 → 不等 → blue
    //   c=2,r=1 → 比 len(1)=2，深度夠 → red
    //   c=3,r=0 → 比 len(1)=2 與 len(2)=2 → 相等 → red
    const marks = buildDerivedRoad(roadOfLengths([1, 2, 2, 1]), 'bigEye');
    check('混合盤逐顆判定', marks, ['blue', 'blue', 'red', 'red']);
}
{
    // 長龍超過前一欄之後：第一顆超出時是藍（不齊），之後一路紅（已經確定不齊，
    // 繼續長反而是規律）。真實桌上長龍在大眼仔顯示成一長串同色就是這個原因
    const marks = buildDerivedRoad(roadOfLengths([1, 5]), 'bigEye');
    check('長龍超出前一欄後轉紅', marks, ['blue', 'red', 'red', 'red']);
}

console.log('\n== 衍生路：拖尾不能把一條龍算成兩條 ==');
{
    // 這是路圖實作最容易犯、也最難看出來的錯：長龍在網格上被拖成三欄，
    // 若衍生路照網格欄推算，len(0) 會變成 6 而不是 8，整張圖從這裡開始全錯。
    const road = roadOfLengths([8, 2, 2]);
    check('大路確實是三條龍（不是拖尾後的五欄）', lengths(road), [8, 2, 2]);

    const cells = layoutColumns(road.columns, 6);
    const gridCols = new Set(cells.map((c) => c.col)).size;
    ok('這盤在網格上確實超過三欄（測資有踩到拖尾）', gridCols > 3);

    // 手推（k=1）：
    //   c=1,r=1 → 比 len(0)=8，深度夠 → red
    //   c=2,r=0 → 比 len(0)=8 與 len(1)=2 → 不等 → blue
    //   c=2,r=1 → 比 len(1)=2，深度夠 → red
    check('衍生路用的是龍不是網格欄', buildDerivedRoad(road, 'bigEye'), ['red', 'blue', 'red']);
}

console.log('\n== 衍生路：分欄 ==');
{
    const cols = packDerivedColumns(['red', 'red', 'blue', 'red']);
    check('連續同色疊成一欄', cols.map((c) => c.length), [2, 1, 1]);
}

console.log('\n== 珠盤路 ==');
{
    const rs = rounds('PBTPBTP');
    const cells = layoutBeadPlate(rs, 6);
    check('每一局都佔一格（和局也是）', cells.length, 7);
    check('由上往下填', cells.slice(0, 3).map((c) => [c.col, c.row]), [[0, 0], [0, 1], [0, 2]]);
    check('填滿一欄換下一欄', [cells[5].col, cells[5].row, cells[6].col, cells[6].row], [0, 5, 1, 0]);
    check('和局在珠盤路上如實記錄', cells[2].round.outcome, 'tie');
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail === 0 ? 0 : 1);
