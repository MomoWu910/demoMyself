/**
 * 把 Cocos 輪盤的 build 產物搬進 `static/cocos-roulette/`。`yarn sync:cocos`
 *
 * Cocos 有自己的引擎與建置流程，不可能併進這裡的 webpack，所以走
 * 「各自 build、成品進版控」這條路（理由見 `static/README.md`）。
 *
 * 流程：
 *   1. 在 Cocos 編輯器建置 web-mobile（產物在 ~/cocos-lab/build/web-mobile）
 *   2. yarn sync:cocos
 *   3. yarn deploy
 *
 * 來源路徑可以用環境變數覆寫：COCOS_BUILD=/path/to/web-mobile yarn sync:cocos
 */
import { cp, rm, stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.COCOS_BUILD ?? path.join(os.homedir(), 'cocos-lab/build/web-mobile');
const DEST = path.join(ROOT, 'static/cocos-roulette');

if (!existsSync(SRC)) {
    console.error(`✗ 找不到 Cocos 的 build 產物：${SRC}`);
    console.error('');
    console.error('  先在 Cocos Creator 裡建置一次：');
    console.error('  選單「專案」→「建置發佈」→ 平台選 web-mobile → 建置');
    console.error('');
    console.error('  建置到別的地方的話：COCOS_BUILD=<那個路徑> yarn sync:cocos');
    process.exit(1);
}

if (!existsSync(path.join(SRC, 'index.html'))) {
    console.error(`✗ ${SRC} 裡沒有 index.html，這不像是 web-mobile 的產物`);
    process.exit(1);
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
console.log(`  → static/cocos-roulette/`);
console.log('');
console.log('  發佈後的網址：https://momowu910.github.io/demoMyself/cocos-roulette/');
console.log('  接著跑：yarn deploy');
