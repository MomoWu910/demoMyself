/**
 * 循環直播的時間軸換算與追趕策略的驗證。`npm run check:video`
 *
 * 為什麼需要它：這些全部是**眼睛看不出來**的東西。畫面上追趕生效與否只差一點速度感；
 * 「落後八秒該磨還是該跳」看起來都只是畫面怪；而時間軸拼接算錯的症狀更陰險——
 * 畫面照樣在動，只是每個觀眾看到的位置不一樣，而那要兩台裝置擺在一起才看得出來。
 *
 * 最關鍵的一項是 `timestampOffsetFor`：循環素材要接成一條單調遞增的 media timeline，
 * 接錯了 `SourceBuffer` 會把回頭的時間戳當成 seek，緩衝停在一圈的長度不再前進。
 * 這一項在 Node 裡驗的是**數學**，真的餵進 SourceBuffer 的行為由瀏覽器整合驗證負責。
 *
 * 跟其他 check 腳本一樣不引進測試框架：一支腳本、一個離開碼。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

// 用 stdin barrel 一次打包，timeline 與 DEFAULT_CATCH_UP 才會來自同一份模組實例
const out = buildSync({
    stdin: {
        contents: `
            export * from './src/arcade/common/video/timeline';
            export { DEFAULT_CATCH_UP } from './src/arcade/common/video/types';
        `,
        resolveDir: ROOT,
        loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { segmentStarts, lapDuration, globalStartOf, indexAt, timestampOffsetFor, decideCatchUp, bufferedAhead, DEFAULT_CATCH_UP } = mod.exports;

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
    // 比原始值不比格式化後的值——先 toFixed 再比會讓剛好超標的案例進位成通過
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

function ok(name, condition) {
    if (condition) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}`);
    }
}

function near(name, actual, expected, tol = 1e-9) {
    if (Math.abs(actual - expected) <= tol) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}\n      預期 ${expected} ±${tol}\n      實得 ${actual}`);
    }
}

/** 刻意不等長：最後一段短，因為真實切片就是這樣，等長的測資會讓累積表的 bug 藏起來 */
const DURS = [2, 2, 2, 1.5];
const STARTS = segmentStarts(DURS);
const LAP = lapDuration(DURS);

console.log('\n== 累積表 ==');
check('每段的起始時間是累積出來的', STARTS, [0, 2, 4, 6]);
near('一圈的總長', LAP, 7.5);
ok('切片不等長（測資真的踩到這件事）', new Set(DURS).size > 1);

console.log('\n== 全域序號 → 全域起點 ==');
near('第一圈第 0 段', globalStartOf(0, STARTS, LAP), 0);
near('第一圈最後一段', globalStartOf(3, STARTS, LAP), 6);
near('第二圈第 0 段接在一圈之後', globalStartOf(4, STARTS, LAP), 7.5);
near('第三圈第 2 段', globalStartOf(10, STARTS, LAP), 15 + 4);

console.log('\n== 全域時間 → 落在第幾段 ==');
check('第 0 秒在第 0 段', indexAt(0, STARTS, LAP), 0);
check('段中間', indexAt(1.9, STARTS, LAP), 0);
// 邊界要往兩頭測：剛好踩在邊界上算下一段，差一點點還算上一段
check('剛好踩在邊界算下一段', indexAt(2, STARTS, LAP), 1);
check('差一點點還在上一段', indexAt(2 - 1e-9, STARTS, LAP), 0);
check('最後一段', indexAt(7.4, STARTS, LAP), 3);
check('剛好滿一圈回到第 0 段（第二圈）', indexAt(7.5, STARTS, LAP), 4);
check('第二圈的中段', indexAt(7.5 + 4.5, STARTS, LAP), 4 + 2);
check('第十圈仍然算得對', indexAt(75 + 6.2, STARTS, LAP), 40 + 3);

