/**
 * 百家樂的規則與賠付驗證。`npm run check:baccarat`
 *
 * 為什麼需要它：補牌表是**抄的**，而抄錯一格不會有任何症狀——牌照發、錢照賠，
 * 只有長期回報率會偏掉一點點。這種錯在畫面上永遠看不出來。
 *
 * 好消息是百家樂的莊家優勢是**公開的已知數**（八副牌、莊家抽 5% 水的情況下
 * 莊 1.06%、閒 1.24%、和 8:1 為 14.4%、對子 11:1 為 10.4%），所以這支腳本不只是
 * 「跟我自己寫的預期對答案」——模擬夠多局之後，數字必須落在這些**外部真值**附近。
 * 補牌表抄錯、和局忘了退還本金、對子判定看成點數而不是牌面，都會讓它們偏出容許範圍。
 *
 * 跟 rtp-check.mjs 一樣不引進測試框架：一支腳本、一個離開碼。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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

const { cardValue, handTotal, playerDraws, bankerDraws, settleRound, settleBets, BET_SPOTS } = load(
    'src/arcade/games/baccarat/rules.ts'
);
const { BaccaratServer } = load('src/arcade/server/baccaratServer.ts');
const { Wallet } = load('src/arcade/server/wallet.ts');

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

function ok(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}${detail ? `　${detail}` : ''}`);
    }
}

/** 造一張指定點數的牌。rank 直接當點數用（1~9），0 點用 K。 */
const card = (rank) => ({ rank: rank === 0 ? 13 : rank, suit: 'spade' });
/** 依發牌順序（閒莊閒莊…）造一手牌 */
const deal = (...ranks) => ranks.map(card);

console.log('\n== 牌值 ==');
{
    check('A 算 1 點', cardValue({ rank: 1, suit: 'spade' }), 1);
    check('9 照面值', cardValue({ rank: 9, suit: 'spade' }), 9);
    check('10 算 0 點', cardValue({ rank: 10, suit: 'spade' }), 0);
    check('J 算 0 點', cardValue({ rank: 11, suit: 'spade' }), 0);
    check('Q 算 0 點', cardValue({ rank: 12, suit: 'spade' }), 0);
    check('K 算 0 點', cardValue({ rank: 13, suit: 'spade' }), 0);
    check('點數取個位數（7+8=15→5）', handTotal(deal(7, 8)), 5);
    check('三張也取個位數（9+9+9=27→7）', handTotal(deal(9, 9, 9)), 7);
}

console.log('\n== 閒家補牌 ==');
{
    for (let t = 0; t <= 5; t++) ok(`閒家 ${t} 點要補`, playerDraws(t) === true);
    ok('閒家 6 點停牌', playerDraws(6) === false);
    ok('閒家 7 點停牌', playerDraws(7) === false);
}

console.log('\n== 莊家補牌表（窮舉）==');
{
    // 閒家沒補牌時，莊家照自己的點數決定，規則跟閒家一樣
    for (let t = 0; t <= 5; t++) ok(`閒家沒補、莊家 ${t} 點要補`, bankerDraws(t, null) === true);
    ok('閒家沒補、莊家 6 點停牌', bankerDraws(6, null) === false);
    ok('閒家沒補、莊家 7 點停牌', bankerDraws(7, null) === false);

    // 閒家補了第三張：逐格對照規則表。這張表是抄的，所以整張攤開來比，
    // 而不是只挑幾個點測——抄錯的那一格剛好沒被測到的機率太高了
    const table = {
        0: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        1: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        2: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        3: [1, 1, 1, 1, 1, 1, 1, 1, 0, 1], // 只有閒家第三張是 8 時停
        4: [0, 0, 1, 1, 1, 1, 1, 1, 0, 0], // 2~7 才補
        5: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0], // 4~7 才補
        6: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0], // 6~7 才補
        7: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 一律停
    };
    let cells = 0;
    let wrong = [];
    for (const total of Object.keys(table)) {
        for (let third = 0; third <= 9; third++) {
            cells++;
            const expected = table[total][third] === 1;
            if (bankerDraws(Number(total), third) !== expected) wrong.push(`莊${total}/閒三${third}`);
        }
    }
    // 一併驗「到底比了幾格」——迴圈寫錯的話會是 0 格然後印綠燈
    check('整張表 8×10 格都比對到', cells, 80);
    ok('每一格都符合規則表', wrong.length === 0, wrong.join('、'));
}

