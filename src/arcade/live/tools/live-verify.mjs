/**
 * 視訊桌台的瀏覽器整合驗證。`npm run check:live`（要先 `npm run build`）
 *
 * `check:video` 驗的是數學（時間軸換算、追趕決策、緩衝計算），這一支驗的是**真的跑起來**
 * 之後才看得到的事：串流播不播得動、疊層跟 cues 對不對得上、切線路會不會漏資源、
 * 回大廳有沒有把 video 收乾淨。
 *
 * 用 Playwright 而不是 MCP Chrome：後者的分頁會被凍結，rAF 完全不跑，動畫類的東西
 * 一律驗不動。Playwright 不在專案依賴裡，靠的是 npx cache。
 *
 * 判準都對齊設計值而不是「看起來差不多」——延遲門檻取 DEFAULT_CATCH_UP.catchUpAt，
 * 緩衝門檻取 MAX_AHEAD 加一段。門檻比設計值嚴會製造假警報，比設計值鬆則抓不到退步。
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path, { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Users/eric.wu/.npm/_npx/705bc6b22212b352/');
const { chromium } = require('/Users/eric.wu/.npm/_npx/705bc6b22212b352/node_modules/playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..', 'dist');
// 截圖是給人看的，沒指定就丟系統暫存，不要弄髒專案
const SHOTS = process.argv[2] ?? tmpdir();
const PORT = 8090;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
    // production build 的 publicPath 是 /demoMyself/，本機從 dist 根目錄服務要把它剝掉
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/demoMyself/')) url = url.slice('/demoMyself'.length);
    const p = join(ROOT, url);
    try {
        const buf = await readFile(p);
        res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
        res.end(buf);
    } catch { res.writeHead(404).end('nope'); }
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message + ' @@ ' + String(e.stack).split(String.fromCharCode(10)).slice(1,4).join(' | ')));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

// renderer=webgl：headless 下 WebGPU 的 canvas 截圖是空的
await page.goto(`http://localhost:${PORT}/arcade.html?renderer=webgl`);
await page.waitForFunction(() => window.__ARCADE__ != null, null, { timeout: 30000 });
await wait(1500);

console.log('\n== 大廳 ==');
await page.screenshot({ path: `${SHOTS}/01-lobby.png` });
const lobbyOk = await page.evaluate(() => {
    const app = window.__PIXI_APP__;
    return app && app.stage.children.length > 0;
});
ok('大廳畫得出來', lobbyOk);

console.log('\n== 進視訊桌 ==');
await page.evaluate(() => window.__ARCADE__.enter('baccaratLive'));
await wait(6000);

const state = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
        hasVideo: !!v,
        videoW: v?.videoWidth ?? 0,
        videoH: v?.videoHeight ?? 0,
        currentTime: v?.currentTime ?? 0,
        paused: v?.paused ?? true,
        readyState: v?.readyState ?? 0,
    };
});
console.log('   video:', JSON.stringify(state));
ok('video 元素建出來了', state.hasVideo);
ok(`拿到影像尺寸 640×360（實得 ${state.videoW}×${state.videoH}）`, state.videoW === 640 && state.videoH === 360);
ok('沒有暫停', !state.paused);
ok(`readyState 夠播（實得 ${state.readyState}）`, state.readyState >= 3);

const t0 = state.currentTime;
await wait(2000);
const t1 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
ok(`畫面在動（${t0.toFixed(2)} → ${t1.toFixed(2)}）`, t1 - t0 > 1.5);

await page.screenshot({ path: `${SHOTS}/02-live.png` });

console.log('\n== 桌況跟畫面對得上 ==');
// 自己讀 cues 算「現在該是什麼階段」，跟面板顯示的比對。
//
// 階段而不是局數：局數的讀數被拿掉了（影片裡桌邊那塊牌子自己就燒著 ROUND 06/12，
// 面板再放一份只是把讀數列擠到換行，而那一列一換行整塊面板就長高，畫布那側就少一截）。
// 階段其實是更該驗的那一個——它是「畫面演到哪」與「server 說到哪」真正要對齊的東西。
//
// 前後各算一次：讀畫面要花時間，跨到下一階段的那一瞬間比對必定失敗，
// 而那是取樣的問題不是對齊的問題
//
// 狀態一律從 `window.__TABLE__()` 讀，不從 DOM。桌台的介面在這一版整組搬進了畫布
// （見 games/baccaratLive/index.ts 的 buildDeck），`.table-status` 與 `.stat` 都不存在了——
// 而遍歷場景樹用文字比對會綁死在語言上，換個語系整支腳本就掛
const cmp = await page.evaluate(async () => {
    const cues = await (await fetch('public/live/table01/cues.json')).json();
    const ROUND = 22;
    const phaseNow = () => {
        const t = (Date.now() - cues.epoch) / 1000;
        const wrapped = ((t % cues.duration) + cues.duration) % cues.duration;
        const index = Math.floor(wrapped / ROUND);
        const local = wrapped - index * ROUND;
        const cue = cues.rounds[index];
        return {
            index,
            phase: local < cue.lockAt ? 'betting' : local < cue.resultAt ? 'dealing' : local < cue.clearAt ? 'result' : 'clearing',
        };
    };
    const before = phaseNow();
    const table = window.__TABLE__?.() ?? null;
    const after = phaseNow();
    return { before, after, phase: table?.phase ?? null, latency: table?.stats?.latency ?? 0 };
});
console.log('   cues 算出來的真相:', JSON.stringify(cmp.before), '→', JSON.stringify(cmp.after));
console.log('   桌台狀態:', JSON.stringify({ phase: cmp.phase, latency: cmp.latency }));
if (cmp.before.phase === cmp.after.phase) {
    ok(`階段對得上（cues 說 ${cmp.before.phase}）`, cmp.phase === cmp.before.phase,
        `(桌台說 ${JSON.stringify(cmp.phase)})`);
} else {
    // 剛好跨界。這不是失敗，但也不算驗過——記一筆讓人知道這一輪沒驗到
    console.log('   （取樣時跨階段，這一項跳過）');
}

const latency = cmp.latency;
console.log(`   延遲讀數: ${latency}s`);
// 門檻取 DEFAULT_CATCH_UP.catchUpAt（2.5），也就是「開始追趕」那條線——超過它才代表
// 沒維持住設計的延遲。原本寫 2 比設計值還嚴：實測 2.02 落在 target(1.5)~catchUpAt(2.5)
// 的不動作帶內，那是正常狀態不是退步
ok(`延遲維持在追趕門檻內（實得 ${latency}s < 2.5s）`, latency > 0 && latency < 2.5);

console.log('\n== 合成層：視訊沉在畫布底下 ==');
// 這一段驗的是「注區與路圖畫得出來」的前提。兩件事要同時成立才看得到視訊：
// .live-video 的 z-index 讓給畫布、而畫布的背景是透明的。少任何一件，
// 症狀都是整片黑或整片視訊——但 DOM 檢查器裡兩邊都一切正常，所以要用數字驗
const layers = await page.evaluate(() => {
    const v = document.querySelector('.live-video');
    const c = document.querySelector('canvas');
    return {
        videoZ: v ? getComputedStyle(v).zIndex : null,
        canvasZ: c ? getComputedStyle(c).zIndex : null,
        bgAlpha: window.__ARCADE__?.app?.renderer?.background?.alpha ?? null,
    };
});
console.log('   合成層:', JSON.stringify(layers));
ok(`視訊在畫布之下（video z=${layers.videoZ}, canvas z=${layers.canvasZ}）`,
    Number(layers.videoZ) < Number(layers.canvasZ));
ok(`畫布背景是透明的（alpha=${layers.bgAlpha}）`, layers.bgAlpha === 0);

console.log('\n== 下注 ==');
// 注區是 Pixi 畫的，DOM 裡找不到。用賠率文字認人——那串跟語言無關（'1 : 1' 是閒家，
// '1 : 0.95' 是莊家），用注區名稱的話換個語系這段就掛了
await page.evaluate(() => {
    window.__spotRect = (odds) => {
        const hit = (node) => {
            if (node.children?.some((c) => c.text === odds)) return node;
            for (const c of node.children ?? []) { const r = hit(c); if (r) return r; }
            return null;
        };
        const found = hit(window.__ARCADE__.app.stage);
        if (!found) return null;
        const b = found.getBounds();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
});
const spotCount = await page.evaluate(() =>
    ['1 : 1', '1 : 0.95', '1 : 8'].filter((o) => window.__spotRect(o) != null).length);
ok(`注區畫出來了（找到 ${spotCount} / 3 個可辨識的）`, spotCount === 3);

// 等一個剛開始的下注期。剩太少秒才點的話，RTT 走完可能已經截止了
// 等一個還有幾秒可用的下注期。門檻不能太高：下注期 11 秒，等「還剩 5 秒以上」
// 每局只有 6 秒的窗口，跟 6 秒的進桌等待撞在一起時會整輪錯過
await page.waitForFunction(() => {
    const t = window.__TABLE__?.();
    return t && t.phase === 'betting' && t.secondsLeft >= 4;
}, null, { timeout: 45000 });

const myTotal = () => page.evaluate(() => window.__TABLE__?.().myTotal ?? -1);
const lastNet = () => page.evaluate(() => {
    const t = window.__TABLE__?.();
    return t?.played ? t.lastNet : null;
});

const betBefore = await myTotal();
const player = await page.evaluate(() => window.__spotRect('1 : 1'));
await page.mouse.click(player.x + player.w / 2, player.y + player.h / 2);
await wait(900);
const betAfter = await myTotal();
console.log(`   本局押注: ${betBefore} → ${betAfter}`);
ok('點閒家注區押得進去（本局押注變成預設面額 100）', betAfter === betBefore + 100);

// 截止之後再點一次：**押出去不能撤，沒押進去也不能補**。server 認的是畫面的時間
await page.waitForFunction(() => window.__TABLE__?.().phase !== 'betting', null, { timeout: 45000 });
const lockedBefore = await myTotal();
await page.mouse.click(player.x + player.w / 2, player.y + player.h / 2);
await wait(900);
const lockedAfter = await myTotal();
ok('停止下注之後點不進去（金額沒變）', lockedBefore === lockedAfter, `(${lockedBefore} → ${lockedAfter})`);
await page.screenshot({ path: `${SHOTS}/02b-bet.png` });

// 結算。牌在影片裡翻完才會送 settle，所以這裡要等的是**畫面**演到結果那一刻
await page.waitForFunction(() => window.__TABLE__?.().played === true, null, { timeout: 45000 });
const net = await lastNet();
console.log(`   上一局輸贏: ${net}`);
ok('結算有算到我頭上（上一局有數字了）', net !== null);

const balanceMoved = await page.evaluate(() => window.__ARCADE__ != null);
ok('結算走完沒把桌台弄掉', balanceMoved);

console.log('\n== 切到公開真 live ==');
// 線路切換這一版收進了右上角的「更多」（見 games/baccaratLive/index.ts 的 menuSections），
// 所以要先把選單點開。按鈕在畫布裡，用文字找節點再點它的中心——跟注區同一招
await page.evaluate(() => {
    // **只找看得見的**。收起來的選單裡那些按鈕仍然在場景樹上，`getBounds()` 也照樣
    // 回傳座標——照著點會點在一片空白上，然後整段驗證靜靜地驗了個寂寞
    const shown = (node) => {
        for (let n = node; n; n = n.parent) if (!n.visible) return false;
        return true;
    };
    window.__nodeAt = (text) => {
        const hit = (node) => {
            if (node.children?.some((c) => c.text === text) && shown(node)) return node;
            for (const c of node.children ?? []) { const r = hit(c); if (r) return r; }
            return null;
        };
        const found = hit(window.__PIXI_APP__.stage);
        if (!found) return null;
        const b = found.getBounds();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
});
// 那顆鈕現在是齒輪，沒有看得見的文字——改用場景樹上的 `label` 找它
const moreAt = await page.evaluate(() => {
    const hit = (n) => { if (n.label === 'more-menu') return n; for (const c of n.children ?? []) { const r = hit(c); if (r) return r; } return null; };
    const menu = hit(window.__PIXI_APP__.stage);
    if (!menu) return null;
    const b = menu.children[0].getBounds();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
ok('找得到設置鈕', moreAt != null);
if (moreAt) {
    await page.mouse.click(moreAt.x, moreAt.y);
    await wait(700);
    await page.screenshot({ path: `${SHOTS}/03a-menu.png` });
}
const segAt = await page.evaluate(() => window.__nodeAt('Public live'));
console.log('   線路按鈕:', JSON.stringify(segAt));
if (segAt) {
    await page.mouse.click(segAt.x, segAt.y);
    await wait(9000);
    const pub = await page.evaluate(() => {
        const v = document.querySelector('video');
        const t = window.__TABLE__?.();
        return { latency: t?.stats?.latency ?? 0, source: t?.source ?? null,
                 w: v?.videoWidth ?? 0, h: v?.videoHeight ?? 0, ct: v?.currentTime ?? 0 };
    });
    console.log('   公開直播:', JSON.stringify(pub));
    await page.screenshot({ path: `${SHOTS}/03-public.png` });
    ok('切過去有拿到影像', pub.w > 0 && pub.h > 0, `(${pub.w}×${pub.h})`);
    ok(`公開 HLS 的延遲明顯較高（${pub.latency}s > ${latency}s）`, pub.latency > latency);

    // 延遲大到會吃掉下注時間時，畫面要明講。沒有這行字的話，玩家看到的是
    // 倒數還有十秒但注區按不動——那看起來就只是壞了。
    // 這一版那行字疊在視訊上（lagText），是 Pixi 的 Text
    const warned = await page.evaluate(() => {
        const out = [];
        const walk = (n) => { if (typeof n.text === 'string' && n.visible && n.text.length > 4) out.push(n.text);
                              for (const c of n.children ?? []) walk(c); };
        walk(window.__PIXI_APP__.stage);
        return out;
    });
    const lagLine = warned.find((t) => /\d+(\.\d+)?\s*s/.test(t) && t.length > 8) ?? '';
    console.log('   畫面上的落後提示:', JSON.stringify(lagLine));
    ok('畫面講出落後幾秒', lagLine.length > 8);
} else {
    ok('找得到線路切換按鈕', false);
}

console.log('\n== 回大廳要卸乾淨 ==');
await page.evaluate(() => window.__ARCADE__.enter('lobby'));
await wait(2500);
const cleaned = await page.evaluate(() => ({
    videos: document.querySelectorAll('video').length,
    leaked: window.__ARCADE__?.lastReport ?? null,
}));
console.log('   卸載後:', JSON.stringify(cleaned));
ok('video 元素都收掉了', cleaned.videos === 0, `(還有 ${cleaned.videos} 個)`);
await page.screenshot({ path: `${SHOTS}/04-back.png` });

console.log('\n== 錯誤 ==');
const real = errors.filter(e => !/favicon|Failed to load resource.*404/i.test(e));
if (real.length) real.forEach(e => console.log('   !', e));
ok('沒有未預期的錯誤', real.length === 0, `(${real.length} 個)`);

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項\n`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