console.log('\n== timestampOffset：循環素材接成單調遞增的時間軸 ==');
{
    // 這是整支腳本的核心。對每一段都必須成立：
    //   該段在 media timeline 上的起點 === timestampOffset + 切片自帶的時間戳
    // 左邊是「我們希望它落在哪」，右邊是「SourceBuffer 實際會把它放在哪」。
    // 兩邊不等，緩衝就會出現破洞或重疊
    const baseIndex = 5; // 從第二圈第 1 段接上，刻意不從 0 開始
    const baseGlobal = globalStartOf(baseIndex, STARTS, LAP);

    let checked = 0;
    let worst = 0;
    for (let i = baseIndex; i < baseIndex + 12; i++) {
        const wantMediaStart = globalStartOf(i, STARTS, LAP) - baseGlobal;
        const actualMediaStart = timestampOffsetFor(i, STARTS, LAP, baseGlobal) + STARTS[i % STARTS.length];
        worst = Math.max(worst, Math.abs(wantMediaStart - actualMediaStart));
        checked++;
    }
    // 一併斷言「到底檢查了幾段」——迴圈條件寫錯會一段都沒跑然後印綠燈
    ok(`跨三圈逐段檢查（實際檢查 ${checked} 段）`, checked === 12);
    near('每一段都落在該落的位置', worst, 0);

    // 時間軸必須單調遞增。接錯的典型症狀就是這裡回頭
    let monotonic = true;
    let prev = -Infinity;
    for (let i = baseIndex; i < baseIndex + 12; i++) {
        const start = timestampOffsetFor(i, STARTS, LAP, baseGlobal) + STARTS[i % STARTS.length];
        if (start <= prev) monotonic = false;
        prev = start;
    }
    ok('media timeline 單調遞增，跨圈不回頭', monotonic);

    check('第一段的 offset 讓 media time 從 0 起算', timestampOffsetFor(baseIndex, STARTS, LAP, baseGlobal) + STARTS[baseIndex % 4], 0);
}

console.log('\n== 所有觀眾看到同一格畫面 ==');
{
    // 這是「牆鐘決定播放位置」的全部意義。兩個在不同時刻接上的觀眾，在同一個牆鐘時刻
    // 應該落在素材的同一個位置——否則就退化成各看各的錄影帶
    const inLapAt = (globalTime) => {
        const idx = indexAt(globalTime, STARTS, LAP);
        const base = globalStartOf(idx, STARTS, LAP);
        // 觀眾的 currentTime = 全域時間 - 自己接上那一段的全域起點
        return { base, currentTime: globalTime - base };
    };

    const now = 123.456;
    const a = inLapAt(now); // 剛接上的觀眾
    const bJoined = 100.0; // 早接上的觀眾，從那時候的段起算
    const bBase = globalStartOf(indexAt(bJoined, STARTS, LAP), STARTS, LAP);
    const bCurrent = now - bBase; // 一路播到現在

    near('兩個觀眾算出的全域位置相同', a.base + a.currentTime, bBase + bCurrent);

    const posOf = (globalTime) => globalTime - Math.floor(globalTime / LAP) * LAP;
    near('換算成素材內位置也相同', posOf(a.base + a.currentTime), posOf(bBase + bCurrent));
    ok('兩個觀眾的 media timeline 原點確實不同（測資有意義）', a.base !== bBase);
}

