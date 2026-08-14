/**
 * 轉軸的時序與落點驗證。`npm run check:reel`
 *
 * 為什麼需要它：轉軸出錯的方式大多**看不出來**。停歪一格、某根軸在等待輪到自己時
 * 站著不動、掉幀時落點跑掉——這些在畫面上要嘛看不到，要嘛看到了也講不清楚是哪裡怪。
 * 改 COAST_CELLS、SNAP_TIME、STOP_STAGGER 或 DIR 之後都該跑這支。
 *
 * 怎麼在 Node 裡跑一個 Pixi 元件：把 `pixi.js` 與 `gsap` 用 esbuild 的 alias 換成
 * `../../dev/` 底下的替身，被測的 `reel.ts` 是**真的那一份**，不是抄過來的邏輯。
 * 關鍵在 gsap 的替身是**受控時鐘**——真 gsap 活在自己的 ticker 上，測試沒辦法決定它
 * 何時推進；改成手動 `clock.advance(dt)`，每模擬幀先跑 tween 再跑 `update(dt)`，
 * 順序固定、結果可重現。
 *
 * 跟 `../../server/rtp-check.mjs` 一樣不引進測試框架：一支腳本、一個離開碼。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ARCADE = path.join(ROOT, 'src/arcade');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

/*
 * 用 stdin 當進入點串一個小 barrel：被測的 Reel 與測試用的 clock 必須來自**同一份**
 * stub 實例。分兩次打包會得到兩個互不相干的時鐘，tween 永遠不會前進。
 */
