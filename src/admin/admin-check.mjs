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
const { ledger, opsConfig, betSlip, SlotServer, Wallet, rouletteRules, players, txLedger, seed, baseline } = bundle;

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

/* ─────────────────────────── 玩家名冊 ─────────────────────────── */

console.log('\n== 玩家名冊 ==');
players.clear();
players.seedPlayers([
    { id: 'p-1', nickname: '甲', vipLevel: 1, status: 'active', tags: [], note: '', registeredAt: T0, profile: 'regular' },
    { id: 'p-2', nickname: '乙', vipLevel: 3, status: 'active', tags: ['對沖'], note: '', registeredAt: T0, profile: 'hedger' },
]);
check('名冊寫得進去也讀得回來', players.count(), 2);
check('可以按 id 取單一玩家', players.get('p-2').nickname, '乙');

players.update('p-1', { tags: ['待查'], note: '客服標記' });
check('標記與備註改得動', [players.get('p-1').tags, players.get('p-1').note], [['待查'], '客服標記']);

// 白名單：即使 patch 裡帶了 id 與註冊時間，也不該被覆蓋。
// 這條擋的是「表單多送一個欄位就把註冊時間洗掉」，那種事故在對帳時最難查
players.update('p-1', { id: 'hacked', registeredAt: 0, vipLevel: 4 });
check('只有白名單裡的欄位改得動', [players.get('p-1').id, players.get('p-1').registeredAt, players.get('p-1').vipLevel], ['p-1', T0, 4]);
check('改不存在的玩家回 undefined', players.update('nobody', { vipLevel: 5 }), undefined);

/* ─────────────────────────── 資金流水 ─────────────────────────── */

console.log('\n== 資金流水 ==');
txLedger.clear();

/** 產一筆交易。餘額前後照不變式算，測試自己不該偷偷寫出違反不變式的資料 */
function tx(over = {}) {
    const amount = over.amount ?? 1000;
    const balanceBefore = over.balanceBefore ?? 5000;
    return {
        player: 'p-1', kind: 'deposit', amount, balanceBefore,
        balanceAfter: balanceBefore + amount, status: 'done',
        ref: '', note: '', createdAt: T0, reviewedAt: 0,
        ...over,
    };
}

txLedger.record([
    tx({ kind: 'deposit', amount: 1000, createdAt: T0 }),
    tx({ kind: 'withdraw', amount: -400, createdAt: T0 + 1000 }),
    tx({ kind: 'rebate', amount: 30, createdAt: T0 + 2000 }),
    tx({ kind: 'deposit', amount: 500, player: 'p-2', createdAt: T0 + 3000 }),
]);
check('交易寫得進去', txLedger.count(), 4);
check('按玩家篩選', txLedger.query({ player: 'p-2' }).total, 1);
check('按類型篩選', txLedger.query({ kind: 'deposit' }).total, 2);

const ts = txLedger.stats();
check('儲值與提領分開加總（提領取正數方便並排比較）', [ts.deposit, ts.withdraw, ts.rebate], [1500, 400, 30]);
check('淨存入 = 儲值 − 提領', ts.netDeposit, 1100);

// 待審的提領不計入已提領金額，但要單獨算出來——營運早上第一個看的就是這個數
txLedger.record([tx({ kind: 'withdraw', amount: -900, status: 'pending', createdAt: T0 + 4000 })]);
const ts2 = txLedger.stats();
check('待審提領單獨計，不混進已提領', [ts2.withdraw, ts2.pendingCount, ts2.pendingAmount], [400, 1, 900]);

/* 提領審核 */
const pendingRow = txLedger.query({ status: 'pending' }).rows[0];
const beforeReject = txLedger.count();
txLedger.review(pendingRow.id, 'rejected', T0 + 5000);
const rejected = txLedger.query({ status: 'rejected' }).rows[0];

// **退件不能把金額洗掉。** 第一版把 amount 歸零、餘額還原，
// 結果是「被退掉的五十萬提領」在報表上跟一筆從未存在的紀錄長得一樣，
// 而且打破了 balanceAfter = balanceBefore + amount 這條可以驗全表的等式
check('退件保留原本的申請金額', rejected.amount, -900);
check('退件會另外開一筆退款交易', txLedger.count(), beforeReject + 1);
const refund = txLedger.query({ kind: 'adjust' }).rows[0];
check('退款單關聯得回原始的提領單', [refund.kind, refund.amount, refund.ref], ['adjust', 900, pendingRow.id]);
const ts3 = txLedger.stats();
check('退件後：提領金額不變，退款計入調整', [ts3.withdraw, ts3.adjust, ts3.pendingCount], [400, 900, 0]);

check('已審過的單不能再審一次', txLedger.review(rejected.id, 'done'), undefined);
check('儲值單不是提領，審不了', txLedger.review(txLedger.query({ kind: 'deposit' }).rows[0].id, 'done'), undefined);

