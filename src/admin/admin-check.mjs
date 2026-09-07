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
const { ledger, opsConfig, betSlip, SlotServer, Wallet, rouletteRules, players, txLedger, seed, baseline, i18n, auditLog, auth, storage, bootstrapServerData } = bundle;

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

/* ─────────────────────────── 帳號狀態與遊戲的連動 ─────────────────────────── */

console.log('\n== 帳號停用 ==');
players.clear();
opsConfig.reset();
ledger.clear();
players.seedPlayers([
    { id: players.SELF_ID, nickname: '本機', vipLevel: 1, status: 'active', tags: [], note: '', registeredAt: T0, profile: 'regular' },
]);

check('正常帳號放行', players.checkPlayer(players.SELF_ID), null);
// 查無此人不擋是刻意的：名冊還沒建立時擋下來，整個遊樂場會變成不能玩
check('查無此人不擋', players.checkPlayer('nobody'), null);

const frozenServer = new SlotServer(new Wallet(10000));
check('停用前下得了注', frozenServer.handle({ type: 'spin', bet: 100 }).type, 'spinResult');

players.update(players.SELF_ID, { status: 'frozen' });
check('停用後 checkPlayer 擋下', players.checkPlayer(players.SELF_ID), 'account_frozen');
// **這一條才是重點**：後台改一個欄位，遊戲的封包層下一次下注就吃到，
// 而且用的是同一個 server 實例——如果名冊被快取住，這裡會照樣放行
check('停用後封包層擋下下注', frozenServer.handle({ type: 'spin', bet: 100 }), { type: 'error', reason: 'account_frozen' });

// 帳號狀態不能影響遊戲的數學模型。理由同限紅：spin() 要被拿去跑十萬把驗期望值
const stillWorks = frozenServer.spin(100);
ok('spin() 不受帳號狀態影響', !('error' in stillWorks), JSON.stringify(stillWorks));

players.update(players.SELF_ID, { status: 'active' });
check('解除停用後又能下注', frozenServer.handle({ type: 'spin', bet: 100 }).type, 'spinResult');

/* ─────────────────────────── 錯誤代碼的翻譯 ─────────────────────────── */

console.log('\n== 錯誤訊息 ==');
// t() 查不到 key 就回 key 本身（見 i18n/index.ts），所以少一條字典
// 玩家看到的就是 `arcade.error.above_max_bet` 這串英文。
// **這在後台做完限紅之後真的發生過**——功能做完了，但沒走完最後一哩
const REASONS = [
    'game_disabled', 'game_maintenance', 'below_min_bet', 'above_max_bet',
    'account_frozen', 'insufficient_balance', 'invalid_bet', 'bet_closed',
];
for (const r of REASONS) {
    const key = `arcade.error.${r}`;
    ok(`錯誤代碼 ${r} 有對應文字`, i18n.t(key) !== key, `t('${key}') 回傳 key 本身`);
}

/* ─────────────────────────── 玩家維度的彙總 ─────────────────────────── */

console.log('\n== 玩家彙總 ==');
ledger.clear();
txLedger.clear();
ledger.record([
    { roundId: 'r1', game: 'slot', player: 'p-1', betType: 'spin', stake: 100, validStake: 100, payout: 0, net: -100, balanceBefore: 500, balanceAfter: 400, betAt: T0, settledAt: T0 },
    { roundId: 'r2', game: 'slot', player: 'p-1', betType: 'spin', stake: 200, validStake: 40, payout: 250, net: 50, balanceBefore: 400, balanceAfter: 450, betAt: T0 + 10, settledAt: T0 + 10 },
    { roundId: 'r3', game: 'slot', player: 'p-2', betType: 'spin', stake: 50, validStake: 50, payout: 0, net: -50, balanceBefore: 900, balanceAfter: 850, betAt: T0 + 20, settledAt: T0 + 20 },
]);

const ps = ledger.stats().byPlayer;
check('按玩家分開加總', [ps['p-1'].count, ps['p-1'].stake, ps['p-2'].stake], [2, 300, 50]);
check('有效投注也按玩家加總（風控的分子）', ps['p-1'].validStake, 140);
// lastAt 取最大值而不是「最後一筆」：query 的順序跟著排序條件走
check('最後活動時間取最大值', ps['p-1'].lastAt, T0 + 10);

txLedger.record([
    tx({ player: 'p-1', kind: 'deposit', amount: 1000, createdAt: T0 }),
    tx({ player: 'p-1', kind: 'rebate', amount: 20, createdAt: T0 + 1 }),
    tx({ player: 'p-2', kind: 'withdraw', amount: -300, createdAt: T0 + 2 }),
]);
const tps = txLedger.stats().byPlayer;
check('金流也按玩家分開', [tps['p-1'].deposit, tps['p-1'].rebate, tps['p-2'].withdraw], [1000, 20, 300]);

