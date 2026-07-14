import type { BenchEnv, Stat } from './types';

/** 從樣本算統計量。輸入會被排序，故傳入前請自行複製。 */
export function summarize(samples: number[]): Stat {
    const s = [...samples].sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return {
        median: round(at(0.5)),
        p95: round(at(0.95)),
        mean: round(mean),
        min: round(s[0]),
        max: round(s[s.length - 1]),
    };
}

export function round(n: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

/** 中位數（給 draw call 這種整數用） */
export function median(samples: number[]): number {
    const s = [...samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

/**
 * 問出 GPU 型號。UNMASKED_RENDERER_WEBGL 需要 WEBGL_debug_renderer_info 擴充；
 * 部分瀏覽器（隱私考量）會拒絕提供，此時退回 RENDERER 的通用字串。
 */
function detectGpu(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
        if (!gl) return 'unknown';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = ext
            ? gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL)
            : gl.getParameter(gl.RENDERER);
        return String(name || 'unknown');
    } catch {
        return 'unknown';
    }
}

/** 以連續 rAF 間隔的中位數推算螢幕更新率（60 / 120Hz…） */
export function measureRefreshHz(frames = 30): Promise<number> {
    return new Promise((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        const tick = () => {
            const now = performance.now();
            deltas.push(now - last);
            last = now;
            if (deltas.length >= frames) {
                resolve(Math.round(1000 / median(deltas)));
                return;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

export async function collectEnv(app: any): Promise<BenchEnv> {
    // Pixi v8：WebGL renderer 有 .gl，WebGPU renderer 沒有
    const rendererType = app?.renderer?.gl ? 'webgl' : 'webgpu';
    return {
        renderer: rendererType,
        gpu: detectGpu(),
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
        refreshHz: await measureRefreshHz(),
        timestamp: new Date().toISOString(),
    };
}