/* 返水 */
check('返水按等級計算', [txLedger.rebateFor(10000, 0), txLedger.rebateFor(10000, 5)], [30, 80]);
check('等級超出範圍取最高階，不會回 NaN', txLedger.rebateFor(10000, 99), 80);
// 無條件捨去：返水是平台付出去的錢，四捨五入會讓總成本比預期高
check('返水無條件捨去', txLedger.rebateFor(333, 0), 0);

/* ─────────────────────────── 有效樣本數與偏離門檻 ─────────────────────────── */

console.log('\n== 偏離判定 ==');

// 十筆等額的注：有效樣本數等於筆數
check('等額下注時，有效樣本數等於筆數', baseline.effectiveSample(1000, 100 * 100 * 10), 10);
// 一筆大注加九筆小注：筆數 10，但有效樣本數遠低於 10
const eff = baseline.effectiveSample(9 * 10 + 1000, 9 * 100 + 1000 * 1000);
ok('注額不均時，有效樣本數遠小於筆數', eff < 2, `得到 ${eff.toFixed(2)}`);

// 同樣的偏離幅度、同樣的樣本數，變異大的玩法不該被判成異常——
// 這條就是老虎機一直誤報的那個 bug。
// 樣本數取 1000 是刻意的：這個區間剛好落在兩款玩法的判定分界之間
// （老虎機的標準誤 8.4pp、百家樂 4.3pp，而偏離都是 14.2pp），
// 換句話說**同一份數字，換一款玩法就是完全不同的結論**
const lvSlot = baseline.deviationLevel(0.80, 0.9421, 1000, baseline.BASELINE_BET_STD.slot);
const lvBac = baseline.deviationLevel(0.80, 0.9421, 1000, baseline.BASELINE_BET_STD.baccarat);
check('同一個偏離：高變異的玩法判樣本內、低變異的判異常', [lvSlot, lvBac], ['normal', 'alert']);
check('有效樣本數太少時不做判斷', baseline.deviationLevel(0.5, 0.94, 10, 1), 'normal');

/* ─────────────────────────── 種子資料 ─────────────────────────── */

console.log('\n== 種子資料 ==');
opsConfig.reset();
const gen = seed.generate({ days: 5, roundsPerDay: { min: 80, max: 100 }, playerCount: 12 });

ok('產生了多個玩家', gen.players.length === 13, `得到 ${gen.players.length}（12 個歷史帳號 + 本機帳號）`);
const ids = new Set(gen.players.map((p) => p.id));
ok('每一筆注單的玩家都在名冊裡', gen.bets.every((b) => ids.has(b.player)), '有注單指向不存在的帳號');
ok('每一筆交易的玩家都在名冊裡', gen.transactions.every((t) => ids.has(t.player)), '有交易指向不存在的帳號');

// 種子繞過封包層直接呼叫 spin()／settleBets()，所以限紅要自己夾。
// 沒夾的時候產生過一批「真實遊戲裡根本押不進去」的注單，
// 而它在報表上的症狀是老虎機的派彩率掉了二十個百分點
const overLimit = gen.bets.filter((b) => {
    const ops = opsConfig.forGame(b.game);
    return b.stake < ops.minBet || b.stake > ops.maxBet;
});
check('沒有任何一筆注單違反限紅', overLimit.length, 0);

const badTx = gen.transactions.filter((t) => t.balanceAfter !== t.balanceBefore + t.amount);
check('每一筆交易都滿足 balanceAfter = balanceBefore + amount', badTx.length, 0);
ok('沒有負餘額的注單', gen.bets.every((b) => b.balanceAfter >= 0), '有注單把餘額打成負的');

// 對沖客要真的看得出來，否則風控頁沒有東西可以抓
const ratio = {};
for (const b of gen.bets) {
    const r = (ratio[b.player] ??= { stake: 0, valid: 0 });
    r.stake += b.stake;
    r.valid += b.validStake;
}
const profileOf = Object.fromEntries(gen.players.map((p) => [p.id, p.profile]));
const hedgers = Object.entries(ratio).filter(([id]) => profileOf[id] === 'hedger');
const others = Object.entries(ratio).filter(([id]) => profileOf[id] !== 'hedger' && ratio[id].stake > 0);
const worstHedger = Math.max(...hedgers.map(([, r]) => r.valid / r.stake));
const bestOther = Math.min(...others.map(([, r]) => r.valid / r.stake));
ok('對沖客的有效投注比明顯低於其他玩家（風控抓得到）',
    hedgers.length > 0 && worstHedger < 0.3 && bestOther > 0.5,
    `對沖客最高 ${(worstHedger * 100).toFixed(1)}%、其他人最低 ${(bestOther * 100).toFixed(1)}%`);

// 種子的亂數有固定種子，同樣的參數要跑出同樣的資料——
// demo 重跑一次不該因為剛好開出一串大獎就得臨場解釋變異數
const again = seed.generate({ days: 5, roundsPerDay: { min: 80, max: 100 }, playerCount: 12 });
check('同一組參數產生同一份資料', again.bets.length, gen.bets.length);
check('連金額都一樣', again.bets.reduce((s, b) => s + b.stake, 0), gen.bets.reduce((s, b) => s + b.stake, 0));

players.clear();
txLedger.clear();
ledger.clear();

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail ? 1 : 0);
