import { initI18n, t, onLangChange } from '../i18n';
import { mountReveal } from '../shell/reveal';

mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開

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
let activePage = PAGES[0];

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
    chromeUrl.textContent = activePage.url.replace('./', '/');
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

// --- 頁面 pills ---
const pageBtns = new Map<string, HTMLButtonElement>();
const paintPages = () => {
    pageBtns.forEach((b, id) => b.classList.toggle('active', id === activePage.id));
};
PAGES.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = t(p.key);
    b.addEventListener('click', () => {
        if (activePage.id === p.id) return;
        activePage = p;
        preview.src = p.url; // 全程只有一個 live iframe，切頁才換 src
        paintPages();
        applyLayout();
    });
    pagesEl.appendChild(b);
    pageBtns.set(p.id, b);
});
onLangChange(() => {
    pageBtns.forEach((b, id) => { b.textContent = t(PAGES.find((p) => p.id === id)!.key); });
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
preview.src = activePage.url;
paintDevices();
paintPages();
applyLayout();
window.addEventListener('resize', () => applyLayout());
