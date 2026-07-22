import { Effect, ProceduralTexture, Scene, Texture } from '@babylonjs/core';
import { SURFACE_SHADER } from './surfaceShader';

/**
 * 表面細節（法線 + 粗糙度）的兩種來源，同一組介面。
 *
 * finish preset 本來只調 metallic / roughness / clearCoat 三個純數字，所以「皮革」與
 * 「霧面」的差別只是反光強弱，看不出材質。這裡補上表面起伏——而且刻意做成**兩個
 * 可切換的來源**，因為兩者的取捨正是這頁想講的事：
 *
 * - `shader`：一支 GLSL 現算（見 surfaceShader.ts），下載 0 KB，但真實感不如掃描。
 * - `texture`：ambientCG 的 CC0 掃描貼圖，真實感好，代價是要下載。
 *
 * **兩者都只準備一次，之後每幀成本完全相同**——都只是一次貼圖取樣。所以面板顯示的
 * 對照數字是「下載體積」與「準備耗時」，不是 FPS；量 FPS 會得到兩個一樣的數字，
 * 那不是比較，是誤導。
 */

export type SurfaceSource = 'shader' | 'texture';
type SurfaceKind = 'fabric' | 'leather' | 'metal';

/**
 * finish → 表面材質。沒列到的 finish 就沒有表面細節：
 * `original` 是「還原模型原樣」，加東西就不叫還原；`glossy` 是一層光滑清漆，
 * 本來就該平。硬要每個 finish 都有紋理，反而讓這兩個選項失去意義。
 */
const FINISH_SURFACE: Record<string, SurfaceKind> = {
    matte: 'fabric',
    leather: 'leather',
    metallic: 'metal',
};

/** shader 版的 uKind 編碼，順序與 surfaceShader.ts 的判斷式一致 */
const KIND_INDEX: Record<SurfaceKind, number> = { fabric: 0, leather: 1, metal: 2 };

/** 掃描貼圖：512px CC0（ambientCG，見 res/textures/CREDITS.md） */
const TEXTURE_URLS: Record<SurfaceKind, { normal: string; rough: string }> = {
    fabric: {
        normal: require('../../res/textures/fabric_normal.jpg'),
        rough: require('../../res/textures/fabric_rough.jpg'),
    },
    leather: {
        normal: require('../../res/textures/leather_normal.jpg'),
        rough: require('../../res/textures/leather_rough.jpg'),
    },
    metal: {
        normal: require('../../res/textures/metal_normal.jpg'),
        rough: require('../../res/textures/metal_rough.jpg'),
    },
};

const SIZE = 512;

/** 一組準備好的表面貼圖，附上它的取得成本 */
export interface SurfaceSet {
    normal: Texture;
    rough: Texture;
    /** 下載位元組數。shader 版是 0（GLSL 已經在 bundle 裡，另外用 shaderBytes 表示） */
    bytes: number;
    /** 從開始準備到可用的毫秒數 */
    prepMs: number;
}

/** GLSL 原始碼大小——shader 版不是「零成本」，只是成本不在下載而在 bundle 裡 */
export const SHADER_BYTES = new Blob([SURFACE_SHADER]).size;

/**
 * 兩種來源各自的貼圖快取。
 *
 * 切來切去不該每次重做：掃描貼圖重新下載（雖然有 HTTP 快取，仍要重新解碼上傳），
 * 程序貼圖重新跑一次 shader。快取住之後切換是瞬間的，量到的 prepMs 也才是
 * 「第一次真的花了多久」而不是「快取命中有多快」。
 */
const cache = new Map<string, SurfaceSet>();

export function surfaceKindOf(finishId: string): SurfaceKind | null {
    return FINISH_SURFACE[finishId] ?? null;
}

/** 取得（必要時建立）某個 finish 在某個來源下的表面貼圖；該 finish 沒有表面細節就回 null */
export async function getSurfaceSet(
    scene: Scene,
    finishId: string,
    source: SurfaceSource,
): Promise<SurfaceSet | null> {
    const kind = surfaceKindOf(finishId);
    if (!kind) return null;

    const key = `${source}:${kind}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const t0 = performance.now();
    const set =
        source === 'shader' ? await buildProcedural(scene, kind, t0) : await loadScanned(scene, kind, t0);
    cache.set(key, set);
    return set;
}

/** 跑一次 shader 生成法線與粗糙度；`refreshRate = 0` 是「只算這一次」 */
async function buildProcedural(scene: Scene, kind: SurfaceKind, t0: number): Promise<SurfaceSet> {
    Effect.ShadersStore['cfgSurfacePixelShader'] = SURFACE_SHADER;

    const make = (mode: number) => {
        const t = new ProceduralTexture(`surf_${kind}_${mode}`, SIZE, 'cfgSurface', scene, undefined, true, false);
        t.setFloat('uKind', KIND_INDEX[kind]);
        t.setFloat('uMode', mode);
        t.setFloat('uDensity', kind === 'metal' ? 4.0 : 8.0);
        t.refreshRate = 0;
        return t;
    };

    const normal = make(0);
    const rough = make(1);
    await Promise.all([once(normal), once(rough)]);

    return { normal, rough, bytes: 0, prepMs: performance.now() - t0 };
}

/** 等一張 ProceduralTexture 真的算完（onGenerated 只會在第一次 render 後觸發一次） */
function once(t: ProceduralTexture): Promise<void> {
    return new Promise((resolve) => {
        if (t.isReady()) {
            resolve();
            return;
        }
        t.onGeneratedObservable.addOnce(() => resolve());
    });
}

/**
 * 載入掃描貼圖，並回報**真實傳輸量**。
 *
 * bytes 不寫死常數而是查 Resource Timing，因為寫死的數字會在換素材或改壓縮率之後
 * 悄悄變成謊言——這頁的重點就是那兩個數字，它們必須是量到的。
 */
async function loadScanned(scene: Scene, kind: SurfaceKind, t0: number): Promise<SurfaceSet> {
    const urls = TEXTURE_URLS[kind];
    const normal = new Texture(urls.normal, scene);
    const rough = new Texture(urls.rough, scene);
    await Promise.all([loaded(normal), loaded(rough)]);

    return {
        normal,
        rough,
        bytes: transferred(urls.normal) + transferred(urls.rough),
        prepMs: performance.now() - t0,
    };
}

function loaded(t: Texture): Promise<void> {
    return new Promise((resolve) => {
        if (t.isReady()) {
            resolve();
            return;
        }
        t.onLoadObservable.addOnce(() => resolve());
    });
}

/**
 * 從 Resource Timing 取這個 URL 的傳輸位元組。
 *
 * `encodedBodySize` 是壓縮後的實際下載量；命中瀏覽器快取時 `transferSize` 會是 0，
 * 那不代表這張圖不用下載，所以優先取 encodedBodySize。查不到就退回 0，UI 那邊
 * 會顯示成 `—` 而不是假裝知道。
 */
function transferred(url: string): number {
    const abs = new URL(url, window.location.href).href;
    const entries = performance.getEntriesByName(abs) as PerformanceResourceTiming[];
    const last = entries[entries.length - 1];
    return last ? last.encodedBodySize || last.transferSize || 0 : 0;
}