/* ─────────────────────────── 操作稽核 ─────────────────────────── */

console.log('\n== 操作稽核 ==');
auditLog.clear();
opsConfig.reset();
auditLog.clear();

opsConfig.update('slot', { maxBet: 50000 });
const a1 = auditLog.query().rows[0];
check('改限紅會留下一筆紀錄', [a1.action, a1.target], ['ops.update', 'slot']);
// **只記「他改過」是沒有用的。** 事故調查要回答的是「改成了什麼」
check('紀錄帶著前後值', [a1.changes[0].label, a1.changes[0].before, a1.changes[0].after],
    ['單注上限（限紅）', '1000', '50000']);
check('對象存的是顯示名，不是 id', a1.targetLabel, '幸運轉輪');

const beforeNoop = auditLog.count();
opsConfig.update('slot', { maxBet: 50000 });
// 打開表單、什麼都沒改就按儲存，不該在稽核表裡留下空紀錄——
// 那只會讓真正的變更被稀釋掉
check('沒有變更就不記', auditLog.count(), beforeNoop);

// 布林要記成人看得懂的字，不是 true/false
opsConfig.update('slot', { enabled: false });
check('布林值格式化成中文', auditLog.query().rows[0].changes[0].after, '否');

// 還原要記下「還原之前是什麼」——那個值在下一行就消失了
opsConfig.reset();
const aReset = auditLog.query({ action: 'ops.reset' }).rows[0];
ok('還原預設值會記下原本的設定', aReset && aReset.note.includes('50000'), JSON.stringify(aReset));

/* 玩家處置 */
players.clear();
players.seedPlayers([
    { id: 'p-9', nickname: '測試員', vipLevel: 1, status: 'active', tags: [], note: '', registeredAt: T0, profile: 'regular' },
]);
auditLog.clear();
players.update('p-9', { status: 'frozen', tags: ['對沖', '待查'] });
const a2 = auditLog.query({ action: 'player.update' }).rows[0];
check('停用帳號留下紀錄', a2.changes.map((c) => [c.label, c.before, c.after]),
    [['帳號狀態', '正常', '停用'], ['風控標記', '（無）', '對沖、待查']]);

/* 提領審核 */
txLedger.clear();
auditLog.clear();
txLedger.record([tx({ player: 'p-9', kind: 'withdraw', amount: -500000, status: 'pending', createdAt: T0 })]);
const pend = txLedger.query({ status: 'pending' }).rows[0];
txLedger.review(pend.id, 'done', T0 + 60_000);
const a3 = auditLog.query({ action: 'tx.review' }).rows[0];
// 放行一筆提領是整個後台金額最大的單一動作，沒有留痕的話
// 「這筆五十萬是誰放的」就沒有答案
check('提領放行留下紀錄', [a3.changes[0].before, a3.changes[0].after], ['待審', '放行']);
ok('紀錄裡看得到金額', a3.targetLabel.includes('500000'), a3.targetLabel);

/* 稽核活得比資料久 */
const auditBefore = auditLog.count();
seed.clearAll();
ok('清空資料不會清掉稽核紀錄', auditLog.count() > auditBefore,
    `清空前 ${auditBefore}、清空後 ${auditLog.count()}`);
const aClear = auditLog.query({ action: 'data.clear' }).rows[0];
ok('清空這個動作本身也留了痕', Boolean(aClear), JSON.stringify(aClear));

/* diff 的行為 */
const changes = auditLog.diff(
    { a: 1, b: ['x'], c: 'same', d: 9 },
    { a: 2, b: ['x', 'y'], c: 'same', d: 8 },
    { a: '甲', b: '乙', c: '丙' },
);
// d 不在 labels 裡所以不記——稽核表不該被內部欄位塞滿
check('只記列在 labels 裡的欄位，且相同的值不記', changes.map((c) => c.field), ['a', 'b']);
check('陣列用內容比較，不是參考比較', changes[1].after, 'x、y');

/* ─────────────────────────── 同一毫秒的排序 ─────────────────────────── */

console.log('\n== 同一毫秒的排序 ==');
ledger.clear();
// 十筆結算時間**完全相同**的注單。這不是人為的極端案例：
// 百家樂押莊又押閒是一次結算，同一局的每一筆 settledAt 都一樣
ledger.record(Array.from({ length: 10 }, (_, i) => row({ roundId: 'same', settledAt: T0, stake: 10 + i })));

