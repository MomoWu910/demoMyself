import { initI18n, t, onLangChange } from '../i18n';
import { mountReveal } from '../shell/reveal';

mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開

/*
 * **這一頁的返回鍵不接 shell/goBack**，就讓 HTML 那個 `<a href="./index.html">` 原生導航。
 *
 * goBack 走的是 `history.back()`，賭的是「上一頁就是首頁」。那個賭注在別的頁面成立，
 * 在這裡不成立——**這一頁的歷史紀錄不是自己推的**：預覽用的 iframe 每導航一次，
 * 就往最上層的 session history 塞一筆（見下面的 showPage）。切過五個示範頁之後按返回，
 * 只會讓 iframe 退回上一個示範頁，網址列與主畫面動都不動，按鈕看起來像壞的。
 *
 * iframe 那邊已經改成不推歷史了，但這裡照樣不接 goBack：按鈕上寫的是「返回首頁」，
 * 那就該回首頁——從別的節點頁橫向跳進來的時候，「上一頁」根本不是首頁。
 */

// ------------------------------------------------
// RWD Showcase —— 站內建裝置模擬器
// 用 iframe 以真實 viewport 尺寸載入本站頁面，
// 展示各裝置 / 任意視窗尺寸下佈局皆正常。
// （iframe 呈現真實佈局斷點；不模擬 DPR / touch UA）
// ------------------------------------------------

type DeviceType = 'phone' | 'tablet' | 'desktop';

interface Device { id: string; label: string; w: number; h: number; type: DeviceType }
interface Page { id: string; key: string; url: string }

const DEVICES: Device[] = [
    { id: 'iphone-se', label: 'iPhone SE', w: 375, h: 667, type: 'phone' },
    { id: 'iphone-15', label: 'iPhone 15', w: 393, h: 852, type: 'phone' },
    { id: 'ipad', label: 'iPad', w: 768, h: 1024, type: 'tablet' },
    { id: 'laptop', label: 'Laptop', w: 1280, h: 800, type: 'desktop' },
    { id: 'desktop', label: 'Desktop', w: 1920, h: 1080, type: 'desktop' },
];

const PAGES: Page[] = [
    { id: 'home', key: 'rwd.page.home', url: './index.html' },
    { id: 'px3', key: 'rwd.page.px3', url: './pixi_x_three.html' },
    { id: 'cfg', key: 'rwd.page.cfg', url: './configurator.html' },
    { id: 'stress', key: 'rwd.page.stress', url: './pixi_stress.html' },
    { id: 'shiba', key: 'rwd.page.shiba', url: './pixi_stress2.html' },
    { id: 'opt', key: 'rwd.page.opt', url: './pixi_optimization.html' },
    { id: 'find', key: 'rwd.page.find', url: './findings.html' },
    { id: 'shader', key: 'rwd.page.shader', url: './shader_lab.html' },
    { id: 'arcade', key: 'rwd.page.arcade', url: './arcade.html' },
    { id: 'park', key: 'rwd.page.park', url: './park.html' },
];

const MIN_W = 240, MIN_H = 320, MAX_W = 3840, MAX_H = 2160;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const stage = $('stage');
const frameOuter = $('frame-outer');
const frame = $('frame');
const viewportBox = $('viewport-box');
const preview = $<HTMLIFrameElement>('preview');
const chromeUrl = $('chrome-url');
const sizeW = $('size-w');
const sizeH = $('size-h');
const handle = $('handle');
const devicesEl = $('devices');
const pagesEl = $('pages');
const rotateBtn = $<HTMLButtonElement>('rotate');

// --- 狀態 ---
let frameW = 393, frameH = 852;          // 目前 viewport 尺寸（CSS px）
let activeDevice: string | null = 'iphone-15'; // null = 自由拖拉的 custom 尺寸
/**
 * 目前預覽的是清單裡的哪一頁。**null = 不在清單裡**——預覽的頁面自己導航得到那種地方
 * （壓測頁的返回鍵回的是 findings，模擬器不該硬把某顆 pill 點亮）。
 */
let activePage: Page | null = PAGES[0];
/** 假網址列顯示什麼。跟 activePage 分開存，因為 iframe 可能導到清單外的位址 */
let previewPath = PAGES[0].url;

// 依寬度決定外框樣式（自由拖拉時也會跟著變）
const frameType = (): DeviceType => (frameW < 600 ? 'phone' : frameW < 1000 ? 'tablet' : 'desktop');

// 外框額外佔用的尺寸（bezel padding / 桌機窗框）
const frameMetrics = (type: DeviceType) => {
    if (type === 'desktop') return { padW: 2, padH: 2 + 34 }; // border + chrome bar
    if (type === 'tablet') return { padW: 30, padH: 30 };
    return { padW: 26, padH: 26 };
};

/** 重新排版：viewport 實尺寸 + 整框等比縮小塞進舞台。fixedScale 供拖曳中凍結縮放比。 */
let currentScale = 1;
const applyLayout = (fixedScale?: number) => {
    const type = frameType();
    frame.className = `device-frame type-${type}`;

    viewportBox.style.width = `${frameW}px`;
    viewportBox.style.height = `${frameH}px`;

    const { padW, padH } = frameMetrics(type);
    const totalW = frameW + padW;
    const totalH = frameH + padH;

    // 舞台可用空間（扣掉尺寸標示與提示文字的高度餘裕）
    const availW = stage.clientWidth - 28;
    const availH = stage.clientHeight - 78;
    currentScale = fixedScale ?? Math.min(1, availW / totalW, availH / totalH);

    frame.style.width = `${totalW}px`;
    frame.style.transform = `scale(${currentScale})`;
    frameOuter.style.width = `${totalW * currentScale}px`;
    frameOuter.style.height = `${totalH * currentScale}px`;

    sizeW.textContent = String(frameW);
    sizeH.textContent = String(frameH);
    chromeUrl.textContent = previewPath.replace('./', '/');
};

