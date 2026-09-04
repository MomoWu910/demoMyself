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
const bump = (key, stake, payout) => {
    const g = acc.get(key) ?? { count: 0, stake: 0, payout: 0 };
    g.count++;
    g.stake += stake;
    g.payout += payout;
    acc.set(key, g);
};

console.log(`跑 ${BATCHES} 批 × ${DAYS_PER_BATCH} 天 × ${ROUNDS.min}~${ROUNDS.max} 局／天 …`);
for (let b = 0; b < BATCHES; b++) {
    const rows = generate({ days: DAYS_PER_BATCH, roundsPerDay: ROUNDS, seed: 1000 + b * 7919 });
    for (const r of rows) {
        bump(r.game, r.stake, r.payout);
        bump('__all__', r.stake, r.payout);
    }
    process.stdout.write(`  批 ${b + 1}/${BATCHES} 完成（累計 ${acc.get('__all__').count.toLocaleString()} 筆）\n`);
}

const pct = (n) => `${(n * 100).toFixed(2)}%`;
console.log('\n=== 理論派彩率基準線 ===');
const lines = [];
for (const [key, g] of [...acc.entries()].sort()) {
    const rate = g.payout / g.stake;
    const label = key === '__all__' ? '整體' : key;
    console.log(`  ${label.padEnd(14)} ${pct(rate).padStart(8)}   （${g.count.toLocaleString()} 筆注單）`);
    if (key !== '__all__') lines.push(`    ${key}: ${rate.toFixed(4)},`);
}
console.log('\n貼進 src/admin/baseline.ts：');
console.log('export const BASELINE_PAYOUT_RATE: Record<string, number> = {');
console.log(lines.join('\n'));
console.log('};');
console.log(`export const BASELINE_OVERALL = ${(acc.get('__all__').payout / acc.get('__all__').stake).toFixed(4)};`);
console.log(`export const BASELINE_SAMPLE = ${acc.get('__all__').count};`);
