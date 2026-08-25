/**
 * 翻牌動畫**被打斷時**的行為驗證。`npm run check:cards`
 *
 * 為什麼需要它：這支元件正常路徑很難壞（翻牌就是把 scale.x 壓到 0 再拉回來），
 * 出事的全在**中斷路徑**——resize、重新進桌、下一局開始，都會在翻到一半時介入。
 * 而中斷路徑的失敗方式特別惡劣：`await card.flip()` 的呼叫端會**永遠停在那一行**，
 * 畫面上留一張沒翻開的牌，後面的結算、路圖、餘額全都不會發生，而且沒有任何錯誤訊息。
 *
 * 這正是 2026-08-23 百家樂多人桌在手機上被抓到的 bug：位址列一收一放觸發 resize，
 * 整局演出就掛在那裡。根因是 gsap 的語意——**kill 一個 timeline 不會觸發它的
 * onComplete**（tween 有 onInterrupt，timeline 連那個都沒有）。
 *
 * 打包方式與 reel-check 相同：esbuild alias 把 `pixi.js` 換成替身，被測的 CardView
 * 是真的那一份。**gsap 用真的**——這支驗的就是 gsap 自己的中斷語意，換成替身等於在測替身。
 * 代價是要照真實時間等，所以每一項都有逾時保護：卡住就是失敗，不是無限等下去。
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
            export { CardView } from './common/cards/CardView';
            export { CARD_W } from './common/cards/atlas';
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
const { CardView, CARD_W, Texture } = mod.exports;

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

/** 假牌堆。CardView 只碰 back 與 frames，兩者是什麼不重要，能分辨就好 */
const back = new Texture();
const frames = new Map(
    ['spade', 'heart', 'club', 'diamond'].map((suit) => [suit, Array.from({ length: 14 }, () => new Texture())])
);
const atlas = { frames, back, source: new Texture() };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 等一個 promise，但**最多等這麼久**。
 *
 * 回 'TIMEOUT' 而不是丟例外：卡住是這支腳本要抓的目標行為，不是意外。
 * 沒有這層保護的話，回歸發生時這支腳本會自己掛住——一支永遠不結束的測試
 * 跟一支永遠綠燈的測試一樣沒用。
 */
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => 'TIMEOUT')]);

const FLIP = 0.32;
const newCard = (width = CARD_W) => {
    const card = new CardView(atlas, width);
    card.setFace('heart', 12);
    return card;
};

async function main() {
    console.log('== 正常路徑 ==');
    {
        const card = newCard();
        const result = await within(card.flip(), FLIP * 1000 + 400);
        ok(result !== 'TIMEOUT', 'flip 正常完成會 resolve');
        ok(card.faceUp === true, '翻完是正面');
        ok(Math.abs(card.sprite?.scale.x ?? scaleOf(card)) > 0, '寬度不是 0（沒停在壓扁的那一幀）');
    }

    console.log('\n== 中斷路徑：resize（手機位址列收放、轉向、面板重新量高度）==');
    {
        const card = newCard();
        const flipping = card.flip();
        await sleep(80); // 翻到一半
        card.resize(CARD_W / 2);
        const result = await within(flipping, 800);
        ok(result !== 'TIMEOUT', 'resize 打斷翻牌，flip 仍然 resolve（不 resolve 就是整局演出卡死）');
        ok(card.faceUp === true, '被打斷也要跳到終點：牌是翻開的');
        ok(nearly(scaleOf(card), 0.5), '寬度跟著新尺寸走，不是停在舊 base 或半路的值');
    }

    console.log('\n== 中斷路徑：stop（離桌、卸載）==');
    {
        const card = newCard();
        const flipping = card.flip();
        await sleep(80);
        card.stop();
        ok((await within(flipping, 800)) !== 'TIMEOUT', 'stop 打斷翻牌，flip 仍然 resolve');
        ok(card.faceUp === true, 'stop 之後牌是翻開的');
    }

    console.log('\n== 中斷路徑：setFaceUp（中途進桌，牌直接攤開）==');
    {
        const card = newCard();
        const flipping = card.flip();
        await sleep(80);
        card.setFaceUp(true);
        ok((await within(flipping, 800)) !== 'TIMEOUT', 'setFaceUp 打斷翻牌，flip 仍然 resolve');
        ok(card.faceUp === true, 'setFaceUp 說了算');
        ok(nearly(scaleOf(card), 1), '寬度回到 base');
    }

    console.log('\n== 中斷路徑：重複呼叫 flip ==');
    {
        const card = newCard();
        const first = card.flip();
        await sleep(80);
        const second = card.flip();
        ok((await within(first, 800)) !== 'TIMEOUT', '第二次 flip 打斷第一次，第一個 promise 仍然 resolve');
        ok((await within(second, 800)) !== 'TIMEOUT', '第二次 flip 自己也會 resolve');
        ok(card.faceUp === false, '翻兩次回到背面');
    }

    console.log('\n== 連續中斷：翻→打斷→再翻→再打斷 ==');
    {
        const card = newCard();
        let stuck = 0;
        for (let i = 0; i < 6; i++) {
            const flipping = card.flip();
            await sleep(40);
            card.resize(CARD_W * (0.5 + i * 0.1));
            if ((await within(flipping, 600)) === 'TIMEOUT') stuck++;
        }
        ok(stuck === 0, '連續六次「翻到一半就 resize」沒有任何一次卡住（實際卡住 ' + stuck + ' 次）');
        ok(card.faceUp === false, '翻六次回到背面（每一次中斷都確實翻到了終點）');
    }

    console.log('\n通過 ' + pass + ' 項，失敗 ' + fail + ' 項');
    process.exit(fail === 0 ? 0 : 1);
}

/** CardView 的 sprite 是 private，從子物件拿。scale.x 是「有沒有停在半路」的唯一證據 */
function scaleOf(card) {
    return card.children[0].scale.x;
}

const nearly = (a, b) => Math.abs(a - b) < 1e-6;

main();
