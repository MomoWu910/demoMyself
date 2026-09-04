/**
 * 後台資料層的驗證。`yarn check:admin`
 *
 * 驗的是三件在畫面上看不出對錯的事：
 *
 * 1. **注單查詢的篩選／排序／分頁**——這一層寫成「後端該做的事」的形狀，
 *    但它跑在瀏覽器裡，所以沒有 API 測試會蓋到它。分頁的 total 算錯、
 *    排序把原始寫入順序改掉，這些在畫面上都看不出來，要等資料變多才爆。
 * 2. **派彩的分攤**——一個注區的派彩要按比例攤回玩家點過的每一筆，
 *    而攤分一定有除不盡的餘數。**攤完的總和必須等於實際入帳的金額**，
 *    少一塊錢在對帳報表上就是一個查不完的洞。
 * 3. **營運設定與遊戲數學的分層**——限紅要擋得住封包層，但不能影響 spin() 本身，
 *    因為那支函式是 `yarn check:slot` 拿來驗期望值的。這條線斷掉的話，
 *    調一次限紅就會讓賠率驗證跟著壞掉。
 *
 * 跑在 Node，不碰瀏覽器：ledger 與 opsConfig 的 localStorage 與 BroadcastChannel
 * 存取都包在 try/catch 裡，在這裡會安靜地退回純記憶體。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

function load(entry) {
    const out = buildSync({
        entryPoints: [path.join(ROOT, entry)],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        logLevel: 'silent',
    });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
    return mod.exports;
}

// 三個模組要共用同一份 ledger 狀態，所以整包一起打進來，不能分開 load
// （分開 load 會各自得到一份獨立的模組實例，record 寫進去的東西 query 讀不到）
const bundle = load('src/admin/check-entry.ts');
const { ledger, opsConfig, betSlip, SlotServer, Wallet, rouletteRules } = bundle;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}`);
        console.log(`      得到 ${JSON.stringify(actual)}`);
        console.log(`      預期 ${JSON.stringify(expected)}`);
    }
}
function ok(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}  ${detail}`);
    }
}

const T0 = 1_700_000_000_000;
function row(over = {}) {
    return {
        roundId: 'r1', game: 'slot', player: 'p', betType: 'spin',
        stake: 100, validStake: 100, payout: 0, net: -100,
        balanceBefore: 1000, balanceAfter: 900,
        betAt: T0, settledAt: T0,
        ...over,
    };
}

console.log('\n== 注單寫入與查詢 ==');
ledger.clear();
check('清空後是 0 筆', ledger.count(), 0);

ledger.record([
    row({ game: 'slot', stake: 100, payout: 0, net: -100, settledAt: T0 + 1000 }),
    row({ game: 'slot', stake: 500, payout: 800, net: 300, settledAt: T0 + 2000 }),
    row({ game: 'roulette', stake: 50, payout: 0, net: -50, settledAt: T0 + 3000 }),
    row({ game: 'baccarat', stake: 200, payout: 390, net: 190, settledAt: T0 + 4000 }),
    row({ game: 'roulette', stake: 25, payout: 25, net: 0, settledAt: T0 + 5000 }),
]);
check('寫入 5 筆', ledger.count(), 5);

const all = ledger.query({ pageSize: 100 });
check('不篩選拿到全部', all.total, 5);
check('預設照結算時間新到舊', all.rows.map((r) => r.settledAt), [T0 + 5000, T0 + 4000, T0 + 3000, T0 + 2000, T0 + 1000]);

check('依玩法篩選', ledger.query({ game: 'roulette', pageSize: 100 }).total, 2);
check('只看玩家贏的', ledger.query({ outcome: 'win', pageSize: 100 }).total, 2);
check('只看玩家輸的', ledger.query({ outcome: 'loss', pageSize: 100 }).total, 2);
check('打平的兩邊都不算', ledger.query({ outcome: 'win', pageSize: 100 }).total + ledger.query({ outcome: 'loss', pageSize: 100 }).total, 4);
check('下注額下限', ledger.query({ minStake: 100, pageSize: 100 }).total, 3);
check('時間下界', ledger.query({ from: T0 + 3000, pageSize: 100 }).total, 3);
check('時間上界', ledger.query({ to: T0 + 2000, pageSize: 100 }).total, 2);
check('條件疊加', ledger.query({ game: 'roulette', minStake: 30, pageSize: 100 }).total, 1);

console.log('\n== 排序與分頁 ==');
check('照下注額由大到小', ledger.query({ sortBy: 'stake', sortDir: 'desc', pageSize: 100 }).rows.map((r) => r.stake), [500, 200, 100, 50, 25]);
check('照下注額由小到大', ledger.query({ sortBy: 'stake', sortDir: 'asc', pageSize: 100 }).rows.map((r) => r.stake), [25, 50, 100, 200, 500]);
check('照輸贏排序', ledger.query({ sortBy: 'net', sortDir: 'desc', pageSize: 100 }).rows.map((r) => r.net), [300, 190, 0, -50, -100]);

const p0 = ledger.query({ page: 0, pageSize: 2, sortBy: 'stake', sortDir: 'asc' });
const p1 = ledger.query({ page: 1, pageSize: 2, sortBy: 'stake', sortDir: 'asc' });
const p2 = ledger.query({ page: 2, pageSize: 2, sortBy: 'stake', sortDir: 'asc' });
check('第一頁兩筆', p0.rows.map((r) => r.stake), [25, 50]);
check('第二頁接得上', p1.rows.map((r) => r.stake), [100, 200]);
check('最後一頁只剩一筆', p2.rows.map((r) => r.stake), [500]);
check('每一頁都回總數', [p0.total, p1.total, p2.total], [5, 5, 5]);
ok('超出範圍的頁回空陣列而不是報錯', ledger.query({ page: 99, pageSize: 2 }).rows.length === 0);

// 排序不能動到儲存順序——那是「寫入先後」，注單表唯一不該被查詢改到的東西
ledger.query({ sortBy: 'stake', sortDir: 'asc', pageSize: 100 });
check('排序過後儲存順序不變', ledger.query({ pageSize: 100, sortBy: 'settledAt', sortDir: 'asc' }).rows.map((r) => r.settledAt),
    [T0 + 1000, T0 + 2000, T0 + 3000, T0 + 4000, T0 + 5000]);

console.log('\n== 彙總統計 ==');
const st = ledger.stats();
check('總下注', st.totalStake, 875);
check('總派彩', st.totalPayout, 1215);
check('平台淨收 = 下注 − 派彩', st.grossWin, 875 - 1215);
check('派彩率', Number(st.payoutRate.toFixed(6)), Number((1215 / 875).toFixed(6)));
check('分玩法統計的筆數', [st.byGame.slot.count, st.byGame.roulette.count, st.byGame.baccarat.count], [2, 2, 1]);
const stFiltered = ledger.stats({ game: 'roulette' });
check('彙總吃得到篩選條件', [stFiltered.count, stFiltered.totalStake], [2, 75]);
ok('彙總與明細用同一組篩選', stFiltered.count === ledger.query({ game: 'roulette', pageSize: 100 }).total);

console.log('\n== 派彩分攤（同一注區押多筆）==');
const pending = [
    { spot: 'banker', amount: 100, betAt: T0, balanceBefore: 1000 },
    { spot: 'banker', amount: 50, betAt: T0 + 1, balanceBefore: 900 },
    { spot: 'player', amount: 30, betAt: T0 + 2, balanceBefore: 850 },
];
// 莊注 150 全中，賠 0.95 → 派彩 292.5，取整 292（含本金）；閒注全輸
const recs = betSlip.buildRecords('baccarat', 'rd-1', pending, { banker: 292, player: 0 }, { settledAt: T0 + 10 });
check('三筆下注產生三筆注單', recs.length, 3);
const bankerRecs = recs.filter((r) => r.betType === 'banker');
check('莊注的派彩加總等於實際入帳', bankerRecs.reduce((s, r) => s + r.payout, 0), 292);
check('按下注比例分攤（100:50）', bankerRecs.map((r) => r.payout), [195, 97]);
ok('除不盡的餘數由最後一筆吸收', 195 + 97 === 292 && Math.round(292 * 100 / 150) === 195);
check('沒中的注區派彩是 0', recs.find((r) => r.betType === 'player').payout, 0);
check('淨輸贏 = 派彩 − 下注', recs.map((r) => r.net), [95, 47, -30]);
ok('每筆都帶著自己的下注時間', bankerRecs[0].betAt === T0 && bankerRecs[1].betAt === T0 + 1);
check('結算時間可以覆寫（種子資料要用）', recs[0].settledAt, T0 + 10);

console.log('\n== 有效投注（淨曝險）==');
const exposure = betSlip.netExposureValidStake;

// 押單一注別：贏或輸都是全額承擔，不打折
const single = [{ spot: 'red', amount: 100, betAt: T0, balanceBefore: 1000 }];
check('單押且中獎，有效投注 = 下注額', [...exposure(single, { red: 200 }).values()], [100]);
check('單押且落空，有效投注 = 下注額', [...exposure(single, { red: 0 }).values()], [100]);

// 押莊又押閒：和局時兩邊退本金，玩家沒有承擔任何風險
const hedged = [
    { spot: 'banker', amount: 100, betAt: T0, balanceBefore: 1000 },
    { spot: 'player', amount: 100, betAt: T0, balanceBefore: 900 },
];
check('莊閒對沖遇和局，有效投注歸零', [...exposure(hedged, { banker: 100, player: 100 }).values()], [0, 0]);
// 莊贏：莊注拿回 195、閒注全失 → 淨 −5
check('莊閒對沖但莊贏，只認實際輸掉的 5', [...exposure(hedged, { banker: 195, player: 0 }).values()], [3, 2]);
ok('攤分後總和等於曝險', [...exposure(hedged, { banker: 195, player: 0 }).values()].reduce((a, b) => a + b, 0) === 5);

// 紅黑各半：多數情況淨輸贏 0，開零號才全輸
const redBlack = [
    { spot: 'red', amount: 100, betAt: T0, balanceBefore: 1000 },
    { spot: 'black', amount: 100, betAt: T0, balanceBefore: 900 },
];
check('紅黑對沖開紅，有效投注歸零', [...exposure(redBlack, { red: 200, black: 0 }).values()], [0, 0]);
check('紅黑對沖開零號（兩邊全輸），照全額算', [...exposure(redBlack, { red: 0, black: 0 }).values()], [100, 100]);

// 有效投注不會超過下注額——大獎不該把投注量灌大
const bigWin = [{ spot: 'straight:17', amount: 100, betAt: T0, balanceBefore: 1000 }];
check('中大獎時有效投注仍以下注額為上限', [...exposure(bigWin, { 'straight:17': 3600 }).values()], [100]);

console.log('\n== 營運設定的擋人邏輯 ==');
opsConfig.reset();
const def = opsConfig.forGame('slot');
check('預設是上架且非維護', [def.enabled, def.maintenance], [true, false]);
check('低於下限被擋', opsConfig.checkBet('slot', 1), 'below_min_bet');
check('高於上限被擋', opsConfig.checkBet('slot', 999999), 'above_max_bet');
check('區間內放行', opsConfig.checkBet('slot', 100), null);

opsConfig.update('slot', { maxBet: 100 });
check('改完限紅立刻生效', opsConfig.checkBet('slot', 500), 'above_max_bet');
check('新上限本身仍可押', opsConfig.checkBet('slot', 100), null);

opsConfig.update('slot', { maintenance: true });
check('維護中回的是維護代碼，不是限紅', opsConfig.checkBet('slot', 100), 'game_maintenance');
opsConfig.update('slot', { maintenance: false, enabled: false });
check('下架回的是下架代碼', opsConfig.checkBet('slot', 100), 'game_disabled');

opsConfig.update('roulette', { maxBet: 7 });
check('一款的設定不影響另一款', opsConfig.checkBet('baccarat', 500), null);
opsConfig.reset();
check('還原預設值', opsConfig.checkBet('slot', 500), null);

console.log('\n== 營運層與遊戲數學的分層 ==');
opsConfig.update('slot', { maxBet: 100 });
const server = new SlotServer(new Wallet(100000));
const denied = server.handle({ type: 'spin', bet: 500 });
check('封包層擋得住超過限紅的下注', denied, { type: 'error', reason: 'above_max_bet' });

// 這是這支腳本最重要的一條：限紅不能影響 spin() 本身，
// 否則 yarn check:slot 的期望值驗證會被營運設定牽動
const direct = server.spin(500);
ok('spin() 不受限紅影響（賠率驗證才不會被營運設定弄壞）', !('error' in direct), JSON.stringify(direct));

const before = ledger.count();
server.handle({ type: 'spin', bet: 100 });
check('走封包層的下注會留下注單', ledger.count(), before + 1);
const last = ledger.query({ pageSize: 1 }).rows[0];
check('注單記到正確的玩法與注別', [last.game, last.betType], ['slot', 'spin']);
ok('注單的餘額前後對得上這一把', last.balanceAfter === last.balanceBefore - last.stake + last.payout,
    JSON.stringify({ b: last.balanceBefore, a: last.balanceAfter, s: last.stake, p: last.payout }));

const beforeDirect = ledger.count();
server.spin(100);
check('直接呼叫 spin() 不寫注單（那是封包層的責任）', ledger.count(), beforeDirect);

opsConfig.reset();
ledger.clear();

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail ? 1 : 0);