const out = buildSync({
    stdin: {
        contents: `
            export { Reel } from './games/slot/reel';
            export { SYMBOLS, REELS, ROWS } from './games/slot/rules';
            export { STOP_ORDERS, stopRanks } from './games/slot/stopOrder';
            export { clock } from './dev/stub-gsap.mjs';
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
    alias: {
        'pixi.js': path.join(ARCADE, 'dev/stub-pixi.mjs'),
        gsap: path.join(ARCADE, 'dev/stub-gsap.mjs'),
    },
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { Reel, SYMBOLS, STOP_ORDERS, stopRanks, REELS, ROWS, clock, Texture } = mod.exports;

/** 要跟 games/slot/index.ts 的 STOP_STAGGER 一致 */
const STOP_STAGGER = 0.22;
const DT = 1 / 60;

const frames = new Map(SYMBOLS.map((s) => [s, new Texture()]));
/** texture → 符號的反查表。從畫面反推，而不是重算一次帶子索引。 */
const texToSym = new Map([...frames].map(([sym, tex]) => [tex, sym]));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
    if (ok) {
        pass++;
        console.log(`  ✓ ${name}`);
    } else {
        fail++;
        console.log(`  ✗ ${name}${detail ? `  ← ${detail}` : ''}`);
    }
}

/**
 * 可視窗當下顯示的三格，由上而下。
 *
 * 刻意**從 sprite 的實際位置反推**，而不是照 layout() 的公式再算一次帶子索引——
 * 後者等於把被測程式的假設抄一份到測試裡，方向算錯時兩邊會一起錯、測試照樣綠燈。
 */
function visibleCells(reel) {
    const h = reel.getCellSize().h;
    return reel.sprites
        .filter((s) => s.y >= -1e-6 && s.y <= ROWS * h + 1e-6)
        .sort((a, b) => a.y - b.y)
        .map((s) => texToSym.get(s.texture));
}

/**
 * 找出「該轉卻沒轉」的幀：只看等速與滑行段，回彈段的收尾趨近靜止是正常的。
 *
 * 蓄力轉加速的那一個交界要排除，那不是 bug 是物理：往回拉到底才能往前衝，中間速度
 * 必然經過零。加上 gsap 在 onComplete 裡建立的新 tween 要下一個 tick 才推進，
 * 於是交界處固定會有一幀不動。它只有 16ms，且發生在起轉初期畫面還在高速捲動的時候。
 */
function stallFrames(trace, fromFrame) {
    const out = [];
    out.checked = 0; // 實際檢查了幾幀。若是 0，代表這項檢查根本沒生效
    for (let i = 0; i < trace.length; i++) {
        for (let f = fromFrame + 1; f < trace[i].length; f++) {
            const cur = trace[i][f];
            if (cur.phase !== 'spinning' && cur.phase !== 'coasting') continue;
            if (trace[i][f - 1].phase === 'winding') continue; // 蓄力→加速的交界，見上
            out.checked++;
            if (cur.offset - trace[i][f - 1].offset <= 1e-9) out.push({ reel: i, frame: f });
        }
    }
    return out;
}

/** 跑完整的一把，回傳每根軸的逐幀紀錄。 */
function runOneSpin(grid, { spinBeforeResult = 0.42, style = 'direct', ranks = null } = {}) {
    clock.reset();

    const reels = [];
    for (let i = 0; i < REELS; i++) reels.push(new Reel({ frames, cellW: 100, cellH: 106 }));

    const trace = reels.map(() => []);
    const settledAt = new Array(REELS).fill(-1);

    let frame = 0;
    const step = () => {
        clock.advance(DT); // gsap 先推進，再輪到每幀邏輯
        for (let i = 0; i < REELS; i++) {
            const before = reels[i].offset;
            reels[i].update(DT);
            trace[i].push({ offset: reels[i].offset, phase: reels[i].phase, moved: Math.abs(reels[i].offset - before) });
            if (settledAt[i] < 0 && !reels[i].isSpinning() && frame > 0) settledAt[i] = frame;
        }
        frame++;
    };

    for (const r of reels) r.spin(style);
    for (let f = 0; f < Math.round(spinBeforeResult / DT); f++) step();

    const resultFrame = frame;
    const useRanks = ranks ?? stopRanks('left', REELS);
    reels.forEach((reel, i) => reel.stopAt(grid[i], useRanks[i] * STOP_STAGGER));
    for (let f = 0; f < 600 && settledAt.some((s) => s < 0); f++) step();

    return { reels, trace, settledAt, resultFrame, ranks: useRanks };
}

/**
 * 用多重判準驗停軸順序。
 *
 * 眼睛判斷「停了」不是看狀態機，是看「不再明顯移動」——所以狀態轉 idle 的順序對了還不夠，
 * 得確認各種看法下都是同一個順序，否則就會有「邏輯是對的但看起來相反」的爭議，
 * 而那種爭議沒有數據就吵不完。
 */
function checkStopOrder({ trace, settledAt, ranks }) {
    // ranks 是「軸 → 名次」，這裡要的是「名次 → 軸」，反轉一次
    const expected = new Array(ranks.length);
    ranks.forEach((rank, reel) => {
        expected[rank] = reel;
    });

    const lastMomentMoving = (rows, threshold) => {
        let last = -1;
        for (let f = 0; f < rows.length; f++) if (rows[f].moved > threshold) last = f;
        return last;
    };
    const criteria = {
        '進減速滑行': (rows) => rows.findIndex((r) => r.phase === 'coasting'),
        '進回彈': (rows) => rows.findIndex((r) => r.phase === 'settling'),
        '狀態轉 idle': (_rows, i) => settledAt[i],
        '不再大幅移動（>0.3 格/幀）': (rows) => lastMomentMoving(rows, 0.3),
        '完全靜止（>0.02 格/幀）': (rows) => lastMomentMoving(rows, 0.02),
    };
    for (const [name, fn] of Object.entries(criteria)) {
        const times = trace.map((rows, i) => ({ i, v: fn(rows, i) }));
        const order = [...times].sort((a, b) => a.v - b.v).map((x) => x.i);
        check(
            `${name}：依 ${expected.join('→')}`,
            order.every((v, idx) => v === expected[idx]),
            `實得 ${order.join(' → ')}（幀 ${times.map((x) => x.v).join(', ')}）`
        );
    }
}

/** 相鄰兩個「名次」之間的實際間隔（秒），照停軸先後排序，不是照軸的索引。 */
function stopGaps(settledAt, ranks) {
    const byRank = settledAt.map((f, i) => ({ f, rank: ranks[i] })).sort((a, b) => a.rank - b.rank);
    return byRank.slice(1).map((x, i) => (x.f - byRank[i].f) * DT);
}

/**
 * 停軸間隔分兩層驗：**平均**要準，**單筆**只保證落在已知的抖動範圍內。
 *
 * 分兩層是因為這兩件事的性質不同。平均間隔決定整段停軸演出會不會愈跑愈快或愈拖愈長，
 * 那是必須守住的；單筆間隔則天生有抖動——滑行落點是 `Math.ceil(offset + ...)`
 * （見 reel.beginCoast），實際滑行距離因此落在 10~11 格之間，每根軸會多或少花掉幾幀。
 * 實測單筆間隔 9~15 幀（0.15~0.25 秒）。
 *
 * **這個抖動是既有行為，不是停軸順序那個 bug 的殘留**——順序修好前後 settledAt 一模一樣
 * （89, 99, 114, 128, 139）。要不要消掉是另一個決定：得讓滑行的減速曲線隨實際距離反算，
 * 而那條方程式沒有閉式解。
 *
 * 註：單筆門檻原本寫 0.05 而且是綠的，但那是浮點巧合——判定前先 `toFixed(2)` 把 0.16667
 * 進位成 0.17，誤差剛好變成 0.04999999999999999，比 0.05 小了 1e-17。現在改成直接比原始值。
 */
const GAP_AVG_TOLERANCE = 0.03;
const GAP_JITTER = 0.08;

function checkGaps(label, gaps) {
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const shown = gaps.map((g) => g.toFixed(2)).join('s, ');
    check(
        `${label}：平均間隔接近 STOP_STAGGER（節奏不漂移）`,
        Math.abs(avg - STOP_STAGGER) < GAP_AVG_TOLERANCE,
        `平均 ${avg.toFixed(3)}s，間隔 ${shown}s`
    );
    check(
        `${label}：單筆間隔都在已知抖動範圍內（±${GAP_JITTER}s）`,
        gaps.every((g) => Math.abs(g - STOP_STAGGER) <= GAP_JITTER),
        `間隔 ${shown}s`
    );
}

/** 每軸每格都不同的盤面，差一格就看得出來。 */
function makeGrid() {
    const grid = [];
    for (let i = 0; i < REELS; i++) {
        const col = [];
        for (let r = 0; r < ROWS; r++) col.push(SYMBOLS[(i * ROWS + r) % SYMBOLS.length]);
        grid.push(col);
    }
    return grid;
}

async function main() {
    console.log('\n== 停軸時序 ==');
    const grid = makeGrid();
    {
        const { reels, trace, settledAt, resultFrame, ranks } = runOneSpin(grid);

        const stalls = stallFrames(trace, resultFrame);
        check('靜止偵測有真的檢查到幀（防止假通過）', stalls.checked > 100, `檢查了 ${stalls.checked} 幀`);
        check(
            `起轉到回彈之間沒有任何一幀是靜止的（檢查 ${stalls.checked} 幀）`,
            stalls.length === 0,
            stalls.length ? `軸 ${stalls[0].reel} 在第 ${stalls[0].frame} 幀不動，共 ${stalls.length} 幀` : ''
        );

        const overshot = reels.map((_, i) => {
            const seg = trace[i].filter((s) => s.phase === 'settling').map((s) => s.offset);
            return seg.length > 0 && Math.max(...seg) > seg[seg.length - 1] + 1e-6;
        });
        check('回彈段確實有衝過頭再彈回', overshot.every(Boolean), overshot.join(', '));

        const speedDuringWait = [];
        for (let i = 1; i < REELS; i++) {
            const f = resultFrame + 3;
            speedDuringWait.push((trace[i][f].offset - trace[i][f - 1].offset) / DT);
        }
        check(
            '尚未輪到的軸仍以等速轉動（>20 格/秒）',
            speedDuringWait.every((v) => v > 20),
            `實測 ${speedDuringWait.map((v) => v.toFixed(1)).join(', ')} 格/秒`
        );

        checkGaps('相鄰兩根', stopGaps(settledAt, ranks));

        const preStop = [];
        for (let i = 0; i < REELS; i++) {
            let last = -1;
            for (let f = 1; f < trace[i].length; f++) if (trace[i][f].phase === 'coasting') last = f;
            preStop.push((trace[i][last].offset - trace[i][last - 1].offset) / DT);
        }
        check(
            '交棒給回彈前確實已減速（< 等速的一半）',
            preStop.every((v) => v < 13),
            `末段 ${preStop.map((v) => v.toFixed(1)).join(', ')} 格/秒`
        );

        console.log('\n== 停軸順序（多重判準）==');
        checkStopOrder({ trace, settledAt, ranks });

        console.log('\n== 落點正確性 ==');
        for (let i = 0; i < REELS; i++) {
            const got = visibleCells(reels[i]);
            check(`軸 ${i} 停在 server 給的三格`, got.join() === grid[i].join(), `期望 [${grid[i]}] 實得 [${got}]`);
        }
        check(
            '所有軸都停在整數格',
            reels.every((r) => Math.abs(r.offset - Math.round(r.offset)) < 1e-6),
            reels.map((r) => r.offset.toFixed(4)).join(', ')
        );
    }

    /*
     * 這一段是回歸測試，對應一個已經發生過的 bug：停軸順序在慢速起轉時會倒置。
     *
     * 根因在滑行段是距離驅動的——距離固定，起始速度越慢滑行反而拖越久（滿速約 0.63 秒，
     * 龜速要 1.05 秒，差距比 STOP_STAGGER 還大）。而模擬的 RTT 是 180~320ms，短於
     * 「蓄力 0.2 + 加速 0.28」，所以第一根軸幾乎必然在還沒加速完就收到結果，用最慢的
     * 速度進滑行，被後面滿速的軸反超。修法是讓 stagger 從等速那一刻起算（見 reel.stopAt）。
     *
     * 原本的測試抓不到它，因為 runOneSpin 預設先轉 0.42 秒才給結果——那時候早就滿速了。
     * 所以這裡刻意用**短於加速時間**的 spinBeforeResult，並且兩種起轉演法都跑。
     */
    for (const style of ['direct', 'windup']) {
        console.log(`\n== 回歸：結果在起轉加速中就回來（極快 RTT × ${style}）==`);
        const { reels, trace, settledAt, resultFrame, ranks } = runOneSpin(grid, {
            spinBeforeResult: 0.03,
            style,
        });

        const stalls = stallFrames(trace, resultFrame);
        check('加速中收到結果也不會靜止', stalls.length === 0, `${stalls.length} 幀靜止`);
        checkStopOrder({ trace, settledAt, ranks });

        checkGaps('沒有被起轉速度吃掉', stopGaps(settledAt, ranks));
        check(
            '落點依然正確',
            reels.every((r, i) => visibleCells(r).join() === grid[i].join())
        );
    }

    /*
     * 順序演法（見 stopOrder.ts）。這裡測的是**換順序不會動到別的東西**：
     * 落點、間隔、「沒有一幀靜止」都該跟預設順序一樣，換掉的只有誰先排隊。
     */
    console.log('\n== 停軸順序演法 ==');
    for (const order of STOP_ORDERS) {
        const ranks = stopRanks(order, REELS);
        check(
            `${order}：名次是 0..${REELS - 1} 的排列（沒有重複或缺號）`,
            [...ranks].sort((a, b) => a - b).every((v, i) => v === i),
            `名次 ${ranks.join(', ')}`
        );

        const run = runOneSpin(grid, { ranks });
        checkStopOrder(run);
        checkGaps(order, stopGaps(run.settledAt, ranks));
        check(
            `${order}：落點不受順序影響`,
            run.reels.every((r, i) => visibleCells(r).join() === grid[i].join())
        );
    }

    // center 的名次是寫死的預期值，不照實作重算一次——重算等於把實作抄到測試裡
    check('center 是中間先停、往兩側擴', stopRanks('center', 5).join() === [3, 1, 0, 2, 4].join(), stopRanks('center', 5).join(', '));
    check('left 是由左到右', stopRanks('left', 5).join() === [0, 1, 2, 3, 4].join(), stopRanks('left', 5).join(', '));

    console.log('\n== 邊界：連續兩把 ==');
    {
        clock.reset();
        const reel = new Reel({ frames, cellW: 100, cellH: 106 });
        const g1 = [SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]];
        const g2 = [SYMBOLS[3], SYMBOLS[4], SYMBOLS[5]];
        for (const g of [g1, g2]) {
            reel.spin('direct');
            for (let f = 0; f < 20; f++) {
                clock.advance(DT);
                reel.update(DT);
            }
            reel.stopAt(g, 0);
            for (let f = 0; f < 300 && reel.isSpinning(); f++) {
                clock.advance(DT);
                reel.update(DT);
            }
        }
        check('第二把落點正確', visibleCells(reel).join() === g2.join(), `實得 [${visibleCells(reel)}]`);
    }

    console.log('\n== 邊界：停軸中途被 destroy（切玩法）==');
    {
        clock.reset();
        const reel = new Reel({ frames, cellW: 100, cellH: 106 });
        reel.spin('direct');
        for (let f = 0; f < 20; f++) {
            clock.advance(DT);
            reel.update(DT);
        }
        let resolved = false;
        reel.stopAt([SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]], 0.5).then(() => {
            resolved = true;
        });
        for (let f = 0; f < 5; f++) {
            clock.advance(DT);
            reel.update(DT);
        }
        reel.destroy();
        await Promise.resolve();
        check('destroy 會放掉懸著的 Promise（呼叫端不會卡死）', resolved);
        check('destroy 後沒有殘留的 tween', clock.pending === 0, `還剩 ${clock.pending} 個`);
    }

    console.log('\n== 捲動方向：符號要往下掉 ==');
    {
        clock.reset();
        const reel = new Reel({ frames, cellW: 100, cellH: 106 });
        const want = [SYMBOLS[0], SYMBOLS[1], SYMBOLS[2]];
        reel.spin('direct');
        for (let f = 0; f < 20; f++) {
            clock.advance(DT);
            reel.update(DT);
        }
        reel.stopAt(want, 0);
        for (let f = 0; f < 300 && reel.isSpinning(); f++) {
            clock.advance(DT);
            reel.update(DT);
        }

        const before = visibleCells(reel);
        check('停穩時窗內就是 server 給的三格', before.join() === want.join(), `實得 [${before}]`);

        /*
         * 往前捲一整格再看：往下掉的話，原本最上面那格會移到中間、中間的移到最下面。
         * 這是「方向」唯一說得準的判準——單看某個 sprite 的 y 沒有用，它的角色會輪替。
         */
        reel.offset += 1;
        reel.layout();
        const after = visibleCells(reel);
        check(
            '捲動一格後，符號往下移了一格',
            after[1] === before[0] && after[2] === before[1],
            `捲動前 [${before}] → 捲動後 [${after}]`
        );
    }

    console.log('\n== 蓄力起轉（windup）==');
    {
        clock.reset();
        const reel = new Reel({ frames, cellW: 100, cellH: 106 });
        const start = reel.offset;
        reel.spin('windup');

        const track = [];
        for (let f = 0; f < 40; f++) {
            clock.advance(DT);
            reel.update(DT);
            track.push({ offset: reel.offset, phase: reel.phase });
        }

        const lowest = Math.min(...track.map((s) => s.offset));
        check('起轉前先往反方向拉', lowest < start - 0.2, `最多拉到 ${(lowest - start).toFixed(3)} 格`);
        check('拉的幅度不超過半格（超過會露出上一把的符號）', lowest > start - 0.5, `${(lowest - start).toFixed(3)} 格`);
        check('蓄力有自己的階段而不是混在等速段', track.filter((s) => s.phase === 'winding').length > 5);
        check(
            '蓄力結束後接上主方向加速',
            track[track.length - 1].phase === 'spinning' && track[track.length - 1].offset > lowest
        );

        clock.reset();
        const plain = new Reel({ frames, cellW: 100, cellH: 106 });
        plain.spin('direct');
        let backward = 0;
        let prev = plain.offset;
        for (let f = 0; f < 40; f++) {
            clock.advance(DT);
            plain.update(DT);
            if (plain.offset < prev - 1e-9) backward++;
            prev = plain.offset;
        }
        check('direct 起轉沒有任何反向位移', backward === 0, `${backward} 幀往回`);
    }

    console.log('\n== 蓄力起轉不影響落點 ==');
    {
        const { reels, trace, resultFrame } = runOneSpin(grid, { style: 'windup' });
        const stalls = stallFrames(trace, resultFrame);
        check('蓄力起轉時停軸一樣不會靜止', stalls.length === 0, `${stalls.length} 幀靜止`);
        for (let i = 0; i < REELS; i++) {
            const got = visibleCells(reels[i]);
            check(`軸 ${i} 落點正確`, got.join() === grid[i].join(), `期望 [${grid[i]}] 實得 [${got}]`);
        }
    }

    console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
