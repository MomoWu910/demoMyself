/**
 * 假 server 的賠付判定與 RTP 驗證。`npm run check:slot`
 *
 * 為什麼需要它：賠付表與符號權重一起決定 RTP（Return To Player，長期回報率），
 * 而**光看數字看不出 RTP 是多少**——它是兩張表交互作用的結果。第一版配出來是 105.9%，
 * 也就是長期下來玩家淨賺，那是配置錯誤而不是慷慨；調到 93% 才進到真實機台的區間。
 * 改 PAYOUTS 或 WEIGHTS 的任何一個數字都要重跑這支，否則很容易在不知情的情況下把機台配爆。
 *
 * 判定邏輯是純函式、不碰瀏覽器，所以直接在 Node 跑；TS 用 esbuild 就地打包，
 * 不必為了一支檢查腳本引進測試框架。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

const out = buildSync({
    entryPoints: [path.join(ROOT, 'src/arcade/server/slotServer.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { SlotServer } = mod.exports;

// 規則數值另外載一份，讓預期值用「賠率 × 單線押注」算出來而不是寫死——
// 調 PAYOUTS 時測試才不會整排壞掉，那會讓人不敢動數字
const rulesOut = buildSync({
    entryPoints: [path.join(ROOT, 'src/arcade/games/slot/rules.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const rulesMod = { exports: {} };
new Function('module', 'exports', 'require', rulesOut.outputFiles[0].text)(rulesMod, rulesMod.exports, createRequire(import.meta.url));
const { PAYOUTS } = rulesMod.exports;

/** 一條線該賠多少：賠率 × 單線押注 */
const pay = (sym, count, perLine) => Math.round(PAYOUTS[sym][count] * perLine);

const Sym = { Cherry: 0, Lemon: 1, Bell: 2, Bar: 3, Seven: 4, Wild: 5, Scatter: 6 };
const NAME = ['Cherry', 'Lemon', 'Bell', 'Bar', 'Seven', 'Wild', 'Scatter'];

const server = new SlotServer();
// evaluate 是 private，但 TS 的 private 只是編譯期的——執行期照樣呼叫得到
const evaluate = (grid, perLine) => server.evaluate(grid, perLine);

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
        console.log(`  ✗ ${name}\n      得到 ${a}\n      預期 ${e}`);
    }
}

/** 造一個 5×3 盤面：mid 是中線那 5 格，其餘填不會湊成線的東西 */
function gridWithMidLine(mid, filler = Sym.Scatter) {
    return mid.map((s) => [filler, s, filler]);
}

console.log('\n== 連線判定 ==');
// 中線 3 連 Bell：PAYOUTS[Bell][3] = 10，perLine = 20 → 200
check(
    'Bell 三連（中線）',
    evaluate(gridWithMidLine([Sym.Bell, Sym.Bell, Sym.Bell, Sym.Cherry, Sym.Lemon]), 20),
    [{ line: 0, symbol: Sym.Bell, count: 3, amount: pay(Sym.Bell, 3, 20) }]
);

// 只有 2 連不賠
check('Bell 兩連不賠', evaluate(gridWithMidLine([Sym.Bell, Sym.Bell, Sym.Cherry, Sym.Lemon, Sym.Bar]), 20), []);

// 不從最左邊起算的不賠——這是老虎機的通例，也是最容易寫錯的地方
check(
    '第 2 軸起的三連不算',
    evaluate(gridWithMidLine([Sym.Cherry, Sym.Bell, Sym.Bell, Sym.Bell, Sym.Lemon]), 20),
    []
);

// 五連 Seven：PAYOUTS[Seven][5] = 500，perLine 20 → 10000
check(
    'Seven 五連',
    evaluate(gridWithMidLine([Sym.Seven, Sym.Seven, Sym.Seven, Sym.Seven, Sym.Seven]), 20),
    [{ line: 0, symbol: Sym.Seven, count: 5, amount: pay(Sym.Seven, 5, 20) }]
);

console.log('\n== Wild 替代 ==');
// Wild 夾在中間替代 Bell
check(
    'Wild 替代成 Bell 三連',
    evaluate(gridWithMidLine([Sym.Bell, Sym.Wild, Sym.Bell, Sym.Cherry, Sym.Lemon]), 20),
    [{ line: 0, symbol: Sym.Bell, count: 3, amount: pay(Sym.Bell, 3, 20) }]
);

// 開頭是 Wild：目標該取第一個非 Wild（Seven），不是算成 Wild 的線
check(
    '開頭 Wild → 算成 Seven 的線',
    evaluate(gridWithMidLine([Sym.Wild, Sym.Seven, Sym.Seven, Sym.Cherry, Sym.Lemon]), 20),
    [{ line: 0, symbol: Sym.Seven, count: 3, amount: pay(Sym.Seven, 3, 20) }]
);

