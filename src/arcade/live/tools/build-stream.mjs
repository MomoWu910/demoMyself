/**
 * 荷官流的生成管線。`npm run build:stream`
 *
 * 從牌靴一路做到可以餵給播放器的切片，中間不經過任何外部素材：
 *
 * ```
 * BaccaratShoe ──► 牌序 ──► schedule.ts 排時間表 ──► cues.json
 *                                │
 *                                ├──► Pixi 逐幀渲染（Playwright）──► JPEG 序列
 *                                │                                      │
 *                                │                                  ffmpeg
 *                                │                                      ▼
 *                                └──────────────────────────► fMP4 切片 + playlist
 *                                                                       │
 *                                                                 manifest.json
 * ```
 *
 * **牌序與畫面出自同一次執行**，這是整條管線的重點。live server 讀 `cues.json` 推封包，
 * 播放器讀 `manifest.json` 播畫面，兩者對得起來不是因為做了對齊，而是因為它們來自
 * 同一份資料——真實視訊桌台的因果也是這個方向（荷官發什麼，server 就說什麼）。
 *
 * 為什麼逐幀截圖而不是錄製 canvas：`MediaRecorder` 錄的是**真實時間**，掉一幀就少一幀，
 * 每次錄出來的長度還不一樣。逐幀 seek 截圖跑得慢，但素材是可重現的——同一份牌序永遠
 * 產生同一段影片，改了場景才會變。
 */
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const { buildSync } = projectRequire('esbuild');

/** 幾局。局數決定循環多久才會重複，太少一眼就看穿，太多素材就肥 */
const ROUNDS = Number(process.env.ROUNDS ?? 12);
/** 影格率。20 已經足夠讓發牌看起來順，25 只是讓檔案大 25% */
const FPS = Number(process.env.FPS ?? 20);
/** 切片長度（秒）。短一點延遲低，但檔案數量會變多 */
const SEG_SECONDS = 2;
/** 影片碼率。640×360 的呢面與牌面沒什麼高頻細節，900k 就很乾淨了 */
const BITRATE = process.env.BITRATE ?? '900k';

const OUT_DIR = path.join(ROOT, 'public/live/table01');
const WORK = path.join(ROOT, '.stream-build');

const log = (...a) => console.log(...a);

// ---- 1. 牌序與時間表 -------------------------------------------------------

log('\n[1/5] 產生牌序與時間表');