console.log('\n== 追趕策略 ==');
{
    const c = DEFAULT_CATCH_UP;
    const TARGET_T = 50; // 要跳的話跳到這裡，值本身不重要

    check('延遲在目標內就什麼都不做', decideCatchUp(c.target - 0.5, 1, TARGET_T, c), { kind: 'hold' });

    // 不動作帶：延遲介於 target 與 catchUpAt 之間、倍速已經是 1，就不該有任何動作。
    // 少了這一段，倍速會在 1.0 與 minRate 之間來回抖，畫面節奏忽快忽慢
    check('不動作帶內不動作', decideCatchUp((c.target + c.catchUpAt) / 2, 1, TARGET_T, c), { kind: 'hold' });

    // 邊界往兩頭測
    check('剛好在追趕門檻上還不追', decideCatchUp(c.catchUpAt, 1, TARGET_T, c), { kind: 'hold' });
    ok('超過門檻一點點就開始追', decideCatchUp(c.catchUpAt + 1e-6, 1, TARGET_T, c).kind === 'rate');
    ok('剛好在 flush 門檻上還是用磨的', decideCatchUp(c.flushAt, 1, TARGET_T, c).kind === 'rate');
    check('超過 flush 門檻就直接跳', decideCatchUp(c.flushAt + 1e-6, 1, TARGET_T, c), { kind: 'jump', to: TARGET_T });

    // 倍速曲線：夾在 min~max、隨落後單調遞增
    const rates = [];
    let checkedRates = 0;
    for (let l = c.catchUpAt + 0.01; l <= c.flushAt; l += 0.1) {
        const a = decideCatchUp(l, 1, TARGET_T, c);
        if (a.kind === 'rate') {
            rates.push(a.rate);
            checkedRates++;
        }
    }
    ok(`追趕區間逐點取樣（實際取樣 ${checkedRates} 點）`, checkedRates > 20);
    ok('倍速永遠夾在 min~max 之間', rates.every((r) => r >= c.minRate - 1e-12 && r <= c.maxRate + 1e-12));
    ok('落後越多倍速越高（單調遞增）', rates.every((r, i) => i === 0 || r >= rates[i - 1]));
    near('剛開始追是最低速', rates[0], c.minRate, 0.02);
    near('追到 flush 門檻前是最高速', rates[rates.length - 1], c.maxRate, 0.02);

    // 追平之後要收回 1.0，否則畫面會一直快轉
    check('追平後收回正常速', decideCatchUp(c.target - 0.1, 1.3, TARGET_T, c), { kind: 'rate', rate: 1 });
    check('已經是正常速就不必再設一次', decideCatchUp(c.target - 0.1, 1, TARGET_T, c), { kind: 'hold' });

    // 播放器還沒就緒時 currentTime 是 NaN，延遲會算成 NaN。
    // 沒擋住的話 playbackRate 會被設成 NaN，瀏覽器直接丟例外
    check('延遲算不出來時不動作', decideCatchUp(NaN, 1, TARGET_T, c), { kind: 'hold' });
    check('延遲是無限大時也不動作', decideCatchUp(Infinity, 1, TARGET_T, c), { kind: 'hold' });

    // 負延遲＝跑在前緣前面（牆鐘或緩衝算歪了）。不該加速，那會越跑越前面
    ok('跑在前緣前面時不加速', decideCatchUp(-2, 1, TARGET_T, c).kind === 'hold');
}

console.log('\n== 緩衝深度 ==');
{
    // 這一組全部是實測踩出來的。餵料的上限是靠這個函式擋的，它一回 0 就等於沒有上限
    near('位置在段內：算到段尾', bufferedAhead([{ start: 0, end: 4 }], 1.5), 2.5);
    near('跨過空洞只算目前這一段', bufferedAhead([{ start: 0, end: 4 }, { start: 6, end: 10 }], 1), 3);
    near('播過的段要跳過', bufferedAhead([{ start: 0, end: 2 }, { start: 2, end: 6 }], 3), 3);
    near('位置已經超過所有段', bufferedAhead([{ start: 0, end: 4 }], 5), 0);
    near('完全沒緩衝', bufferedAhead([], 0), 0);

    // **這一項是那個 bug 本身。** fMP4 第一個 sample 的時間戳不是精確 0（編碼器帶 pts
    // offset），所以剛接上時是 buffered=[0.1, 2.1] 而 currentTime=0。舊寫法用
    // 「哪一段涵蓋 currentTime」去找，0.1 <= 0.05 不成立，一段都找不到就回 0——
    // 於是啟動那幾百毫秒每一幀都覺得「緩衝是空的」，灌進 28 秒
    near('位置還沒進入第一段：整段都算沒播（pts offset 那個坑）', bufferedAhead([{ start: 0.1, end: 2.1 }], 0), 2);
    near('連續灌了幾段之後也要擋得住', bufferedAhead([{ start: 0.1, end: 8.1 }], 0), 8);
    ok('offset 存在時仍然超過門檻（真的擋得下來）', bufferedAhead([{ start: 0.1, end: 8.1 }], 0) >= 4);
}

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
process.exit(fail === 0 ? 0 : 1);