console.log('\n== 天牌 ==');
{
    // 閒 8 點、莊 5 點：天牌，莊家不補（若補了會變 5+? 可能反超）
    const r = settleRound(deal(4, 2, 4, 3, 9, 9));
    check('天牌時閒家只有兩張', r.player.length, 2);
    check('天牌時莊家只有兩張', r.banker.length, 2);
    check('天牌旗標', r.natural, true);
    check('8 點勝 5 點', r.outcome, 'player');
}
{
    // 雙方都是天牌但點數不同
    const r = settleRound(deal(4, 4, 4, 5, 9, 9));
    check('莊 9 點勝閒 8 點', r.outcome, 'banker');
    check('雙天牌也不補牌', r.player.length + r.banker.length, 4);
}
{
    const r = settleRound(deal(4, 4, 5, 5, 9, 9));
    check('同為 9 點是和局', r.outcome, 'tie');
}

console.log('\n== 補牌後的判定 ==');
{
    // 閒 0+3=3 → 補；莊 0+2=2 → 一律補
    const r = settleRound(deal(0, 0, 3, 2, 5, 6));
    check('閒家補到第三張', r.player.length, 3);
    check('莊家補到第三張', r.banker.length, 3);
    check('閒 3+5=8', r.playerTotal, 8);
    check('莊 2+6=8', r.bankerTotal, 8);
    check('補牌後同點數是和局', r.outcome, 'tie');
}
{
    // 閒 6 點停牌，莊 5 點 → 閒家沒補時莊家 0~5 補
    const r = settleRound(deal(2, 2, 4, 3, 1, 1));
    check('閒家 6 點沒補', r.player.length, 2);
    check('閒家沒補時莊家照自己點數補', r.banker.length, 3);
}
{
    // 莊 7 點：不管閒家補什麼都停牌
    const r = settleRound(deal(0, 3, 2, 4, 9, 9));
    check('莊家 7 點停牌', r.banker.length, 2);
    check('閒家 2 點有補', r.player.length, 3);
}

console.log('\n== 對子 ==');
{
    const r = settleRound(deal(5, 3, 5, 3, 1, 1));
    check('閒家前兩張同點數是對子', r.playerPair, true);
    check('莊家前兩張同點數是對子', r.bankerPair, true);
}
{
    // K 與 Q 都是 0 點但**不是對子**——對子看的是牌面不是點數。
    // 這一條寫錯的話對子注會多賠一大票，是最容易搞混的規則之一
    const r = settleRound([{ rank: 13, suit: 'spade' }, { rank: 5, suit: 'heart' }, { rank: 12, suit: 'club' }, { rank: 5, suit: 'diamond' }, card(1), card(1)]);
    check('K 配 Q 不算對子（點數同為 0）', r.playerPair, false);
    check('同點數的 5 配 5 才算', r.bankerPair, true);
}

console.log('\n== 賠付 ==');
{
    const round = { outcome: 'player', playerPair: false, bankerPair: false };
    const out = settleBets({ player: 100, banker: 100, tie: 100 }, round);
    check('閒贏：本金 + 1 倍', out.player, 200);
    check('閒贏時莊注全輸', out.banker, 0);
    check('閒贏時和注全輸', out.tie, 0);
}
{
    const round = { outcome: 'banker', playerPair: false, bankerPair: false };
    const out = settleBets({ banker: 100 }, round);
    check('莊贏：抽 5% 水，拿回 195', out.banker, 195);
}
{
    // 和局時莊閒注**退還本金**。少了這一條，和局的莊家優勢會從 1% 暴增到 14%
    const round = { outcome: 'tie', playerPair: false, bankerPair: false };
    const out = settleBets({ player: 100, banker: 100, tie: 100 }, round);
    check('和局退還閒注本金', out.player, 100);
    check('和局退還莊注本金', out.banker, 100);
    check('和局：本金 + 8 倍', out.tie, 900);
}
{
    const round = { outcome: 'player', playerPair: true, bankerPair: false };
    const out = settleBets({ playerPair: 100, bankerPair: 100 }, round);
    check('閒對：本金 + 11 倍', out.playerPair, 1200);
    check('沒中的對子注全輸', out.bankerPair, 0);
}
{
    const round = { outcome: 'player', playerPair: false, bankerPair: false };
    const out = settleBets({}, round);
    check('沒押的注區拿回 0', BET_SPOTS.map((s) => out[s]), [0, 0, 0, 0, 0]);
}