const bundle = buildSync({
    stdin: {
        contents: `
            export { BaccaratShoe } from './src/arcade/server/baccaratShoe';
            export { scheduleStream, ROUND_DURATION } from './src/arcade/live/schedule';
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
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { BaccaratShoe, scheduleStream, ROUND_DURATION } = mod.exports;

// 固定亂數種子：素材要可重現。同一個 seed 永遠得到同一副牌序，改了場景重跑
// 也還是同一局牌，這樣才看得出改動的是畫面還是內容
let seed = Number(process.env.SEED ?? 20260825);
const random = () => {
    // mulberry32。要的是可重現而不是統計品質——牌靴的洗牌品質由 baccarat-check.mjs 驗
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shoe = new BaccaratShoe(random);
const rounds = [];
for (let i = 0; i < ROUNDS; i++) rounds.push(shoe.draw().round);

const cues = scheduleStream(rounds);
const DURATION = cues.duration;
const TOTAL_FRAMES = Math.round(DURATION * FPS);

log(`      ${ROUNDS} 局 × ${ROUND_DURATION}s = ${DURATION}s，${TOTAL_FRAMES} 幀 @ ${FPS}fps`);
for (const [i, r] of rounds.entries()) {
    const p = r.player.map(cardStr).join(' ');
    const b = r.banker.map(cardStr).join(' ');
    log(`      #${i + 1} 閒 ${p} (${r.playerTotal})  莊 ${b} (${r.bankerTotal})  → ${r.outcome}`);
}

function cardStr(c) {
    const R = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
    const S = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
    return `${S[c.suit]}${R[c.rank] ?? c.rank}`;
}

// ---- 2. 渲染頁 -------------------------------------------------------------

log('\n[2/5] 打包渲染頁');

rmSync(WORK, { recursive: true, force: true });
mkdirSync(path.join(WORK, 'frames'), { recursive: true });

buildSync({
    stdin: {
        contents: `
            import { Application } from 'pixi.js';
            import { createDealerScene, STREAM_WIDTH, STREAM_HEIGHT } from './src/arcade/live/dealerScene';

            const cues = JSON.parse(document.getElementById('cues').textContent);

            (async () => {
                const app = new Application();
                // 一定要 webgl：headless 下 WebGPU 的 canvas 畫得出來但截圖是空的
                await app.init({
                    width: STREAM_WIDTH, height: STREAM_HEIGHT,
                    preference: 'webgl', antialias: true, background: 0x0b1a14, autoStart: false,
                });
                // 停掉 ticker：每一格畫面都是 seek 出來的，不能讓真實時間插手
                app.ticker.stop();
                document.body.appendChild(app.canvas);
                app.canvas.id = 'stage';

                const scene = createDealerScene(app, cues);
                app.stage.addChild(scene.view);

                window.__seek = (t) => { scene.seek(t); app.render(); };
                window.__seek(0);
                window.__ready = true;
            })();
        `,
        resolveDir: ROOT,
        loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(WORK, 'render.js'),
    logLevel: 'error',
});

writeFileSync(
    path.join(WORK, 'render.html'),
    `<!doctype html><meta charset="utf-8"><title>dealer render</title>
<body style="margin:0;background:#000">
<script type="application/json" id="cues">${JSON.stringify(cues)}</script>
<script src="render.js"></script>`,
);

// ---- 3. 逐幀截圖 -----------------------------------------------------------

log(`\n[3/5] 逐幀渲染 ${TOTAL_FRAMES} 幀`);

const pwRequire = createRequire('/Users/eric.wu/.npm/_npx/705bc6b22212b352/');
let chromium;
try {
    ({ chromium } = pwRequire('/Users/eric.wu/.npm/_npx/705bc6b22212b352/node_modules/playwright'));
} catch {
    console.error('  找不到 Playwright。它不在專案依賴裡，靠的是 npx cache——');
    console.error('  跑一次 `npx playwright@latest --version` 把它拉回來再重試。');
    process.exit(1);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 420 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('  [render error]', e.message));

await page.goto(`file://${path.join(WORK, 'render.html')}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

const stage = page.locator('#stage');
const t0 = Date.now();
for (let f = 0; f < TOTAL_FRAMES; f++) {
    await page.evaluate((t) => window.__seek(t), f / FPS);
    await stage.screenshot({
        path: path.join(WORK, 'frames', `f-${String(f).padStart(5, '0')}.jpg`),
        type: 'jpeg',
        quality: 92,
        animations: 'disabled',
    });
    if (f % 100 === 0 || f === TOTAL_FRAMES - 1) {
        const pct = ((f + 1) / TOTAL_FRAMES) * 100;
        const eta = f > 0 ? ((Date.now() - t0) / (f + 1)) * (TOTAL_FRAMES - f - 1) / 1000 : 0;
        log(`      ${String(f + 1).padStart(5)}/${TOTAL_FRAMES}  ${pct.toFixed(1)}%  剩約 ${eta.toFixed(0)}s`);
    }
}
await browser.close();

const frameCount = readdirSync(path.join(WORK, 'frames')).filter((n) => n.endsWith('.jpg')).length;
if (frameCount !== TOTAL_FRAMES) {
    console.error(`  截到的幀數不對：預期 ${TOTAL_FRAMES}，實得 ${frameCount}`);
    process.exit(1);
}

// ---- 4. 編碼與切片 ---------------------------------------------------------

log('\n[4/5] 編碼與切片');

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const gop = SEG_SECONDS * FPS;
const mp4 = path.join(WORK, 'dealer.mp4');

// GOP 對齊切片長度：每一段都要以 keyframe 開頭，否則切片自己解不開
execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', String(FPS),
    '-i', path.join(WORK, 'frames', 'f-%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-b:v', BITRATE, '-maxrate', BITRATE, '-bufsize', String(parseInt(BITRATE) * 2) + 'k',
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-an', mp4,
]);

execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', mp4, '-c', 'copy', '-f', 'hls',
    '-hls_time', String(SEG_SECONDS),
    '-hls_playlist_type', 'vod', '-hls_list_size', '0',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(OUT_DIR, 'seg-%d.m4s'),
    path.join(OUT_DIR, 'index.m3u8'),
]);

// ---- 5. manifest -----------------------------------------------------------

log('\n[5/5] 寫 manifest');

// 每段的真實時長從 playlist 讀回來，不用算的——最後一段幾乎一定不等長，
// 算出來的值會讓 timestampOffset 一圈比一圈偏
const playlist = readFileSync(path.join(OUT_DIR, 'index.m3u8'), 'utf-8');
const segments = [];
const lines = playlist.split('\n');
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#EXTINF:([\d.]+)/);
    if (m) segments.push({ url: lines[i + 1].trim(), duration: Number(m[1]) });
}

const mimeCodec = readCodec(path.join(OUT_DIR, 'init.mp4'));

/**
 * 從 init segment 的 avcC box 讀出 codec 字串。
 *
 * 用讀的而不是從 ffprobe 的 profile 名稱去映射：那張對照表要自己維護（High=64、
 * Main=4d、Baseline=42…），而且 constraint flags 那個 byte 從名稱推不出來。
 * avcC 裡就躺著現成的三個 byte，照抄最不會錯。
 */
function readCodec(file) {
    const buf = readFileSync(file);
    const at = buf.indexOf('avcC');
    if (at < 0) throw new Error('init segment 裡找不到 avcC box');
    // avcC 之後：configurationVersion(1) + profile(1) + compat(1) + level(1)
    const profile = buf[at + 5], compat = buf[at + 6], level = buf[at + 7];
    const hex = (n) => n.toString(16).padStart(2, '0');
    return `video/mp4; codecs="avc1.${hex(profile)}${hex(compat)}${hex(level)}"`;
}

// epoch 兩邊都要：播放器靠它算「現在該播哪一段」，live server 靠它算「現在該推什麼」。
// 同一個值寫進兩個檔案而不是互相引用——它們是各自獨立取用的資源，
// 讓其中一個去讀另一個會多出一條沒必要的相依
const EPOCH = Date.now();

const manifest = {
    initUrl: 'init.mp4',
    segments,
    mimeCodec,
    // 素材的第 0 秒對應的牆鐘時刻。**寫死在檔案裡**——所有觀眾靠它算出同一個播放位置，
    // 用 Date.now() 各算各的就退化成各看各的錄影帶
    epoch: EPOCH,
    // 底下這些不是播放器要的，是給人看的
    meta: { rounds: ROUNDS, fps: FPS, duration: DURATION, seed: Number(process.env.SEED ?? 20260825) },
};
writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(OUT_DIR, 'cues.json'), JSON.stringify({ ...cues, epoch: EPOCH }, null, 2));

rmSync(WORK, { recursive: true, force: true });

const bytes = readdirSync(OUT_DIR).reduce((sum, n) => sum + readFileSync(path.join(OUT_DIR, n)).length, 0);
log(`\n完成 → ${path.relative(ROOT, OUT_DIR)}`);
log(`      ${segments.length} 段切片，共 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
log(`      codec ${mimeCodec}`);
log(`      一圈 ${DURATION}s，${ROUNDS} 局\n`);

if (!existsSync(path.join(OUT_DIR, 'init.mp4'))) {
    console.error('init segment 沒生出來');
    process.exit(1);
}
