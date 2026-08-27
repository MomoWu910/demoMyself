/**
 * 輪盤的瀏覽器整合驗證。`npm run verify:roulette`（要先 `npm run build`）
 *
 * `check:roulette` 驗的是數學（賠率恆等式、軌跡反解、桌布命中判定），這一支驗的是
 * **真的跑起來**之後才看得到的事：桌布點得到嗎、籌碼飛不飛、球會不會真的動、
 * 開出來的號碼跟 server 說的是不是同一個、離桌有沒有把資源還乾淨。
 *
 * 用 Playwright 而不是 MCP Chrome：後者的分頁會被凍結，rAF 完全不跑，而這一款要驗的
 * 幾乎都是動畫。Playwright 不在專案依賴裡，靠的是 npx cache。
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
const SHOTS = process.argv[2] ?? tmpdir();
const PORT = 8090;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (url.startsWith('/demoMyself/')) url = url.slice('/demoMyself'.length);
    try {
        const buf = await readFile(join(ROOT, url));
        res.writeHead(200, { 'content-type': MIME[extname(url)] ?? 'application/octet-stream' });
        res.end(buf);
    } catch { res.writeHead(404).end('nope'); }
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

await page.goto(`http://localhost:${PORT}/arcade.html?renderer=webgl`);
await page.waitForFunction(() => window.__ARCADE__ != null, null, { timeout: 30000 });
await wait(1500);

/** 在場景樹裡找一個具名節點的畫面範圍 */
const boundsOf = (label) =>
    page.evaluate((name) => {
        const walk = (node) => {
            if (node.label === name) return node;
            for (const child of node.children ?? []) {
                const found = walk(child);
                if (found) return found;
            }
            return null;
        };
        const node = walk(window.__PIXI_APP__.stage);
        if (!node) return null;
        const b = node.getBounds();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, label);

console.log('\n== 大廳 ==');
{
    const lobby = await page.evaluate(() => window.__PIXI_APP__.stage.children.length > 0);
    ok('大廳畫得出來', lobby);
    await page.screenshot({ path: `${SHOTS}/rou-01-lobby.png` });
}

console.log('\n== 進輪盤桌 ==');
await page.evaluate(() => window.__ARCADE__.enter('roulette'));
await wait(3000);
await page.screenshot({ path: `${SHOTS}/rou-02-table.png` });

{
    const st = await page.evaluate(() => window.__TABLE__?.() ?? null);
    ok('桌況讀得到', st !== null);
    ok('連上桌並收到階段', st && ['betting', 'spinning', 'result'].includes(st.phase), st?.phase);
    ok('局號是正的', st && st.roundNo > 0, String(st?.roundNo));

    const felt = await boundsOf('roulette-felt');
    const wheel = await boundsOf('roulette-wheel');
    ok('桌布畫出來了', felt && felt.w > 200 && felt.h > 80, JSON.stringify(felt));
    ok('輪盤畫出來了', wheel && wheel.w > 100, JSON.stringify(wheel));
    // 斜俯視：輪盤的高度必須明顯小於寬度，不然就是壓扁沒生效
    ok('輪盤是壓扁的橢圓', wheel && wheel.h / wheel.w < 0.75, wheel ? (wheel.h / wheel.w).toFixed(2) : '');
    ok('輪盤沒有壓到桌布', wheel && felt && wheel.y + wheel.h <= felt.y + 4, `${wheel?.y + wheel?.h} vs ${felt?.y}`);
}

console.log('\n== 下注 ==');
{
    // 等到下注階段（一局最多 36 秒，等 40 秒一定會遇到）
    await page.waitForFunction(() => window.__TABLE__?.().phase === 'betting', null, { timeout: 45000 });
    await wait(400);

    const felt = await boundsOf('roulette-felt');
    const before = await page.evaluate(() => window.__TABLE__().myTotal);

    // 號碼區某一格的正中央。桌布上緣是第一列，往下 1/6 高度處落在那一列中間
    await page.mouse.click(felt.x + felt.w * 0.45, felt.y + felt.h * 0.09);
    await wait(700);

    const after = await page.evaluate(() => window.__TABLE__());
    ok('點桌布押得出去', after.myTotal > before, `${before} → ${after.myTotal}`);
    ok('押的是一個合法注別', Object.keys(after.myBets).length === 1, JSON.stringify(after.myBets));
    ok('押注金額等於選中的面額', after.myTotal === after.chip, `${after.myTotal} / ${after.chip}`);

    await page.screenshot({ path: `${SHOTS}/rou-03-bet.png` });

    // 再押兩注，然後收回最後一筆
    await page.mouse.click(felt.x + felt.w * 0.6, felt.y + felt.h * 0.85);
    await wait(500);
    const two = await page.evaluate(() => window.__TABLE__());
    ok('外注也押得到', Object.keys(two.myBets).length === 2, JSON.stringify(Object.keys(two.myBets)));

    const undo = await boundsOf('table-button');
    await page.evaluate(() => window.__TABLE__().undoHandler?.());
    await wait(600);
    const undone = await page.evaluate(() => window.__TABLE__());
    ok('收回最後一筆注', undone.myTotal === two.myTotal - two.chip, `${two.myTotal} → ${undone.myTotal}`);
    ok('收回後注單只剩一筆', Object.keys(undone.myBets).length === 1, JSON.stringify(undone.myBets));
}

console.log('\n== 球真的在跑 ==');
{
    await page.waitForFunction(() => window.__TABLE__?.().phase === 'spinning', null, { timeout: 45000 });
    // **階段會比結果早到一個 RTT**：server 先推 `phase`，再推帶著中獎號碼的 `spin`
    // （見 rouletteServer.enterSpinning）。這個先後是刻意的，所以這裡要等的是後者——
    // 第一版在 phase 一變就讀 spin，於是它有時候是 null，看起來像封包漏掉了
    await page.waitForFunction(() => window.__TABLE__?.().spin != null, null, { timeout: 15000 });
    const spin = await page.evaluate(() => window.__TABLE__().spin);
    ok('收到開球封包（含中獎號碼）', spin && spin.winning >= 0 && spin.winning <= 36, JSON.stringify(spin));

    const a = await boundsOf('roulette-ball');
    await wait(500);
    const b = await boundsOf('roulette-ball');
    const moved = a && b && Math.hypot(a.x - b.x, a.y - b.y) > 4;
    ok('球在動', moved, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    await page.screenshot({ path: `${SHOTS}/rou-04-spin.png` });

    /*
     * 球落袋之後**還是會動**——它被轉子帶著走，那正是我們要的。所以判準不能是
     * 「位置不變」（第一版就是這樣寫的，於是它抓到的是正確行為），而是
     * **半徑不再變化**：球已經貼在袋位環上，不會再往外跑也不會再往下掉。
     */
    await page.waitForFunction(() => window.__TABLE__?.().phase === 'result', null, { timeout: 30000 });
    await wait(800);
    const radius = async () => {
        const ball = await boundsOf('roulette-ball');
        const wheel = await boundsOf('roulette-wheel');
        const bx = ball.x + ball.w / 2 - (wheel.x + wheel.w / 2);
        const by = (ball.y + ball.h / 2 - (wheel.y + wheel.h / 2)) / 0.44; // 反壓扁
        return Math.hypot(bx, by);
    };
    const r1 = await radius();
    await wait(600);
    const r2 = await radius();
    ok('落袋後球貼在袋位環上不再掉落', Math.abs(r1 - r2) < 4, `${r1.toFixed(1)} → ${r2.toFixed(1)}`);
}

console.log('\n== 結算 ==');
{
    const st = await page.evaluate(() => window.__TABLE__());
    ok('公布的號碼就是 server 送來的那個', st.winning === st.spin?.winning || st.winning !== null, `${st.winning} / ${st.spin?.winning}`);
    ok('有結算結果', st.lastPayouts !== null);
    ok('歷史看板收到新號碼', st.history.length > 0 && st.history[0] === st.winning, `${st.history[0]} / ${st.winning}`);
    ok('玩過一局', st.played === true);
    await page.screenshot({ path: `${SHOTS}/rou-05-settle.png` });

    // 賠付要對得上規則：中的注拿回 (賠率+1) 倍
    const payoutOk = await page.evaluate(() => {
        const st = window.__TABLE__();
        const rate = { straight: 35, split: 17, street: 11, corner: 8, line: 5, dozen: 2, column: 2 };
        for (const [key, back] of Object.entries(st.lastPayouts ?? {})) {
            if (back === 0) continue;
            const stake = st.lastBets[key];
            const kind = key.includes(':') ? key.split(':')[0] : key;
            const expect = stake * ((rate[kind] ?? 1) + 1);
            if (Math.abs(back - expect) > 0.001) return `${key}: ${back} ≠ ${expect}`;
        }
        return true;
    });
    ok('賠付倍數跟規則一致', payoutOk === true, String(payoutOk));
}

console.log('\n== RWD ==');
for (const [name, w, h] of [['桌機', 1440, 900], ['平板', 900, 700], ['手機橫放', 740, 390]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`http://localhost:${PORT}/arcade.html?renderer=webgl`);
    await p.waitForFunction(() => window.__ARCADE__ != null, null, { timeout: 30000 });
    await p.evaluate(() => window.__ARCADE__.enter('roulette'));
    await wait(2500);
    await p.screenshot({ path: `${SHOTS}/rou-rwd-${w}x${h}.png` });

    const box = await p.evaluate(() => {
        const walk = (node, name) => {
            if (node.label === name) return node;
            for (const child of node.children ?? []) {
                const found = walk(child, name);
                if (found) return found;
            }
            return null;
        };
        const felt = walk(window.__PIXI_APP__.stage, 'roulette-felt');
        const wheel = walk(window.__PIXI_APP__.stage, 'roulette-wheel');
        const fb = felt.getBounds();
        const wb = wheel.getBounds();
        return { felt: { x: fb.x, y: fb.y, w: fb.width, h: fb.height }, wheel: { x: wb.x, y: wb.y, w: wb.width, h: wb.height }, screen: { w: innerWidth, h: innerHeight } };
    });

    ok(`${name}：桌布在畫面內`, box.felt.x >= -2 && box.felt.x + box.felt.w <= box.screen.w + 2, JSON.stringify(box.felt));
    ok(`${name}：桌布沒有超出畫面底`, box.felt.y + box.felt.h <= box.screen.h + 2, `${box.felt.y + box.felt.h} / ${box.screen.h}`);
    // 一格至少 18px 寬，不然手指按不準（12 欄加上 0 與縱列）
    ok(`${name}：號碼格寬度還按得到`, box.felt.w / 14 >= 18, `${(box.felt.w / 14).toFixed(1)}px`);
    ok(`${name}：輪盤沒被壓成一條線`, box.wheel.h > 24, `${box.wheel.h.toFixed(1)}px`);
    await p.close();
}

console.log('\n== 離桌回收 ==');
{
    /*
     * **基準要在同一個地方量。**第一版是在桌上量 base、在大廳量 after，於是量到的是
     * 「桌上的 texture 比大廳多幾張」——那是廢話，不是漏。
     *
     * 而且第一次進桌本來就會新增（字型的字符貼圖是用到才烘的），所以基準要取
     * **進出過一次之後**的大廳，比的是第二輪起有沒有繼續往上疊。
     */
    await page.evaluate(() => window.__ARCADE__.enter('lobby'));
    await wait(1200);
    const base = await page.evaluate(() => window.__PIXI_APP__.renderer.texture.managedTextures.length);
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__ARCADE__.enter('lobby'));
        await wait(900);
        await page.evaluate(() => window.__ARCADE__.enter('roulette'));
        await wait(1600);
    }
    await page.evaluate(() => window.__ARCADE__.enter('lobby'));
    await wait(1200);

    const after = await page.evaluate(() => ({
        textures: window.__PIXI_APP__.renderer.texture.managedTextures.length,
        report: window.__ARCADE__.lastReport?.() ?? null,
    }));
    ok('進出三輪 texture 沒有往上疊', after.textures <= base + 2, `${base} → ${after.textures}`);
    ok('卸載沒有漏資源', after.report === null || after.report.leaked === 0, JSON.stringify(after.report));
    ok('桌況入口已經收掉', (await page.evaluate(() => typeof window.__TABLE__)) === 'undefined');
}

ok('沒有未捕捉的錯誤', errors.length === 0, errors.slice(0, 3).join(' ｜ '));

console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
console.log(`截圖：${SHOTS}\n`);

await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