console.log('\n== 牌靴 ==');
{
    const server = new BaccaratServer(new Wallet(1e9));
    const first = server.handle({ type: 'deal', bets: { player: 1 } });
    check('八副牌共 416 張', first.shoe.total, 416);

    const used = first.round.player.length + first.round.banker.length;
    ok('一局用掉 4~6 張', used >= 4 && used <= 6);
    // 多抽的牌要放回去，否則牌靴消耗得比真實情況快，對子與和局的頻率會跟著偏
    check('沒用到的牌有歸位', first.shoe.remaining, 416 - used);
}
{
    const server = new BaccaratServer(new Wallet(1e9));
    let rounds = 0;
    let changed = null;
    while (rounds < 200) {
        const res = server.handle({ type: 'deal', bets: { player: 1 } });
        rounds++;
        if (res.shoeChanged) {
            changed = res;
            break;
        }
    }
    ok('兩百局內會換到新靴', changed !== null);
    check('換靴後牌靴補滿', changed.shoe.remaining, 416);
    check('換靴清掉這一靴的路圖歷史', server.getHistory().length, 0);
    ok('換靴前打了合理局數（切牌位置有效）', rounds > 50, `實際 ${rounds} 局`);
}
{
    const server = new BaccaratServer(new Wallet(1e9));
    server.handle({ type: 'deal', bets: { player: 1 } });
    server.handle({ type: 'deal', bets: { player: 1 } });
    const table = server.handle({ type: 'sit' });
    check('進桌拿得到這一靴的歷史', table.history.length, 2);
    check('歷史裡是路圖需要的欄位', Object.keys(table.history[0]).sort(), ['bankerPair', 'outcome', 'playerPair']);
}

console.log('\n== 押注驗證 ==');
{
    const server = new BaccaratServer(new Wallet(1000));
    check('沒押任何注被擋', server.handle({ type: 'deal', bets: {} }).reason, 'invalid_bet');
    check('負數押注被擋', server.handle({ type: 'deal', bets: { player: -50 } }).reason, 'invalid_bet');
    check('押注超過餘額被擋', server.handle({ type: 'deal', bets: { player: 99999 } }).reason, 'insufficient_balance');
    check('被擋時餘額不變', server.getBalance(), 1000);
}

console.log('\n== 長期回報率（50 萬局，對照公開的莊家優勢）==');
{
    const ROUNDS = 500000;
    const server = new BaccaratServer(new Wallet(1e12));
    const staked = {};
    const returned = {};
    for (const spot of BET_SPOTS) {
        staked[spot] = 0;
        returned[spot] = 0;
    }
    const outcomes = { player: 0, banker: 0, tie: 0 };

    const bets = {};
    for (const spot of BET_SPOTS) bets[spot] = 1;

    for (let i = 0; i < ROUNDS; i++) {
        const res = server.handle({ type: 'deal', bets });
        outcomes[res.round.outcome]++;
        for (const spot of BET_SPOTS) {
            staked[spot] += 1;
            returned[spot] += res.payouts[spot];
        }
    }

    const pct = (n) => (n / ROUNDS) * 100;
    console.log(
        `  莊 ${pct(outcomes.banker).toFixed(2)}% · 閒 ${pct(outcomes.player).toFixed(2)}% · 和 ${pct(outcomes.tie).toFixed(2)}%`
    );

    // 公開的理論勝率（八副牌）：莊 45.86%、閒 44.62%、和 9.52%。
    // 容許 ±0.5 個百分點——50 萬局的取樣誤差大約是 ±0.15，留三倍餘裕
    ok('莊家勝率接近 45.86%', Math.abs(pct(outcomes.banker) - 45.86) < 0.5, `實得 ${pct(outcomes.banker).toFixed(2)}%`);
    ok('閒家勝率接近 44.62%', Math.abs(pct(outcomes.player) - 44.62) < 0.5, `實得 ${pct(outcomes.player).toFixed(2)}%`);
    ok('和局率接近 9.52%', Math.abs(pct(outcomes.tie) - 9.52) < 0.5, `實得 ${pct(outcomes.tie).toFixed(2)}%`);

    // 莊家優勢 = (押出去的 − 拿回來的) / 押出去的。**比原始值，不先格式化**
    const edge = (spot) => ((staked[spot] - returned[spot]) / staked[spot]) * 100;
    for (const spot of BET_SPOTS) console.log(`  ${spot} 莊家優勢 ${edge(spot).toFixed(2)}%`);

    ok('莊注優勢接近 1.06%', Math.abs(edge('banker') - 1.06) < 0.4, `實得 ${edge('banker').toFixed(2)}%`);
    ok('閒注優勢接近 1.24%', Math.abs(edge('player') - 1.24) < 0.4, `實得 ${edge('player').toFixed(2)}%`);
    ok('和注優勢接近 14.36%', Math.abs(edge('tie') - 14.36) < 1.5, `實得 ${edge('tie').toFixed(2)}%`);
    ok('對子注優勢接近 10.36%', Math.abs(edge('playerPair') - 10.36) < 1.2, `實得 ${edge('playerPair').toFixed(2)}%`);
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail === 0 ? 0 : 1);