// 整條都是 Wild → 照 Wild 自己賠（最高）
check(
    '全 Wild 五連照 Wild 賠',
    evaluate(gridWithMidLine([Sym.Wild, Sym.Wild, Sym.Wild, Sym.Wild, Sym.Wild]), 20),
    [{ line: 0, symbol: Sym.Wild, count: 5, amount: pay(Sym.Wild, 5, 20) }]
);

// Scatter 會中斷連線（它不參與連線賠付）。
// 注意 filler 不能用同一個符號填滿——那會讓上下兩線自己湊成五連，測試就測不到想測的東西了。
{
    const g = [
        [Sym.Cherry, Sym.Bell, Sym.Lemon],
        [Sym.Lemon, Sym.Bell, Sym.Bell],
        [Sym.Bell, Sym.Scatter, Sym.Bar],
        [Sym.Bar, Sym.Bell, Sym.Seven],
        [Sym.Seven, Sym.Bell, Sym.Cherry],
    ];
    check('Scatter 中斷連線', evaluate(g, 20), []);
}

// 整條線的目標就是 Scatter 時直接跳過（Scatter 看的是全盤總數，不是連線）
{
    const g = [
        [Sym.Cherry, Sym.Scatter, Sym.Lemon],
        [Sym.Lemon, Sym.Scatter, Sym.Bell],
        [Sym.Bell, Sym.Scatter, Sym.Bar],
        [Sym.Bar, Sym.Scatter, Sym.Seven],
        [Sym.Seven, Sym.Scatter, Sym.Cherry],
    ];
    check('Scatter 五連不走連線賠付', evaluate(g, 20), []);
}

console.log('\n== 多線同時中 ==');
// 上線與中線都是 Bar 三連
{
    const g = [
        [Sym.Bar, Sym.Bar, Sym.Scatter],
        [Sym.Bar, Sym.Bar, Sym.Scatter],
        [Sym.Bar, Sym.Bar, Sym.Scatter],
        [Sym.Cherry, Sym.Lemon, Sym.Scatter],
        [Sym.Lemon, Sym.Cherry, Sym.Scatter],
    ];
    const r = evaluate(g, 20);
    check('上線＋中線各一注 Bar 三連', r.length, 2);
    check('兩線金額相同', r[0]?.amount === r[1]?.amount, true);
}

console.log('\n== 餘額結算 ==');
{
    const s = new SlotServer();
    const start = s.getBalance();
    const res = s.spin(100);
    const ok = !('error' in res);
    check('spin 回傳成功', ok, true);
    if (ok) {
        check('餘額 = 起始 − 押注 + 贏分', res.balance, start - 100 + res.totalWin);
        check('getBalance 與封包一致', s.getBalance(), res.balance);
    }
}
{
    const s = new SlotServer();
    check('押注超過餘額被擋', s.spin(999999), { error: 'insufficient_balance' });
    check('押注 0 被擋', s.spin(0), { error: 'invalid_bet' });
    check('被擋時餘額不變', s.getBalance(), 10000);
}

console.log('\n== 盤面形狀 ==');
{
    const s = new SlotServer();
    const res = s.spin(100);
    check('5 個轉軸', res.grid.length, 5);
    check('每軸 3 格', res.grid.every((c) => c.length === 3), true);
    check('符號都在合法範圍', res.grid.flat().every((v) => v >= 0 && v <= 6), true);
}

console.log('\n== 長期回報率（10 萬把，只是看數量級合理，不是嚴格驗證）==');
{
    const s = new SlotServer();
    let wagered = 0;
    let won = 0;
    let hits = 0;
    const N = 100000;
    for (let i = 0; i < N; i++) {
        // 餘額會見底，直接呼叫 evaluate 繞過餘額檢查
        const grid = s.rollGrid();
        const wins = evaluate(grid, 100 / 5);
        wagered += 100;
        const w = wins.reduce((a, b) => a + b.amount, 0);
        won += w;
        if (w > 0) hits++;
    }
    const rtp = ((won / wagered) * 100).toFixed(1);
    const hitRate = ((hits / N) * 100).toFixed(1);
    console.log(`  RTP ${rtp}% · 中獎率 ${hitRate}%`);
    // 真實機台多落在 92~97%。demo 不必精準，但超過 100% 代表長期玩家淨賺，
    // 那是配置錯誤而不是慷慨——一個做過博弈的人會先看這個數字
    check('RTP 落在 90%~99%', Number(rtp) >= 90 && Number(rtp) <= 99, true);
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail > 0 ? 1 : 0);
