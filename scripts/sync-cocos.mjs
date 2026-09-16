/**
 * 把 Cocos 作品的 build 產物搬進 `static/`。`yarn sync:cocos <target>`
 *
 * Cocos 有自己的引擎與建置流程，不可能併進這裡的 webpack，所以走
 * 「各自 build、成品進版控」這條路（理由見 `static/README.md`）。
 *
 * 流程：
 *   1. cd ~/cocos-lab && yarn build:<target>   （編輯器要關著，走 CLI）
 *   2. yarn sync:cocos <target>
 *   3. yarn deploy
 *
 * ## 為什麼改成吃參數
 *
 * 舊版是「掃描所有 `web-mobile*`，挑 index.html 最新的那個」——那是為了應付
 * Cocos 建置面板會把產物丟到 `web-mobile-001`、`-002` 這種亂編號。
 *
 * 但 cocos-lab 現在走 CLI 建置，`outputName` 由 `build-configs/*.json` 寫死，
 * 而且**同時存在多個作品的產物**（輪盤、slot）。這時候「挑最新」不再是保險，
 * 反而會把剛建好的 slot 同步到輪盤的網址去——那種錯誤還會安靜地成功。
 *
 * 來源可以用環境變數覆寫：COCOS_BUILD=/path/to/output yarn sync:cocos slot
 */
import { cp, rm, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每個作品的來源、去處與它自己的原始碼目錄。
 *
 * `assets` 那欄是給「產物比原始檔舊」那道檢查用的：**只看自己的目錄**。
 * 看整個 `assets/` 的話，改了輪盤就會擋下 slot 的同步，反過來也一樣。
 */
const TARGETS = {
    roulette: {
        build: 'web-mobile-roulette',
        dest: 'static/cocos-roulette',
        assets: 'assets/03-roulette',
        url: 'https://momowu910.github.io/demoMyself/cocos-roulette/',
    },
    slot: {
        build: 'web-mobile-slot',
        dest: 'static/cocos-slot',
        assets: 'assets/04-slot',
        url: 'https://momowu910.github.io/demoMyself/cocos-slot/',
    },
    /**
     * 賭場大廳：一個產物含四個場景與四個 Asset Bundle。
     *
     * `assets` 這欄是**陣列**——它涵蓋大廳、三款玩法、共用腳本與共用資源，
     * 改動其中任何一個都該讓「產物比原始檔舊」那道檢查生效。
     * （上面兩個單一作品維持字串，兩種都吃。）
     */
    casino: {
        build: 'web-mobile-casino',
        dest: 'static/cocos-casino',
        assets: [
            'assets/06-lobby',
            'assets/05-baccarat',
            'assets/04-slot',
            'assets/03-roulette',
            'assets/shared',
            'assets/casino-common',
        ],
        url: 'https://momowu910.github.io/demoMyself/cocos-casino/',
    },
};

const targetName = process.argv[2];
const target = TARGETS[targetName];
if (!target) {
    console.error(`✗ 要指定同步哪一個作品：${Object.keys(TARGETS).join(' / ')}`);
    console.error('');
    console.error('  yarn sync:cocos slot');
    console.error('  yarn sync:cocos roulette');
    process.exit(1);
}
const DEST = path.join(ROOT, target.dest);

/** 這個作品的產物目錄。不再猜「最新的那個」，理由見檔案開頭 */
async function findBuild() {
    if (process.env.COCOS_BUILD) return process.env.COCOS_BUILD;
    return path.join(os.homedir(), 'cocos-lab/build', target.build);
}

const SRC = await findBuild();

if (!existsSync(SRC)) {
    console.error(`✗ 找不到 Cocos 的 build 產物：${SRC}`);
    console.error('');
    console.error('  先在 cocos-lab 建置一次（編輯器要關著）：');
    console.error(`    cd ~/cocos-lab && yarn build:${targetName}`);
    console.error('');
    console.error(`  建置到別的地方的話：COCOS_BUILD=<那個路徑> yarn sync:cocos ${targetName}`);
    process.exit(1);
}

if (!existsSync(path.join(SRC, 'index.html'))) {
    console.error(`✗ ${SRC} 裡沒有 index.html，這不像是 web-mobile 的產物`);
    process.exit(1);
}

/**
 * **產物比場景檔舊的話直接擋下來。**
 *
 * 踩過一次：場景修好了、`yarn sync:cocos` 也跑了、畫面還是全黑——
 * 因為中間少了「回 Cocos 重新建置」那一步，這支腳本只是安靜地把一份過期的產物
 * 複製過去。沒有任何一個環節會報錯，所以那是最難查的一種。
 */
// SRC 是 <專案>/build/web-mobile*，往上兩層就是專案根
const COCOS_PROJECT = path.dirname(path.dirname(SRC));
/** 要看的原始碼目錄。單一作品是一個，賭場大廳是一整組 */
const sceneDirs = (Array.isArray(target.assets) ? target.assets : [target.assets]).map((d) =>
    path.join(COCOS_PROJECT, d)
);
const buildStamp = (await stat(path.join(SRC, 'index.html'))).mtimeMs;

async function newestScene(dir) {
    let newest = { time: 0, file: '' };
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await newestScene(full);
            if (sub.time > newest.time) newest = sub;
        } else if (entry.name.endsWith('.scene') || entry.name.endsWith('.ts')) {
            const t = (await stat(full)).mtimeMs;
            if (t > newest.time) newest = { time: t, file: path.relative(COCOS_PROJECT, full) };
        }
    }
    return newest;
}

