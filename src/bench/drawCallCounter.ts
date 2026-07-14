/**
 * Draw call 計數：包住 WebGL context 的繪製指令來計數。
 *
 * 只在 WebGL 下有效。WebGPU 的繪製指令錄在 GPURenderPassEncoder 上、由瀏覽器實作，
 * 沒有等價的攔截點——這是量測上的真實限制，報表會誠實標成 n/a，而不是填 0 混過去。
 */
export class DrawCallCounter {
    private count = 0;
    readonly supported: boolean;

    constructor(app: any) {
        const gl = app?.renderer?.gl;
        this.supported = !!gl;
        if (!gl) return;

        const hook = (obj: any, name: string) => {
            if (typeof obj[name] !== 'function') return;
            const original = obj[name].bind(obj);
            obj[name] = (...args: any[]) => {
                this.count++;
                return original(...args);
            };
        };

        hook(gl, 'drawElements');
        hook(gl, 'drawArrays');
        hook(gl, 'drawElementsInstanced');
        hook(gl, 'drawArraysInstanced');

        // WebGL 1 的實例化繪製藏在擴充套件裡
        const ext = gl.getExtension('ANGLE_instanced_arrays');
        if (ext) {
            hook(ext, 'drawElementsInstancedANGLE');
            hook(ext, 'drawArraysInstancedANGLE');
        }
    }

    reset(): void {
        this.count = 0;
    }

    get value(): number {
        return this.count;
    }
}
