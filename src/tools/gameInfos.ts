let drawCalls: number;
let fps: number;
let nodeCount: number;

function catchDraws(app: any) {
    let i = 0;
    
    // 檢查是否存在 WebGL context。PixiJS v8 支援 WebGPU，如果是 WebGPU 模式，這裡的 gl 會是 null。
    // 目前這個方法只針對 WebGL 進行 Draw Call 統計。
    if (!app.renderer.gl) {
        console.warn('WebGL context not found. Draw calls might not be accurate if using WebGPU.');
        return;
    }

    // 攔截 (Wrap) Pixi 的 render 函式。
    // 這是為了確保我們在每一幀開始渲染前將計數器 (i) 歸零，
    // 並在渲染結束後將統計結果存入 drawCalls 變數。
    const originalRender = app.renderer.render;
    app.renderer.render = (...args: any[]) => {
        i = 0;
        const result = originalRender.apply(app.renderer, args);
        drawCalls = i;
        return result;
    };

    const gl = app.renderer.gl;
    
    // 定義一個 hook 函式，用來攔截 WebGL 的繪製指令。
    // 當 WebGL 執行繪製指令時，我們將計數器 +1，然後執行原本的指令。
    const hook = (obj: any, name: string) => {
        if (obj[name]) {
            const original = obj[name].bind(obj);
            obj[name] = (...args: any[]) => {
                i++;
                return original(...args);
            };
        }
    };

    // 攔截常見的 WebGL 繪製指令：
    // drawElements: 使用索引緩衝區進行繪製 (最常用)
    // drawArrays: 使用頂點陣列進行繪製
    // drawElementsInstanced / drawArraysInstanced: 實例化繪製 (Instanced Rendering)，用於大量相同物件優化
    hook(gl, 'drawElements');
    hook(gl, 'drawArrays');
    hook(gl, 'drawElementsInstanced');
    hook(gl, 'drawArraysInstanced');
    
    // 如果是 WebGL 1 環境，實例化繪製可能位於擴充套件 (Extension) 中，
    // 所以也要檢查並攔截 ANGLE_instanced_arrays 擴充的方法。
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (ext) {
        hook(ext, 'drawElementsInstancedANGLE');
        hook(ext, 'drawArraysInstancedANGLE');
    }
}

function catchFPS() {
    let lastTime = performance.now();
    let frame = 0;
    const loop = () => {
        const now = performance.now();
        frame++;
        if (now >= 1000 + lastTime) {
            fps = Math.round((frame * 1000) / (now - lastTime));
            frame = 0;
            lastTime = now;
        }
        requestAnimationFrame(loop);
    };
    loop();
}

function catchNodeCount(app: any) {
    const deepNode = (childrens: any[]) => {
        childrens.forEach((node) => {
            nodeCount++;
            if (node.children && node.children.length > 0) {
                deepNode(node.children);
            }
        });
    };

    setInterval(() => {
        nodeCount = 0;
        deepNode(app.stage.children);
        const nodeCountContainer = document.querySelector('#nodeCount');
        nodeCount && nodeCountContainer && (nodeCountContainer.innerHTML = `nodeCount: ${nodeCount}`);
    }, 1000);
}

function createPannel(targets: any[]) {
    const container = document.createElement('div');
    container.id = 'stats';

    const content = targets.map((target) => `<div id="${target.name}">${target.name}: ${target.value}</div>`).join('');

    container.innerHTML = content;
    document.body.appendChild(container);
}

export function showGameInfosPannel(app: any, enables: any[] = ['fps', 'drawcalls', 'nodeCount']) {
    const configs: any[] = [];

    enables.forEach((enable) => {
        if (typeof enable === 'string') {
            if (enable === 'fps') {
                catchFPS();
            }
            if (enable === 'drawcalls') {
                catchDraws(app);
            }
            if (enable === 'nodeCount') {
                catchNodeCount(app);
            }
            configs.push({
                name: enable,
                value: '',
            });
        }
        if (Object.prototype.toString.call(enable) === '[object Object]') {
            Object.keys(enable).forEach((key) => {
                configs.push({
                    name: key,
                    value: enable[key],
                });
            });
        }
    });

    createPannel(configs);

    const drawCallContainer = document.querySelector('#drawcalls');
    const fpsContainer = document.querySelector('#fps');

    setInterval(() => {
        if (drawCalls !== undefined && drawCallContainer) {
            drawCallContainer.innerHTML = `drawcalls: ${drawCalls}`;
        }
        if (fps !== undefined && fpsContainer) {
            fpsContainer.innerHTML = `fps: ${fps}`;
        }
    }, 200);
}

export function showGameInfos(enables: any[] = ['fps', 'drawcalls', 'nodeCount']) {
    return ({ event }: any) => event.on('created', ({ game }: any) => showGameInfosPannel(game, enables));
}