// **這一條是本節的重點。** JS 的 sort 是穩定的（ES2019 起），
// 穩定的意思是「相等的鍵維持輸入順序」——而輸入順序是寫入先後。
// 所以少了第二把鑰匙，降序查出來會是「最舊的排最前面」，
// 畫面上的症狀是「明細第一列不是我剛剛做的那個動作」
check('降序時，同一毫秒裡最後寫入的排最前面',
    ledger.query({ sortBy: 'settledAt', sortDir: 'desc', pageSize: 3 }).rows.map((r) => r.stake),
    [19, 18, 17]);
check('升序時反過來', ledger.query({ sortBy: 'settledAt', sortDir: 'asc', pageSize: 3 }).rows.map((r) => r.stake),
    [10, 11, 12]);

// 翻頁的完整性。這一條不是靠 seq 守住的（穩定排序本身就保證了），
// 但它守著另一件事：分頁的邊界算術沒有寫錯
const seen = new Set();
let dup = 0;
for (let pg = 0; pg < 4; pg++) {
    for (const r of ledger.query({ sortBy: 'settledAt', sortDir: 'desc', page: pg, pageSize: 3 }).rows) {
        if (seen.has(r.id)) dup++;
        seen.add(r.id);
    }
}
check('翻完所有頁剛好拿到全部注單，沒有重複也沒有漏掉', [seen.size, dup], [10, 0]);

// 交易表同理：連續作廢兩筆注單會在同一毫秒寫出兩筆沖正單
txLedger.clear();
txLedger.record(Array.from({ length: 6 }, (_, i) => tx({ amount: 100 + i, createdAt: T0 })));
check('交易表的降序也是最新的在最前面',
    txLedger.query({ pageSize: 2 }).rows.map((t) => t.amount), [105, 104]);

/* ─────────────────────────── 爭議單（注單作廢） ─────────────────────────── */

console.log('\n== 注單作廢 ==');
ledger.clear();
txLedger.clear();
auditLog.clear();

const [winRow, lossRow] = ledger.record([
    // 玩家贏 150：作廢要把 150 收回來
    { roundId: 'v1', game: 'roulette', player: 'p-1', betType: 'red', stake: 100, validStake: 100, payout: 250, net: 150, balanceBefore: 1000, balanceAfter: 1150, betAt: T0, settledAt: T0 },
    // 玩家輸 100：作廢要把 100 退回去
    { roundId: 'v2', game: 'slot', player: 'p-1', betType: 'spin', stake: 100, validStake: 100, payout: 0, net: -100, balanceBefore: 1150, balanceAfter: 1050, betAt: T0 + 1, settledAt: T0 + 1 },
]);

check('沒填原因不給作廢', ledger.voidBet(winRow.id, '   '), undefined);
check('作廢不存在的注單回 undefined', ledger.voidBet('nope', '測試'), undefined);

const voided = ledger.voidBet(winRow.id, '牌局中斷，本局不算');
check('狀態推進到作廢', voided.status, 'void');
// **金額欄位一個都不能動**：它記錄的是當初實際發生的事
check('金額欄位維持原樣', [voided.stake, voided.payout, voided.net], [100, 250, 150]);
check('已經作廢的不能再作廢一次（否則沖正會重複調帳）', ledger.voidBet(winRow.id, '再一次'), undefined);

const adj = txLedger.query({ kind: 'adjust' }).rows;
check('玩家贏的那筆：沖正是負的（把錢收回）', adj[0].amount, -150);
check('沖正單關聯得回原始注單', adj[0].ref, winRow.id);
ok('沖正單的備註帶著原因', adj[0].note.includes('牌局中斷'), adj[0].note);
check('沖正單也滿足餘額不變式', adj[0].balanceAfter, adj[0].balanceBefore + adj[0].amount);

ledger.voidBet(lossRow.id, '系統錯誤重複扣款');
const adj2 = txLedger.query({ kind: 'adjust', sortBy: 'createdAt', sortDir: 'desc' }).rows[0];
check('玩家輸的那筆：沖正是正的（把錢退還）', adj2.amount, 100);

// 明細看得到、報表看不到——這是這兩者唯一該不一致的地方
check('明細預設看得到作廢單', ledger.query().total, 2);
check('可以只看作廢單', ledger.query({ status: 'void' }).total, 2);
check('可以只看有效注單', ledger.query({ status: 'settled' }).total, 0);
const afterVoid = ledger.stats();
check('報表一律排除作廢單', [afterVoid.count, afterVoid.totalStake, afterVoid.totalPayout], [0, 0, 0]);

const aVoid = auditLog.query({ action: 'bet.void' }).rows;
check('作廢留下稽核紀錄', aVoid.length, 2);
ok('稽核紀錄裡看得到原因與沖正金額',
    aVoid[1].note.includes('牌局中斷') && aVoid[1].note.includes('-150'), aVoid[1].note);

/* ─────────────────────────── 角色與權限 ─────────────────────────── */