const existingDirs = sceneDirs.filter((d) => existsSync(d));
if (existingDirs.length > 0) {
    // 所有相關目錄裡最新的那一支檔案
    let newest = { time: 0, file: '' };
    for (const dir of existingDirs) {
        const found = await newestScene(dir);
        if (found.time > newest.time) newest = found;
    }
    const staleMs = newest.time - buildStamp;

    /*
     * 容差三分鐘。
     *
     * 編輯器會在建置**之後**動到 `.scene` 與 `.meta`（存檔、匯入、meta 更新都會），
     * 差個一兩分鐘是常態而不是「你改了東西沒重建」。第一版沒有容差，
     * 於是一個明明是新的產物被擋下來——**誤擋的代價比漏擋高**，因為它會讓人
     * 開始懷疑真正沒問題的環節。
     *
     * 真的要繞過（例如刻意同步一份舊產物）：`SKIP_STALE_CHECK=1 yarn sync:cocos`
     */
    const TOLERANCE_MS = 3 * 60 * 1000;

    if (staleMs > TOLERANCE_MS && !process.env.SKIP_STALE_CHECK) {
        const mins = Math.round(staleMs / 60000);
        console.error('✗ 建置產物比原始檔舊，同步過去也是白搭\n');
        console.error(`  最後建置   ${new Date(buildStamp).toTimeString().slice(0, 8)}  ${path.basename(SRC)}`);
        console.error(`  最後修改   ${new Date(newest.time).toTimeString().slice(0, 8)}  ${newest.file}`);
        console.error(`  差了 ${mins} 分鐘\n`);
        console.error(`  → cd ~/cocos-lab && yarn build:${targetName}`);
        console.error('    建置完再跑一次這支腳本');
        console.error(`    確定要同步這份舊的：SKIP_STALE_CHECK=1 yarn sync:cocos ${targetName}`);
        process.exit(1);
    }

    if (staleMs > 0) {
        const secs = Math.round(staleMs / 1000);
        console.log(`⚠ ${newest.file} 在建置後 ${secs} 秒又被動過（編輯器存檔或 meta 更新通常如此）`);
        console.log('  在容差範圍內，繼續同步。畫面不對的話先重新建置一次\n');
    }
}

/** 算一個目錄有幾個檔、多大 */
async function measure(dir) {
    let files = 0;
    let bytes = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await measure(full);
            files += sub.files;
            bytes += sub.bytes;
        } else {
            files++;
            bytes += (await stat(full)).size;
        }
    }
    return { files, bytes };
}

// 先清空再複製：Cocos 每次 build 的檔名帶 hash，不清的話舊的會一直累積在版控裡
await rm(DEST, { recursive: true, force: true });
await cp(SRC, DEST, { recursive: true });

const { files, bytes } = await measure(DEST);
console.log(`✓ 已同步 ${files} 個檔案、${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  ${SRC}`);
console.log(`  → ${target.dest}/`);
console.log('');
console.log(`  發佈後的網址：${target.url}`);
console.log('  接著跑：yarn deploy');
