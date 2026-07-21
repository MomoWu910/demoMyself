/**
 * 天色——首頁那一面水映的是**現在幾點的天空**。
 *
 * 一天被切成 7 個關鍵時刻，之間線性插值；23:00 → 01:00 要接得起來，所以查表是**環狀**的。
 * 時間來自使用者的系統時鐘：他幾點打開就看到幾點的天色。這比循環動畫誠實，也不違背
 * 「水面平常完全靜止、只有動作才有擾動」的設計——天色變得太慢，肉眼看不出它在動。
 *
 * 每個時刻定四個色，對應 field.ts 裡四個 uniform：
 *   sky     天頂色。畫面**下方**（近處水面）映的是它
 *   horizon 地平線暖光。畫面**上方**（遠處水面）映的是它——這條垂直漸層是寫實感的主要來源
 *   water   水體本身的底色，倒影疊在它上面
 *   sun     光源色。斜面反光取這個色，日間冷白、黃昏橘金、夜裡月光青白
 *
 * 另外導出 lum（0=夜、1=正午）。它決定兩件事：倒影對比與暈影深度（連續變化），
 * 以及前景走 light 還是 dark（離散切換，見 applyTheme 的說明）。
 */

export type RGB = [number, number, number];

interface SkyKey {
    /** 一天中的第幾小時（0..24），必須遞增 */
    hour: number;
    sky: string;
    horizon: string;
    water: string;
    sun: string;
    /** 天色明度。手填而不是從 hex 算亮度——這裡要的是「感覺多亮」，不是數學上的 luminance */
    lum: number;
}

const KEYS: SkyKey[] = [
    // 夜色刻意**不壓到全黑**：真正的夜水面是深藍靛，全黑會讀成「背景沒載出來」而不是夜晚。
    // 月光的存在感交給 sun（冷青白）＋ 下面的月光帶，不是靠把周圍壓黑襯出來。
    { hour: 3, sky: '#0d1426', horizon: '#17213e', water: '#080e1a', sun: '#a8c0ea', lum: 0.03 },
    { hour: 5.5, sky: '#1b2340', horizon: '#4a3a52', water: '#0c1020', sun: '#c58a9a', lum: 0.1 },
    { hour: 8, sky: '#6d9bd8', horizon: '#c3d9ec', water: '#4a7099', sun: '#fff4e0', lum: 0.62 },
    { hour: 13, sky: '#7fb0e8', horizon: '#cfe2f2', water: '#4a7ba8', sun: '#ffffff', lum: 0.85 },
    // 午後金光。這格存在的理由是**可讀性**不是美感：13 → 17.5 直接插值的話，
    // 前景翻回 dark 的那一刻水面已經暗到深色字讀不了了。有這格撐著，亮的時段就一路亮到翻面前一刻。
    { hour: 16, sky: '#6d97cf', horizon: '#e8c9a8', water: '#456d96', sun: '#ffd9a8', lum: 0.6 },
    { hour: 17.5, sky: '#4a6a9e', horizon: '#ff9a4d', water: '#2a3a5c', sun: '#ffb066', lum: 0.45 },
    { hour: 19.25, sky: '#1e2647', horizon: '#6b4a6e', water: '#101830', sun: '#c08ab0', lum: 0.14 },
    { hour: 21, sky: '#101a30', horizon: '#1d2a4a', water: '#0b1220', sun: '#b0c4ec', lum: 0.06 },
];

/**
 * 前景翻成 light 的門檻。
 *
 * 0.58 是**量出來的**，不是挑的：它讓翻面發生在 07:49 與 16:12，兩個時刻的水面色都還在
 * #40608c 上下——淺底深字撐得住的最暗邊界。門檻設 0.5 的話早上會在天還沒真的亮起來時就翻，
 * 深色文字直接消失在深藍水面上。調 keyframe 的話這個值要一起重算——
 * **而且 index.html 的首屏 inline script 裡有同一組門檻的複本（7.81 / 16.20），也要一起改**。
 * 那份沒辦法共用這裡的程式碼：它必須在 bundle 載入前就跑完，否則白天開會先閃一次深墨。
 */
const LIGHT_THRESHOLD = 0.58;