// --- 裝置 pills ---
const deviceBtns = new Map<string, HTMLButtonElement>();
const paintDevices = () => {
    deviceBtns.forEach((b, id) => b.classList.toggle('active', id === activeDevice));
};
DEVICES.forEach((d) => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = d.label;
    b.addEventListener('click', () => {
        activeDevice = d.id;
        frameW = d.w; frameH = d.h;
        paintDevices();
        applyLayout();
    });
    devicesEl.appendChild(b);
    deviceBtns.set(d.id, b);
});

// --- 轉向 ---
rotateBtn.addEventListener('click', () => {
    [frameW, frameH] = [frameH, frameW];
    applyLayout();
});

/**
 * 換掉預覽的頁面。
 *
 * **不能寫 `preview.src = url`。** 設 iframe 的 src 等同在子框架裡做一次導航，而子框架的
 * 導航會被記進**最上層**的 session history——切幾次示範頁，這一頁就多幾筆歷史紀錄。
 * 後果是瀏覽器的上一頁（以及任何走 `history.back()` 的返回鍵）只會讓 iframe 倒退回
 * 上一個示範頁，網址列與主畫面完全不動，看起來就像返回鍵壞掉。
 *
 * 改成叫子視窗自己 `location.replace`：一樣是導航，但**取代**當前紀錄而不是新增一筆。
 * 網址要先絕對化——子視窗此刻的 base 是它自己的位址，拿相對路徑進去會解析錯。
 *
 * 拿不到 contentWindow（理論上只有跨源會這樣，而這裡預覽的都是本站頁面）就退回設 src：
 * 那時歷史會被多推一筆，但總比整個預覽空掉好。
 */
function showPage(url: string): void {
    previewPath = url;
    const win = preview.contentWindow;
    if (win) {
        try {
            win.location.replace(new URL(url, window.location.href).href);
            return;
        } catch {
            /* 跨源就退回設 src */
        }
    }
    preview.src = url;
}

// --- 頁面 pills ---
const pageBtns = new Map<string, HTMLButtonElement>();
const paintPages = () => {
    pageBtns.forEach((b, id) => b.classList.toggle('active', id === activePage?.id));
};
PAGES.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = t(p.key);
    b.addEventListener('click', () => {
        if (activePage?.id === p.id) return;
        activePage = p;
        showPage(p.url); // 全程只有一個 live iframe，切頁只換它的位址
        paintPages();
        applyLayout();
    });
    pagesEl.appendChild(b);
    pageBtns.set(p.id, b);
});
onLangChange(() => {
    pageBtns.forEach((b, id) => { b.textContent = t(PAGES.find((p) => p.id === id)!.key); });
});

/*
 * 預覽的頁面**自己也會導航**：它們的返回鍵、頁內連結都會換頁，而模擬器完全不知情。
 * 不校正的話，假網址列會一直停在上次用 pill 切過去的那一頁——預覽裡明明已經是首頁，
 * 上面卻還寫著 /arcade.html，看起來像模擬器壞了。
 *
 * 同源才讀得到子視窗的位址（預覽的都是本站頁面）；讀不到就維持原樣，不是錯誤。
 */
preview.addEventListener('load', () => {
    let path: string;
    try {
        const win = preview.contentWindow;
        if (!win) return;
        path = `.${win.location.pathname}`;
    } catch {
        return; // 跨源，讀不到就別猜
    }
    if (path === previewPath) return;

    previewPath = path;
    // 導到清單外的頁面時 activePage 收成 null，pill 就全部熄掉——
    // 硬留著上一顆亮著，等於告訴使用者他正在看一個他其實沒在看的頁面
    activePage = PAGES.find((p) => p.url === path) ?? null;
    paintPages();
    applyLayout();
});

// --- 自由拖拉手把（pointer capture，拖曳中凍結縮放比避免抖動）---
let dragging = false;
let dragStartX = 0, dragStartY = 0, dragStartW = 0, dragStartH = 0, dragScale = 1;
handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragStartW = frameW; dragStartH = frameH;
    dragScale = currentScale;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
});
handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    frameW = Math.round(Math.min(MAX_W, Math.max(MIN_W, dragStartW + (e.clientX - dragStartX) / dragScale)));
    frameH = Math.round(Math.min(MAX_H, Math.max(MIN_H, dragStartH + (e.clientY - dragStartY) / dragScale)));
    if (activeDevice !== null) { activeDevice = null; paintDevices(); } // 進入 custom 模式
    applyLayout(dragScale);
});
const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    applyLayout(); // 放開後重新 fit 舞台
};
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);

// --- 初始化 ---
initI18n({ parent: $('lang-slot') });
// 第一次可以直接設 src：iframe 還沒導航過，這一次是「初始載入」而不是換頁，
// 不會往上層歷史推紀錄。之後的每一次都得走 showPage
preview.src = previewPath;
paintDevices();
paintPages();
applyLayout();
window.addEventListener('resize', () => applyLayout());