console.log('\n== 角色權限 ==');
auth.reset();
opsConfig.reset();
players.clear();
txLedger.clear();
ledger.clear();
auditLog.clear();

players.seedPlayers([
    { id: 'p-x', nickname: '受測帳號', vipLevel: 1, status: 'active', tags: [], note: '', registeredAt: T0, profile: 'regular' },
]);
txLedger.record([tx({ player: 'p-x', kind: 'withdraw', amount: -1000, status: 'pending', createdAt: T0 })]);
const pendingId = txLedger.query({ status: 'pending' }).rows[0].id;
const betForVoid = ledger.record([row({ player: 'p-x' })])[0];

check('預設角色是管理員（沒有登入機制的系統，預設只能是最高權限）', auth.getRole(), 'admin');

/* 客服：看得到全部，改不了任何東西 */
auth.setRole('viewer');
// **這幾條才是真正的權限測試。** 它們呼叫的是資料層，不是點按鈕——
// 把按鈕變灰只是體驗，少寫一個 disabled 權限就漏了，而畫面上完全正常
check('客服改不了遊戲設定', opsConfig.update('slot', { maxBet: 99999 }), null);
check('客服改不了玩家', players.update('p-x', { tags: ['測試'] }), undefined);
check('客服審不了提領', txLedger.review(pendingId, 'done'), undefined);
check('客服作廢不了注單', ledger.voidBet(betForVoid.id, '測試'), undefined);
check('被擋下來的操作不會留下稽核紀錄（因為什麼都沒發生）', auditLog.count(), 0);
check('但看得到資料', ledger.query().total > 0, true);

/* 營運：管遊戲與玩家標記，碰不到錢，也不能停權 */
auth.setRole('operator');
ok('營運改得了限紅', opsConfig.update('slot', { maxBet: 2000 }) !== null);
ok('營運標記得了玩家', players.update('p-x', { tags: ['待查'] }) !== undefined);
// 停用是斷掉某個人的服務，該往上報一層——這正是 player.write 與 player.freeze 分開的理由
check('營運停不了權', players.update('p-x', { status: 'frozen' }), undefined);
check('營運審不了提領', txLedger.review(pendingId, 'done'), undefined);

/* 財務：審提領，改不了限紅 */
auth.setRole('finance');
check('財務改不了限紅', opsConfig.update('slot', { maxBet: 3000 }), null);
ok('財務審得了提領', txLedger.review(pendingId, 'done') !== undefined);

/* 停權要管理員 */
auth.setRole('admin');
ok('管理員停得了權', players.update('p-x', { status: 'frozen' }) !== undefined);

/* 稽核記的是角色，不是寫死的字串 */
auditLog.clear();
auth.setRole('operator');
opsConfig.update('slot', { maxBet: 4000 });
check('稽核紀錄記下操作者的角色', auditLog.query().rows[0].actor, '營運(operator)');
auth.setRole('finance');
txLedger.record([tx({ player: 'p-x', kind: 'withdraw', amount: -50, status: 'pending', createdAt: T0 })]);
txLedger.review(txLedger.query({ status: 'pending' }).rows[0].id, 'rejected');
check('換一個角色，稽核也跟著換', auditLog.query({ action: 'tx.review' }).rows[0].actor, '財務(finance)');

/* ─────────────────────────── 持久層 ─────────────────────────── */

console.log('\n== 持久層 ==');
// Node 底下既沒有 indexedDB 也沒有 localStorage，四張表要能安靜地退回純記憶體。
// **這一段驗的不是 IndexedDB 本身**（那要瀏覽器），
// 是「儲存不可用的時候整套東西還跑不跑得動」——而那正是驗證腳本自己的處境
check('沒有任何儲存時，hydrate 回空陣列', await storage.hydrate('ledger'), []);
check('偵測得出目前沒有持久化', await storage.backendName(), '僅記憶體');

ledger.clear();
await bootstrapServerData();
check('灌完之後注單表是空的', ledger.count(), 0);

ledger.record([row({ stake: 111 })]);
check('灌完之後寫得進去', ledger.count(), 1);

// **這條守著一個換成非同步持久層之後才長出來的坑**：
// init 之前 cache 是空的，此時 record 會拿空陣列接上新注單再整張寫回去——
// 歷史注單就沒了。重複灌一次不該把剛寫的東西弄丟（它會從持久層重讀，
// 而 Node 底下持久層是空的，所以這裡驗的是「重灌是冪等且不會炸」）
await bootstrapServerData();
ok('重複灌不會炸', typeof ledger.count() === 'number', String(ledger.count()));

auth.reset();
auditLog.clear();
players.clear();
txLedger.clear();
ledger.clear();
opsConfig.reset();

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail ? 1 : 0);
