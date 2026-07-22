import type { CfgSelection, PartUiState } from './store';
import type { BackgroundMode } from '../managers/environmentManager';

/**
 * 把整組設定編進網址、以及從網址讀回來。
 *
 * **刻意用人看得懂的參數，不是 base64 的一坨。**
 * `?fin.whole=metallic&tint.whole=crimson&cw=midnight&lp=dramatic&env=0.45&bg=white`
 * 這種形式可以直接改網址列來試、貼進 issue 時看得出差在哪，也不會因為之後
 * 加欄位就讓舊連結整條失效（讀不到的 key 就用預設值，見 readSelection）。
 * 代價是網址長一點——這頁的分享情境是貼給人看，不是塞進 QR code。
 *
 * 每個部件各有 finish / tint，所以用 `fin.<partId>` / `tint.<partId>` 展開；
 * 單一 mesh 的模型就只會有 `fin.whole` 一組。
 */

const BACKGROUNDS: BackgroundMode[] = ['studio', 'gradient', 'dark', 'white'];
const CAMERA_VIEWS = ['hero', 'side', 'front', 'top', 'detail'];

/** 數字參數的範圍——網址是使用者可以亂改的輸入，夾在合法範圍內才不會把場景弄壞 */
const NUM_RANGE = {
    env: [0, 3],
    rot: [0, 360],
    key: [0, 6],
    temp: [2700, 9000],
    tile: [0.5, 16],
    bump: [0, 1.5],
} as const;

function clamp(v: number, [min, max]: readonly [number, number]): number {
    return Math.min(max, Math.max(min, v));
}

/** 只寫進與預設值不同的欄位，網址才不會每次都拖著一長串沒意義的參數 */
export function encodeSelection(s: CfgSelection, defaults: CfgSelection): string {
    const q = new URLSearchParams();

    for (const [partId, ui] of Object.entries(s.partState)) {
        const base = defaults.partState[partId] as PartUiState | undefined;
        if (ui.finishId !== (base?.finishId ?? 'original')) q.set(`fin.${partId}`, ui.finishId);
        if (ui.tintId !== (base?.tintId ?? 'none')) q.set(`tint.${partId}`, ui.tintId);
    }
    if (s.variant && s.variant !== defaults.variant) q.set('cw', s.variant);
    if (s.lightingPreset !== defaults.lightingPreset) q.set('lp', s.lightingPreset);
    if (s.envIntensity !== defaults.envIntensity) q.set('env', s.envIntensity.toFixed(2));
    if (s.envRotationDeg !== defaults.envRotationDeg) q.set('rot', String(Math.round(s.envRotationDeg)));
    if (s.keyIntensity !== defaults.keyIntensity) q.set('key', s.keyIntensity.toFixed(2));
    if (s.keyTempK !== defaults.keyTempK) q.set('temp', String(Math.round(s.keyTempK)));
    if (s.background !== defaults.background) q.set('bg', s.background);
    // 自動旋轉只有「關掉」值得寫進去：預設就是開著
    if (!s.autoRotate) q.set('spin', '0');
    // 'free' 不寫——它代表使用者拖出來的角度，沒有能還原的座標（見 store 的 CameraView）
    if (s.cameraView !== 'free' && s.cameraView !== defaults.cameraView) q.set('cam', s.cameraView);

    if (s.surfaceSource !== defaults.surfaceSource) q.set('sd', s.surfaceSource);
    if (s.surfaceTiling !== defaults.surfaceTiling) q.set('tile', s.surfaceTiling.toFixed(1));
    if (s.surfaceBump !== defaults.surfaceBump) q.set('bump', s.surfaceBump.toFixed(2));

    return q.toString();
}

/**
 * 從網址讀回設定。讀不到的欄位一律不回傳（呼叫端就會保留預設值），
 * 認不得的值直接忽略——別人手改過的網址不該讓這頁開不起來。
 */
export function readSelection(search: string, validPartIds: string[]): Partial<CfgSelection> {
    const q = new URLSearchParams(search);
    const out: Partial<CfgSelection> = {};

    const partState: Record<string, PartUiState> = {};
    let hasPart = false;
    for (const id of validPartIds) {
        const fin = q.get(`fin.${id}`);
        const tint = q.get(`tint.${id}`);
        if (fin || tint) {
            hasPart = true;
            partState[id] = { finishId: fin ?? 'original', tintId: tint ?? 'none' };
        }
    }
    if (hasPart) out.partState = partState;

    const cw = q.get('cw');
    if (cw) out.variant = cw;
    const lp = q.get('lp');
    if (lp) out.lightingPreset = lp;

    const num = (key: string, range: readonly [number, number]): number | undefined => {
        const raw = q.get(key);
        if (raw === null) return undefined;
        const v = parseFloat(raw);
        return Number.isFinite(v) ? clamp(v, range) : undefined;
    };
    const env = num('env', NUM_RANGE.env);
    if (env !== undefined) out.envIntensity = env;
    const rot = num('rot', NUM_RANGE.rot);
    if (rot !== undefined) out.envRotationDeg = rot;
    const key = num('key', NUM_RANGE.key);
    if (key !== undefined) out.keyIntensity = key;
    const temp = num('temp', NUM_RANGE.temp);
    if (temp !== undefined) out.keyTempK = temp;

    const bg = q.get('bg');
    if (bg && (BACKGROUNDS as string[]).includes(bg)) out.background = bg as BackgroundMode;
    if (q.get('spin') === '0') out.autoRotate = false;

    const cam = q.get('cam');
    if (cam && CAMERA_VIEWS.includes(cam)) out.cameraView = cam as CfgSelection['cameraView'];

    const sd = q.get('sd');
    if (sd === 'shader' || sd === 'texture') out.surfaceSource = sd;
    const tile = num('tile', NUM_RANGE.tile);
    if (tile !== undefined) out.surfaceTiling = tile;
    const bump = num('bump', NUM_RANGE.bump);
    if (bump !== undefined) out.surfaceBump = bump;

    return out;
}

/** 目前設定的完整分享網址 */
export function shareUrl(query: string): string {
    const { origin, pathname } = window.location;
    return query ? `${origin}${pathname}?${query}` : `${origin}${pathname}`;
}

/**
 * 把設定同步回網址列，用 replaceState——每拖一下滑桿就 pushState 的話，
 * 使用者按上一頁要按三十次才回得去上一頁。
 */
export function syncUrl(query: string): void {
    const { pathname, hash } = window.location;
    window.history.replaceState(null, '', query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`);
}

/** 複製到剪貼簿。HTTPS 以外的環境沒有 navigator.clipboard，退回 textarea + execCommand。 */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}
