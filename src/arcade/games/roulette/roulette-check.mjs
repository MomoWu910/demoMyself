/**
 * 輪盤的規則與賠付驗證。`npm run check:roulette`
 *
 * 這一款有一個別款沒有的好處：**它的正確性可以被窮舉證明，不必靠模擬**。
 *
 * 輪盤所有注別的期望值都是同一個數（歐式 -2.7%），而且那不是巧合——賠率就是照
 * 「蓋住幾個號碼」定出來的，所以對任何一種注都有 `命中數 ×（賠率+1）= 36` 這個恆等式。
 * 37 個號碼 × 154 種注 = 5698 種組合，全部跑一遍只要幾毫秒。**任何一個注別的
 * 賠率抄錯、蓋住的號碼算錯，這條等式就會破**，而且會指名道姓說是哪一種注。
 *
 * 這比蒙地卡羅強得多：模擬只能告訴你「整體有點偏」，窮舉直接指出是 `corner:17` 那一格。
 * 蒙地卡羅仍然留著一段，但它驗的是別的東西——桌台真的在用的那條隨機來源。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
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

const R = load('src/arcade/games/roulette/rules.ts');
const { WHEEL_ORDER, POCKET_COUNT, colorOf, numberAt, cellOf, parseBetKey, numbersOf, covers, settleBets, allBetKeys, PAYOUT } = R;

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

console.log('\n== 輪盤袋位 ==');
{
    check('歐式 37 格', POCKET_COUNT, 37);
    const seen = new Set(WHEEL_ORDER);
    ok('0~36 各出現一次', seen.size === 37 && [...seen].every((n) => n >= 0 && n <= 36));
    check('0 在起點', WHEEL_ORDER[0], 0);

    // 紅黑必須交替。這是輪盤製造的硬性規則，也是抄錯順序時最快露餡的地方
    let alternating = true;
    for (let i = 1; i < 37; i++) {
        const a = colorOf(WHEEL_ORDER[i - 1]);
        const b = colorOf(WHEEL_ORDER[i]);
        if (a === 'green' || b === 'green') continue;
        if (a === b) alternating = false;
    }
    ok('紅黑沿著輪盤交替', alternating);

    // 相鄰袋位的號碼幾乎都是一大一小（輪盤刻意把桌布上相鄰的號碼拆開）
    let bigSmall = 0;
    for (let i = 0; i < 37; i++) {
        const a = WHEEL_ORDER[i];
        const b = WHEEL_ORDER[(i + 1) % 37];
        if (a === 0 || b === 0) continue;
        if ((a <= 18) !== (b <= 18)) bigSmall++;
    }
    ok('大小號碼沿輪盤交錯（≥30 對）', bigSmall >= 30, `實得 ${bigSmall} 對`);

    const reds = [];
    for (let n = 0; n <= 36; n++) if (colorOf(n) === 'red') reds.push(n);
    check('紅色 18 個', reds.length, 18);
    check('0 是綠的', colorOf(0), 'green');
}

console.log('\n== 桌布格位 ==');
{
    check('左上角是 3', numberAt(0, 0), 3);
    check('左下角是 1', numberAt(2, 0), 1);
    check('右上角是 36', numberAt(0, 11), 36);
    check('右下角是 34', numberAt(2, 11), 34);

    let roundTrip = true;
    for (let n = 1; n <= 36; n++) {
        const cell = cellOf(n);
        if (!cell || numberAt(cell.r, cell.c) !== n) roundTrip = false;
    }
    ok('cellOf 與 numberAt 互為反函式', roundTrip);
    check('0 沒有格位', cellOf(0), null);
}

console.log('\n== 注別解析 ==');
{
    check('直注', parseBetKey('straight:17'), { kind: 'straight', n: 17 });
    check('分注（上下）', parseBetKey('split:1-2'), { kind: 'split', a: 1, b: 2 });
    check('分注（左右）', parseBetKey('split:1-4'), { kind: 'split', a: 1, b: 4 });
    check('分注（0 靠著 1）', parseBetKey('split:0-1'), { kind: 'split', a: 0, b: 1 });
    check('紅', parseBetKey('red'), { kind: 'red' });

    // 桌布上不存在的線：3 在第一列最右、4 是下一欄最上，兩格只是編號連續而已
    check('3 與 4 不相鄰，不是分注', parseBetKey('split:3-4'), null);
    check('0 與 4 不相鄰', parseBetKey('split:0-4'), null);
    check('最右欄沒有角注', parseBetKey('corner:34'), null);
    check('角注解出最小號碼', parseBetKey('corner:17'), { kind: 'corner', base: 17 });
    check('最下列沒有角注', parseBetKey('corner:3'), null);
    check('號碼超出範圍', parseBetKey('straight:37'), null);
    check('打字（第四個十二數）', parseBetKey('dozen:3'), null);
    check('亂寫的鍵', parseBetKey('banker'), null);
    check('少了參數', parseBetKey('street'), null);
    check('負數', parseBetKey('straight:-1'), null);

    check('注別總數', allBetKeys().length, 154);
    ok('每一個產生出來的鍵都解得回去', allBetKeys().every((k) => parseBetKey(k) !== null));
}

console.log('\n== 蓋住哪些號碼 ==');
{
    check('街注第一列是 1,2,3', numbersOf({ kind: 'street', row: 0 }), [1, 2, 3]);
    check('角注 1 圍住 1,2,4,5', numbersOf({ kind: 'corner', base: 1 }), [1, 2, 4, 5]);
    check('線注第一段是 1~6', numbersOf({ kind: 'line', row: 0 }), [1, 2, 3, 4, 5, 6]);
    check('第一打是 1~12', numbersOf({ kind: 'dozen', index: 0 }).length, 12);
    check('第一列（縱）從 1 開始', numbersOf({ kind: 'column', index: 0 }).slice(0, 3), [1, 4, 7]);
    check('大注是 19~36', numbersOf({ kind: 'high', }).length, 18);

    ok('0 讓所有外注落空', ['red', 'black', 'odd', 'even', 'low', 'high'].every((k) => !covers(parseBetKey(k), 0)));
    ok('0 的直注會中', covers(parseBetKey('straight:0'), 0));
    ok('0 的分注會中', covers(parseBetKey('split:0-2'), 0));
    ok('0 不會讓第一打中', !covers(parseBetKey('dozen:0'), 0));
}

console.log('\n== 賠率恆等式（窮舉 154 種注 × 37 個號碼）==');
{
    // 每一種注：命中數 ×（賠率＋1）必須正好等於 36。
    // 這條等式一旦成立，期望值必然是 36/37，也就是莊家優勢 2.70%——不必模擬。
    const broken = [];
    for (const key of allBetKeys()) {
        const bet = parseBetKey(key);
        let hits = 0;
        for (let n = 0; n <= 36; n++) if (covers(bet, n)) hits++;
        if (hits * (PAYOUT[bet.kind] + 1) !== 36) broken.push(`${key}（命中 ${hits}、賠 ${PAYOUT[bet.kind]}）`);
    }
    ok('全部 154 種注滿足「命中數 ×（賠率+1）= 36」', broken.length === 0, broken.slice(0, 5).join('、'));

    // 同一件事換個方式再驗一次：直接算期望回本率
    const edges = new Set();
    for (const key of allBetKeys()) {
        const bet = parseBetKey(key);
        let back = 0;
        for (let n = 0; n <= 36; n++) back += settleBets({ [key]: 100 }, n)[key];
        edges.add(Math.round((back / (100 * 37)) * 1e6) / 1e6);
    }
    check('每一種注的回本率完全相同', edges.size, 1);
    ok('回本率 = 36/37（97.297%）', Math.abs([...edges][0] - 36 / 37) < 1e-6, `實得 ${[...edges][0]}`);
}

console.log('\n== 結算 ==');
{
    check('直注中了賠 36 倍（含本金）', settleBets({ 'straight:17': 100 }, 17), { 'straight:17': 3600 });
    check('直注沒中歸零', settleBets({ 'straight:17': 100 }, 18), { 'straight:17': 0 });
    check('紅注中了拿回兩倍', settleBets({ red: 100 }, 3), { red: 200 });
    check('紅注押到黑號', settleBets({ red: 100 }, 2), { red: 0 });
    check('角注中了拿回 9 倍', settleBets({ 'corner:1': 100 }, 5), { 'corner:1': 900 });
    check('一次結算多注', settleBets({ red: 100, 'straight:0': 50, low: 100 }, 0), {
        red: 0,
        'straight:0': 1800,
        low: 0,
    });
    check('不合法的鍵被忽略', settleBets({ 'split:3-4': 100 }, 3), {});
    check('零元注被忽略', settleBets({ red: 0 }, 3), {});
}

console.log('\n== 軌跡反解（窮舉 37 個號碼 × 12 組起始角）==');
{
    const S = load('src/arcade/games/roulette/spin.ts');
    const { planSpin, sampleSpin, pocketAtAngle, pocketAngleOf, wrap, WHEEL_OMEGA } = S;

    // 固定亂數，讓失敗可以重現。rng 只決定球繞幾圈，不該影響落點——
    // 這一節同時也在驗證那件事
    let seed = 20260827;
    const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const missed = [];
    const backwards = [];
    const floating = [];

    for (let n = 0; n <= 36; n++) {
        for (let k = 0; k < 12; k++) {
            const wheelStart = (k / 12) * Math.PI * 2;
            const ballStart = ((k * 7) % 12 / 12) * Math.PI * 2;
            const duration = 9 + rng() * 4;
            const plan = planSpin(n, duration, wheelStart, ballStart, rng);

            // 1. 終點必須落在中獎那一格
            const end = sampleSpin(plan, duration);
            const landed = pocketAtAngle(end.ballAngle - end.wheelAngle);
            if (landed !== n) missed.push(`${n} → 落在 ${landed}`);

            // 2. 球從頭到尾只往一個方向跑（反向），中途不能倒退回去
            let last = plan.ballStart;
            let radiusMax = 0;
            for (let i = 1; i <= 240; i++) {
                const s = sampleSpin(plan, (i / 240) * duration);
                if (s.ballAngle > last + 1e-9) backwards.push(`${n}/${k}`);
                last = s.ballAngle;
                radiusMax = Math.max(radiusMax, s.radius01);
            }

            // 3. 落袋時球必須真的貼在袋位環上（radius01 = 0），不能浮著
            if (Math.abs(end.radius01) > 1e-9) floating.push(`${n}/${k} r=${end.radius01}`);
            if (radiusMax > 1.4) floating.push(`${n}/${k} 彈太高 ${radiusMax}`);
        }
    }

    ok('444 趟全部停在 server 指定的號碼', missed.length === 0, missed.slice(0, 4).join('、'));
    ok('球全程反向、不倒退', backwards.length === 0, backwards.slice(0, 4).join('、'));
    ok('球最後貼在袋位環上', floating.length === 0, floating.slice(0, 4).join('、'));

    // 落袋之後球跟著轉子走：相對角度不再變化
    const plan = planSpin(17, 10, 0.4, 2.1, rng);
    const after = [11, 14, 20].map((t) => wrap(sampleSpin(plan, t).ballAngle - sampleSpin(plan, t).wheelAngle));
    ok('落袋後球跟著轉子一起轉', after.every((a) => Math.abs(a - after[0]) < 1e-9));
    check('落袋後停在 17 的袋位', pocketAtAngle(after[0]), 17);

    // 取樣是純函式：同一個時間點取幾次都一樣（掉幀不會讓球飄掉）
    const a1 = sampleSpin(plan, 6.123);
    const a2 = sampleSpin(plan, 6.123);
    check('同一時刻取樣結果相同', [a1.ballAngle, a1.radius01], [a2.ballAngle, a2.radius01]);

    // 轉子是等速的，所以角度對時間必須是一條直線
    const w0 = sampleSpin(plan, 0).wheelAngle;
    const w5 = sampleSpin(plan, 5).wheelAngle;
    ok('轉子等速轉動', Math.abs(w5 - w0 - WHEEL_OMEGA * 5) < 1e-9);

    // 袋位角度與反查必須互為反函式，不然「球停在哪一格」的判定本身就是錯的
    let roundTrip = true;
    for (let n = 0; n <= 36; n++) if (pocketAtAngle(pocketAngleOf(n)) !== n) roundTrip = false;
    ok('袋位角度與反查互逆', roundTrip);
}

console.log('\n== 桌布命中判定（154 種注來回一趟）==');
{
    const F = load('src/arcade/games/roulette/felt.ts');
    const { computeFelt, hitTestFelt, feltAnchor } = F;

    // 三種尺寸各驗一遍：桌布是等比縮放的，但**格子的長寬比會隨版面變**，
    // 而容差是按格子比例算的——只驗一種尺寸的話，手機上押不到分注這種事驗不出來
    const sizes = [
        { name: '桌機', rect: { x: 40, y: 300, w: 900, h: 300 } },
        { name: '平板', rect: { x: 10, y: 120, w: 620, h: 260 } },
        { name: '手機橫放', rect: { x: 6, y: 90, w: 420, h: 150 } },
    ];

    for (const { name, rect } of sizes) {
        const g = computeFelt(rect);
        const broken = [];
        const missing = [];

        for (const key of allBetKeys()) {
            const at = feltAnchor(g, key);
            if (!at) {
                missing.push(key);
                continue;
            }
            const back = hitTestFelt(g, at.x, at.y);
            if (back !== key) broken.push(`${key} → ${back}`);
        }

        ok(`${name}：每一種注都算得出籌碼落點`, missing.length === 0, missing.slice(0, 4).join('、'));
        ok(`${name}：落點丟回命中判定拿回同一注`, broken.length === 0, broken.slice(0, 4).join('、'));
    }

    // 格子正中央必須是直注——這是最常按的一種注，被邊界容差吃掉的話整張桌就不能玩了
    {
        const g = computeFelt({ x: 0, y: 0, w: 900, h: 300 });
        const centers = [];
        for (let n = 1; n <= 36; n++) {
            const at = feltAnchor(g, `straight:${n}`);
            if (hitTestFelt(g, at.x, at.y) !== `straight:${n}`) centers.push(n);
        }
        ok('36 格的正中央都是直注', centers.length === 0, centers.slice(0, 6).join('、'));

        // 桌布外面點不到東西
        ok('桌布左邊外側點不到', hitTestFelt(g, -20, 100) === null);
        ok('桌布上方外側點不到', hitTestFelt(g, 400, -20) === null);
        ok('桌布右邊外側點不到', hitTestFelt(g, 980, 100) === null);

        // 兩排外注之間的縫隙不該吃掉點擊——真桌那裡是一條線，按到就是沒押到
        const dozen = g.dozens[0];
        ok('外注之間的縫隙不算注', hitTestFelt(g, dozen.x + 10, dozen.y + dozen.h + 2) === null);
    }
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail === 0 ? 0 : 1);
