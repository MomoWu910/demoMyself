/**
 * 桌面籌碼在**版面改變**之後還在不在該在的地方。`npm run check:chips`
 *
 * 為什麼需要它：籌碼落定之後會在桌上待到這一局結算，而這段期間版面還會變——手機
 * 位址列一收一放、轉向、操作面板重新量高度，注區就整組移位了。籌碼如果只記絕對座標，
 * 它們會**整批留在原地**，飄在注區外面。玩家讀「哪一區熱」靠的就是這些籌碼，
 * 位置錯了等於在講假話，而這件事在桌機上幾乎不會發生，只有手機才看得到。
 *
 * 打包方式同 card-check：`pixi.js` 換成替身，被測的 FlyingChips 是真的那一份，
 * **gsap 用真的**——飛行中的籌碼碰到重排要怎麼處理，正是這支要驗的東西。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ARCADE = path.join(ROOT, 'src/arcade');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

const out = buildSync({
    stdin: {
        contents: `
            export { FlyingChips } from './common/chips/FlyingChips';
            export { CHIP_SIZE, CHIP_VALUES } from './common/chips/atlas';
            export { Texture } from './dev/stub-pixi.mjs';
        `,
        resolveDir: ARCADE,
        loader: 'js',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    alias: { 'pixi.js': path.join(ARCADE, 'dev/stub-pixi.mjs') },
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { FlyingChips, CHIP_SIZE, CHIP_VALUES, Texture } = mod.exports;

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
    if (cond) {
        pass++;
        console.log('  ✓ ' + label);
    } else {
        fail++;
        console.log('  ✗ ' + label);
    }
};
const nearly = (a, b, eps = 0.001) => Math.abs(a - b) < eps;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const atlas = { frames: new Map(CHIP_VALUES.map((v) => [v, new Texture()])), source: new Texture() };

/** 兩個版面：手機位址列收起來之前與之後，注區整組往上移並變窄 */
const BEFORE = { player: { x: 40, y: 500, w: 300, h: 70 }, banker: { x: 360, y: 500, w: 300, h: 70 } };
const AFTER = { player: { x: 20, y: 380, w: 240, h: 54 }, banker: { x: 280, y: 380, w: 240, h: 54 } };
const rectOf = (table) => (spot) => table[spot] ?? null;

/** 相對位置。注區在哪、多大都不影響它 */
const drop = (table, spot, u, v) => ({ x: table[spot].x + u * table[spot].w, y: table[spot].y + v * table[spot].h, u, v });

const live = (chips) => chips.live ?? [];
const spriteOf = (chips, i) => live(chips)[i].sprite;

async function main() {
    console.log('== 落定的籌碼跟著注區走 ==');
    {
        const chips = new FlyingChips(atlas);
        chips.setChipSize(20);
        chips.place(100, 'player', 3, drop(BEFORE, 'player', 0.25, 0.6));
        chips.place(100, 'banker', 4, drop(BEFORE, 'banker', 0.8, 0.2));

        ok(nearly(spriteOf(chips, 0).x, 40 + 0.25 * 300), '落定當下就在注區裡');

        chips.relayout(rectOf(AFTER));
        ok(nearly(spriteOf(chips, 0).x, 20 + 0.25 * 240) && nearly(spriteOf(chips, 0).y, 380 + 0.6 * 54),
            '重排後落在新注區的同一個相對位置（閒）');
        ok(nearly(spriteOf(chips, 1).x, 280 + 0.8 * 240) && nearly(spriteOf(chips, 1).y, 380 + 0.2 * 54),
            '重排後落在新注區的同一個相對位置（莊）');

        const inside = live(chips).every((c, i) => {
            const spot = i === 0 ? AFTER.player : AFTER.banker;
            return c.sprite.x >= spot.x && c.sprite.x <= spot.x + spot.w && c.sprite.y >= spot.y && c.sprite.y <= spot.y + spot.h;
        });
        ok(inside, '兩顆都還在注區框內（這正是「跑版」肉眼看到的那件事）');
    }

    console.log('\n== 飛行中的籌碼碰到重排 ==');
    {
        const chips = new FlyingChips(atlas);
        chips.setChipSize(20);
        chips.fly(500, 'player', 2, { x: 700, y: 900 }, drop(BEFORE, 'player', 0.5, 0.5));
        await sleep(120); // 飛到一半

        chips.relayout(rectOf(AFTER));
        const s = spriteOf(chips, 0);
        ok(nearly(s.x, 20 + 0.5 * 240) && nearly(s.y, 380 + 0.5 * 54), '飛到一半遇到重排：直接就位到新注區');
        ok(s.alpha === 1, '就位的籌碼是看得見的（不能停在飛行途中的半透明）');

        // 舊的 tween 若沒收乾淨，它會在接下來這段時間把籌碼拖回舊座標
        await sleep(400);
        ok(nearly(spriteOf(chips, 0).x, 20 + 0.5 * 240), '舊的飛行動畫沒有把它拖回舊位置');
    }

    console.log('\n== 查不到框的那一區 ==');
    {
        const chips = new FlyingChips(atlas);
        chips.setChipSize(20);
        chips.place(25, 'tie', 1, drop(BEFORE, 'player', 0.5, 0.5));
        const before = { x: spriteOf(chips, 0).x, y: spriteOf(chips, 0).y };
        chips.relayout(rectOf(AFTER)); // AFTER 裡沒有 tie
        ok(nearly(spriteOf(chips, 0).x, before.x) && nearly(spriteOf(chips, 0).y, before.y),
            '查不到框就跳過那一顆，不會被丟到 (0,0)');
    }

    console.log('\n== 上限與清場 ==');
    {
        const chips = new FlyingChips(atlas);
        chips.setChipSize(20);
        for (let i = 0; i < 400; i++) chips.place(25, 'player', 0, drop(BEFORE, 'player', Math.random(), Math.random()));
        ok(live(chips).length <= 160, '桌面籌碼不超過上限（實際 ' + live(chips).length + '）');

        chips.relayout(rectOf(AFTER));
        const allInside = live(chips).every(
            (c) => c.sprite.x >= AFTER.player.x && c.sprite.x <= AFTER.player.x + AFTER.player.w
        );
        ok(allInside, '滿桌的籌碼一起重排也全部落在框內');

        chips.clearAll();
        ok(live(chips).length === 0, 'clearAll 之後桌面是空的');
    }

    console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
    process.exit(fail === 0 ? 0 : 1);
}

main();
