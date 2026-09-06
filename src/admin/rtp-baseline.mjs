/**
 * 算出後台儀表板要對照的**理論派彩率基準線**。`yarn baseline:rtp`
 *
 * 為什麼需要它：儀表板上會顯示「實際派彩率」，但那個數字單獨看沒有意義——
 * 96% 是正常還是機台配爆了，取決於它該是多少。而「該是多少」不能用查的，
 * 因為它同時取決於三件事：各款遊戲的賠率表、玩家的下注結構、以及玩法之間的比例。
 * 押和局跟押莊的期望值差很遠，輪盤押直注跟押紅黑也差很遠。
 *
 * 所以基準線用**跟畫面上同一套產生邏輯**跑出來，只是把規模放大幾百倍
 * （見 admin/seed.ts 的 `generate()`）。兩邊同源，對不起來的時候才知道是誰錯了。
 *
 * 跑完把數字填回 admin/baseline.ts，並記下當時的局數。
 * 改了任何一款遊戲的賠率表或種子的下注分布，都要重跑這支。
 *
 * ---
 *
 * **它同時算出第二個東西：每款玩法的單注報酬標準差。**
 *
 * 為什麼需要：儀表板要判斷「實際派彩率偏離基準線多少才值得警告」，
 * 而那個門檻取決於這款玩法自己抖得多厲害。
 * 老虎機三成的局中獎、但有大獎，單注報酬的標準差是輪盤外注的好幾倍——
 * **用同一個門檻去看兩款玩法，不是對老虎機誤報，就是對輪盤漏報。**
 *
 * 這件事是被資料逼出來的：老虎機在展示樣本（約五千筆）下，
 * 派彩率會在 72% 到 100% 之間跳，而理論值是 93%。
 * 一開始想調種子參數把它「弄好看」，那是錯的方向——
 * **數字在跳不是資料的問題，是那個樣本量本來就分不出訊號與雜訊**，
 * 報表該做的是誠實說出這件事，而不是把它藏起來。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

const out = buildSync({
    entryPoints: [path.join(ROOT, 'src/admin/seed.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { generate } = mod.exports;

// 大樣本。分批跑並換種子，避免單一種子的路徑剛好走在一條偏門的軌跡上
const BATCHES = 8;
const DAYS_PER_BATCH = 120;
const ROUNDS = { min: 900, max: 1100 };

const acc = new Map();
/**
 * 累積一筆注單。
 *
 * 除了筆數與金額，還累積兩個統計量：
 * - `sumR` / `sumR2`：單注報酬 r = 派彩 ÷ 下注 的一階與二階和，用來算標準差
 * - `stakeSq`：下注額平方和。它決定**有效樣本數** n_eff = (Σstake)² / Σstake²，
 *   也就是「這些注單相當於幾筆等額的注單」。
 *   一千筆 10 元的注加上一筆 10000 元的注，筆數是 1001，
 *   但那一筆大注主導了整體派彩率，有效樣本數只有 2 出頭。
 *   **這正是老虎機的數字為什麼那麼會跳**——大戶的單注是苦工的兩百倍。
 */
const bump = (key, stake, payout) => {
    const g = acc.get(key) ?? { count: 0, stake: 0, payout: 0, sumR: 0, sumR2: 0, stakeSq: 0 };
    g.count++;
    g.stake += stake;
    g.payout += payout;
    const r = stake > 0 ? payout / stake : 0;
    g.sumR += r;
    g.sumR2 += r * r;
    g.stakeSq += stake * stake;
    acc.set(key, g);
};

console.log(`跑 ${BATCHES} 批 × ${DAYS_PER_BATCH} 天 × ${ROUNDS.min}~${ROUNDS.max} 局／天 …`);
for (let b = 0; b < BATCHES; b++) {
    const { bets } = generate({ days: DAYS_PER_BATCH, roundsPerDay: ROUNDS, seed: 1000 + b * 7919 });
    for (const r of bets) {
        bump(r.game, r.stake, r.payout);
        bump('__all__', r.stake, r.payout);
    }
    process.stdout.write(`  批 ${b + 1}/${BATCHES} 完成（累計 ${acc.get('__all__').count.toLocaleString()} 筆）\n`);
}

const pct = (n) => `${(n * 100).toFixed(2)}%`;
/** 單注報酬的標準差。母體標準差就夠了——樣本數是百萬級，除以 n 還是 n−1 沒有差別 */
const stdOf = (g) => Math.sqrt(Math.max(0, g.sumR2 / g.count - (g.sumR / g.count) ** 2));

console.log('\n=== 理論派彩率基準線 ===');
const rateLines = [];
const stdLines = [];
for (const [key, g] of [...acc.entries()].sort()) {
    const rate = g.payout / g.stake;
    const std = stdOf(g);
    // 有效樣本數比：這批注單相當於幾筆等額注單，除以實際筆數
    const effRatio = g.stake ** 2 / (g.stakeSq * g.count);
    const label = key === '__all__' ? '整體' : key;
    console.log(
        `  ${label.padEnd(14)} ${pct(rate).padStart(8)}   單注報酬標準差 ${std.toFixed(2).padStart(5)}` +
        `   有效樣本比 ${(effRatio * 100).toFixed(0).padStart(3)}%   （${g.count.toLocaleString()} 筆）`,
    );
    if (key !== '__all__') {
        rateLines.push(`    ${key}: ${rate.toFixed(4)},`);
        stdLines.push(`    ${key}: ${std.toFixed(2)},`);
    }
}

const all = acc.get('__all__');
console.log('\n貼進 src/admin/baseline.ts：');
console.log('export const BASELINE_PAYOUT_RATE: Record<string, number> = {');
console.log(rateLines.join('\n'));
console.log('};');
console.log('export const BASELINE_BET_STD: Record<string, number> = {');
console.log(stdLines.join('\n'));
console.log('};');
console.log(`export const BASELINE_OVERALL = ${(all.payout / all.stake).toFixed(4)};`);
console.log(`export const BASELINE_OVERALL_STD = ${stdOf(all).toFixed(2)};`);
console.log(`export const BASELINE_SAMPLE = ${all.count};`);