function hex2rgb(hex: string): RGB {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export interface SkyPalette {
    sky: RGB;
    horizon: RGB;
    water: RGB;
    sun: RGB;
    /** 0=夜 1=正午 */
    lum: number;
    /** 倒影疊在水體上的強度。白天雲影清楚，夜裡幾乎看不見 */
    cloud: number;
    /** 暈影的邊角亮度下限（1=不壓暗）。亮版壓太多會顯髒 */
    vig: number;
    /**
     * 月光／日光帶的強度。
     *
     * 夜間水面最有辨識度的特徵就是月亮正下方那條被水波揉碎的亮帶（moonglade）——
     * 沒有它，夜色只是一片暗，有了它才看得出「上面有一顆月亮」。
     * 白天太陽高掛、反光散開，所以強度反而低；黃昏最強且被 sun 染成橘金，成了夕照水路。
     */
    glint: number;
    /** 前景是否該翻成深字淺底 */
    light: boolean;
}

/** 查某個時刻的天色。hour 可以超出 0..24，會自動繞回。 */
export function skyAt(hour: number): SkyPalette {
    const h = ((hour % 24) + 24) % 24;

    // 找出 h 落在哪兩個 key 之間。落在最後一個之後或第一個之前，都是跨午夜那一段——
    // 把尾端的 key 借過來當起點（+24 小時），插值才連續。
    let a = KEYS[KEYS.length - 1];
    let b = KEYS[0];
    let aHour = a.hour - 24;
    let bHour = b.hour;
    for (let i = 0; i < KEYS.length - 1; i++) {
        if (h >= KEYS[i].hour && h < KEYS[i + 1].hour) {
            a = KEYS[i];
            b = KEYS[i + 1];
            aHour = a.hour;
            bHour = b.hour;
            break;
        }
    }
    if (h >= KEYS[KEYS.length - 1].hour) {
        a = KEYS[KEYS.length - 1];
        b = KEYS[0];
        aHour = a.hour;
        bHour = b.hour + 24;
    }

    const t = (h - aHour) / (bHour - aHour);
    const lum = lerp(a.lum, b.lum, t);

    return {
        sky: lerpRGB(hex2rgb(a.sky), hex2rgb(b.sky), t),
        horizon: lerpRGB(hex2rgb(a.horizon), hex2rgb(b.horizon), t),
        water: lerpRGB(hex2rgb(a.water), hex2rgb(b.water), t),
        sun: lerpRGB(hex2rgb(a.sun), hex2rgb(b.sun), t),
        lum,
        cloud: lerp(0.2, 0.31, lum),
        vig: lerp(0.76, 0.88, lum),
        glint: lerp(0.3, 0.07, lum),
        light: lum > LIGHT_THRESHOLD,
    };
}

/** 使用者用時刻軸撥到的時間。null = 跟著真實時鐘走。 */
let override: number | null = null;

/**
 * 真正的「現在幾點」，不理會使用者撥到哪。時刻軸要靠它標出真實時間的刻度，
 * 所以不能跟 currentHour 併成同一個——撥動後那兩個值就分岔了。
 */
export function realHour(): number {
    const forced = new URLSearchParams(window.location.search).get('hour');
    if (forced !== null) {
        const n = Number(forced);
        if (Number.isFinite(n)) return n;
    }
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/**
 * 畫面現在該用哪個時刻。三層優先序：使用者撥的 > `?hour=` > 系統時鐘。
 * `?hour=17.5` 是給開發/截圖用的，撥動時刻軸會蓋過它。
 */
export function currentHour(): number {
    return override ?? realHour();
}

/** 撥到某個時刻；傳 null 交還給真實時鐘。會立刻重算並廣播。 */
export function setHourOverride(h: number | null): void {
    override = h;
    refreshSky();
}

export function isOverridden(): boolean {
    return override !== null;
}

const skyListeners = new Set<(p: SkyPalette) => void>();

/** 訂閱天色更新（每分鐘的時鐘重查、以及使用者撥動時刻軸）。 */
export function onSkyChange(fn: (p: SkyPalette) => void): () => void {
    skyListeners.add(fn);
    return () => skyListeners.delete(fn);
}

/**
 * 重算當下天色、套用前景主題、通知所有訂閱者。
 *
 * 天色的變更只有這一個入口——不論是 ticker 每分鐘的例行重查還是使用者撥動時刻軸，
 * 都走這裡，shader、canvas 前景、CSS 三邊才不會各自對到不同的時刻。
 */
export function refreshSky(): SkyPalette {
    const p = skyAt(currentHour());
    applyTheme(p.light);
    for (const fn of skyListeners) fn(p);
    return p;
}

/**
 * 前景的兩套色票。
 *
 * 前景刻意**不跟著天色連續插值**：中間會經過「灰字疊在灰底」的死亡地帶，黃昏那一段完全不能讀。
 * 改成跨過明度門檻時整套切換，再靠 CSS transition 把那一下抹平——背景連續、前景離散。
 *
 * 亮版的品牌色全部要壓暗：#ff8a3d 這種在深墨底上很亮的橘，放到淺底上對比只剩 2:1。
 */
const LIGHT_VARS: Record<string, string> = {
    '--ink': '#cfe0ee',
    '--ink-2': '#ffffff',
    '--glsl': '#b8500c',
    '--wgsl': '#6134bd',
    '--dual': '#9c3f96',
    '--pixi': '#1361bd',
    '--text': '#080d15',
    '--muted': '#39434f',
    '--panel': 'rgba(255, 255, 255, 0.66)',
    '--panel-border': 'rgba(10, 20, 35, 0.14)',
    // 語言切換鈕（i18n/index.ts）是全站共用的，靠這組變數跟著首頁翻面；其他頁沒設就落回深色
    '--lang-bg': 'rgba(255, 255, 255, 0.5)',
    '--lang-border': 'rgba(10, 20, 35, 0.14)',
    '--lang-active': 'rgba(10, 20, 35, 0.14)',
    '--lang-fg': '#0e131c',
    '--lang-muted': '#4d5866',
    // 只有散開的一層。貼身那層會把深色字的邊緣啃掉，字看起來就淡了
    '--halo-shadow': '0 0 14px rgba(255, 255, 255, 0.95), 0 0 26px rgba(255, 255, 255, 0.7)',
};

const DARK_VARS: Record<string, string> = {
    '--ink': '#0b0c10',
    '--ink-2': '#11141c',
    '--glsl': '#ff8a3d',
    '--wgsl': '#b57bff',
    '--dual': '#d98ad6',
    '--pixi': '#5aa9ff',
    '--text': '#eceef4',
    '--muted': '#8b90a0',
    '--panel': 'rgba(15, 18, 26, 0.66)',
    '--panel-border': 'rgba(255, 255, 255, 0.09)',
    '--lang-bg': 'rgba(0, 0, 0, 0.35)',
    '--lang-border': 'rgba(255, 255, 255, 0.12)',
    '--lang-active': 'rgba(255, 255, 255, 0.16)',
    '--lang-fg': '#f4f4f5',
    '--lang-muted': '#a1a1aa',
    // 淺色字配暗暈就沒有啃邊問題（暗色不會侵蝕亮字形），貼身那層留著拉出邊界
    '--halo-shadow': '0 0 3px rgba(4, 7, 14, 0.85), 0 0 12px rgba(4, 7, 14, 0.8)',
};

/** Pixi 端要用的前景色。canvas 裡的東西吃不到 CSS 變數，只能另外給一份。 */
export interface ForegroundColors {
    /** 節點核心的玻璃底 */
    core: number;
    /** 節點中央的 glyph */
    glyph: number;
    /** 節點下方的標籤 */
    label: number;
    /**
     * 文字外圈的光暈色（跟文字反向）。
     *
     * 天色是連續的、前景是離散的，中間必然有一段「文字顏色對這塊背景不夠好」——尤其黃昏，
     * 畫面上緣是亮橘霞、下緣是深藍水，同一套文字色不可能兩邊都站得住。
     * 與其去猜每塊區域多亮，不如給每個字一圈反色暈：背景再怎麼變，字永遠有自己的底。
     */
    halo: number;
    /**
     * halo 的模糊半徑。亮版要大得多——Pixi 的 dropShadow 畫在字**底下**不會啃邊
     * （不像 CSS text-shadow），所以這裡不必像 CSS 那樣拿掉貼身層，改成整片放大當背板。
     */
    haloBlur: number;
    /** tone → 代表色 */
    tone: { glsl: number; wgsl: number; dual: number; pixi: number; neutral: number };
}

const LIGHT_FG: ForegroundColors = {
    core: 0xf6fafd,
    glyph: 0x0e131c,
    label: 0x1e2733,
    halo: 0xffffff,
    haloBlur: 9,
    tone: { glsl: 0xb8500c, wgsl: 0x6134bd, dual: 0x9c3f96, pixi: 0x1361bd, neutral: 0x5b6472 },
};

const DARK_FG: ForegroundColors = {
    core: 0x11141c,
    glyph: 0xf2f4fa,
    label: 0xc9cede,
    halo: 0x05070c,
    haloBlur: 5,
    tone: { glsl: 0xff8a3d, wgsl: 0xb57bff, dual: 0xd98ad6, pixi: 0x5aa9ff, neutral: 0x9aa0b2 },
};

export function foregroundFor(light: boolean): ForegroundColors {
    return light ? LIGHT_FG : DARK_FG;
}

let appliedLight: boolean | null = null;
const themeListeners = new Set<(light: boolean) => void>();

/** 把前景色票寫到 :root。同一個主題重複套用會被擋掉，所以可以每幀無腦呼叫。 */
export function applyTheme(light: boolean): void {
    if (appliedLight === light) return;
    appliedLight = light;

    const vars = light ? LIGHT_VARS : DARK_VARS;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.sky = light ? 'light' : 'dark';

    for (const fn of themeListeners) fn(light);
}

/** 訂閱 light/dark 翻面。canvas 內的東西靠這個重畫。 */
export function onThemeChange(fn: (light: boolean) => void): () => void {
    themeListeners.add(fn);
    return () => themeListeners.delete(fn);
}
