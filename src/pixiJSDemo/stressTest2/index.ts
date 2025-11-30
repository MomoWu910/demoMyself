import { Application, Geometry, Shader, Mesh, State, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';
import Stats from 'stats.js';
import GUI from 'lil-gui';
import { showGameInfosPannel } from '../../tools';

(async () => {
    // 1. 初始化
    const urlParams = new URLSearchParams(window.location.search);
    const targetRenderer = urlParams.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
    console.log(`Requested renderer: ${targetRenderer}`);

    const app = new Application();
    await app.init({ 
        background: '#000000', 
        resizeTo: window, 
        preference: targetRenderer,
        antialias: false
    });
    document.body.appendChild(app.canvas);

    (globalThis as any).__PIXI_APP__ = app;
    showGameInfosPannel(app, ['fps']);

    const stats = new Stats();
    document.body.appendChild(stats.dom);

    // 2. 參數
    const params = {
        count: 100000, 
        renderer: targetRenderer,
        actualRenderer: app.renderer.name,
    };

    // 3. 幾何資料
    const geometry = new Geometry({ topology: 'triangle-list' });
    
    const updateGeometry = () => {
        const particleCount = params.count;
        const totalVertices = particleCount * 4;
        const totalIndices = particleCount * 6;

        const positions = new Float32Array(totalVertices * 2);
        const randoms = new Float32Array(totalVertices * 2);
        const colors = new Float32Array(totalVertices * 3);
        const offsets = new Float32Array(totalVertices * 2);
        const indices = new Uint32Array(totalIndices);

        for (let i = 0; i < particleCount; i++) {
            const px = (Math.random() * 2 - 1) * 800;
            const py = (Math.random() * 2 - 1) * 800;
            const rx = (Math.random() * 2 - 1);
            const ry = (Math.random() * 2 - 1);
            const r = 0.2 + Math.random() * 0.8;
            const g = 0.5 + Math.random() * 0.5;
            const b = 1.0;

            const i4 = i * 4;
            const i6 = i * 6;

            for (let j = 0; j < 4; j++) {
                positions[(i4 + j) * 2] = px;
                positions[(i4 + j) * 2 + 1] = py;
                randoms[(i4 + j) * 2] = rx;
                randoms[(i4 + j) * 2 + 1] = ry;
                colors[(i4 + j) * 3] = r;
                colors[(i4 + j) * 3 + 1] = g;
                colors[(i4 + j) * 3 + 2] = b;
            }

            // Quad Offsets
            offsets[(i4 + 0) * 2] = -1; offsets[(i4 + 0) * 2 + 1] = -1;
            offsets[(i4 + 1) * 2] =  1; offsets[(i4 + 1) * 2 + 1] = -1;
            offsets[(i4 + 2) * 2] =  1; offsets[(i4 + 2) * 2 + 1] =  1;
            offsets[(i4 + 3) * 2] = -1; offsets[(i4 + 3) * 2 + 1] =  1;

            indices[i6 + 0] = i4 + 0;
            indices[i6 + 1] = i4 + 1;
            indices[i6 + 2] = i4 + 2;
            indices[i6 + 3] = i4 + 0;
            indices[i6 + 4] = i4 + 2;
            indices[i6 + 5] = i4 + 3;
        }

        geometry.addAttribute('aVertexPosition', { buffer: positions, format: 'float32x2' });
        geometry.addAttribute('aRandom', { buffer: randoms, format: 'float32x2' });
        geometry.addAttribute('aColor', { buffer: colors, format: 'float32x3' });
        geometry.addAttribute('aOffset', { buffer: offsets, format: 'float32x2' });
        geometry.addIndex(indices);
    };

    updateGeometry();

    // 4. WGSL (注意 Group 順序)
    const gpuVert = `
        struct GlobalUniforms {
            uProjectionMatrix : mat3x3<f32>,
            uWorldTransformMatrix : mat3x3<f32>,
            uWorldColorAlpha : vec4<f32>,
            uResolution : vec2<f32>,
        }
        struct LocalUniforms {
            uWorldTransformMatrix : mat3x3<f32>,
            uWorldColorAlpha : vec4<f32>,
        }
        struct MyUniforms {
            uTime : f32,
        }
        struct VSInput {
            @location(0) aVertexPosition : vec2<f32>,
            @location(1) aRandom : vec2<f32>,
            @location(2) aColor : vec3<f32>,
            @location(3) aOffset : vec2<f32>,
        };
        struct VSOutput {
            @builtin(position) position : vec4<f32>,
            @location(0) vColor : vec3<f32>,
        };

        @group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
        @group(1) @binding(0) var<uniform> localUniforms : LocalUniforms; // Group 1 是系統用的
        @group(2) @binding(0) var<uniform> myUniforms : MyUniforms;       // Group 2 是我們自己的

        @vertex
        fn main(input : VSInput) -> VSOutput {
            var output : VSOutput;
            let time = myUniforms.uTime * 2.0;
            let pos = input.aVertexPosition;
            let angle = time * length(input.aRandom) * 0.5;
            let s = sin(angle);
            let c = cos(angle);
            var rotatedPos : vec2<f32>;
            rotatedPos.x = pos.x * c - pos.y * s;
            rotatedPos.y = pos.x * s + pos.y * c;
            let centerPos = rotatedPos + (input.aRandom * time * 50.0);
            let finalPos = centerPos + input.aOffset * 2.0;
            
            let mvp = globalUniforms.uProjectionMatrix * localUniforms.uWorldTransformMatrix * vec3<f32>(finalPos, 1.0);
            output.position = vec4<f32>(mvp.xy, 0.0, 1.0);
            output.vColor = input.aColor;
            return output;
        }
    `;

    const gpuFrag = `
        @fragment
        fn main(@location(0) vColor : vec3<f32>) -> @location(0) vec4<f32> {
            return vec4<f32>(vColor, 1.0);
        }
    `;

    // 5. 建立 GL Program (Fallback)
    const glVert = `
        in vec2 aVertexPosition;
        in vec2 aRandom;
        in vec3 aColor;
        in vec2 aOffset;
        uniform mat3 uProjectionMatrix;
        uniform mat3 uWorldTransformMatrix;
        uniform float uTime;
        out vec3 vColor;
        void main() {
            float time = uTime * 2.0;
            vec2 pos = aVertexPosition;
            float angle = time * length(aRandom) * 0.5;
            float s = sin(angle);
            float c = cos(angle);
            vec2 rotatedPos;
            rotatedPos.x = pos.x * c - pos.y * s;
            rotatedPos.y = pos.x * s + pos.y * c;
            vec2 centerPos = rotatedPos + (aRandom * time * 50.0);
            vec2 finalPos = centerPos + aOffset * 2.0;
            gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(finalPos, 1.0)).xy, 0.0, 1.0);
            vColor = aColor;
        }
    `;
    const glFrag = `
        in vec3 vColor;
        out vec4 finalColor;
        void main() {
            finalColor = vec4(vColor, 1.0);
        }
    `;

    const glProgram = GlProgram.from({
        vertex: glVert,
        fragment: glFrag,
        name: 'particle-shader-gl'
    });

    const gpuProgram = GpuProgram.from({
        vertex: { source: gpuVert, entryPoint: 'main' },
        fragment: { source: gpuFrag, entryPoint: 'main' },
        layout: [
            { aVertexPosition: 0 },
            { aRandom: 1 },
            { aColor: 2 },
            { aOffset: 3 },
        ],
        name: 'particle-shader-gpu'
    });

    // ==========================================
    // ★ 關鍵修正：資源建立
    // ==========================================

    // 1. 建立我們自己的 Uniform Group
    const myUniforms = new UniformGroup({
        uTime: { value: 0, type: 'f32' }
    });

    // 2. ★ 建立一個「假」的 Local Uniforms
    // 這是為了滿足 BindGroupSystem 的檢查，實際上渲染時會被 Mesh 系統覆蓋
    const dummyLocalUniforms = new UniformGroup({
        uWorldTransformMatrix: { value: new Float32Array(9), type: 'mat3x3<f32>' },
        uWorldColorAlpha: { value: new Float32Array(4), type: 'vec4<f32>' },
    });

    const shader = new Shader({
        glProgram,
        gpuProgram,
        resources: {
            myUniforms: myUniforms,
            // ★ 放入這裡騙過檢查
            localUniforms: dummyLocalUniforms 
        }
    });

    const mesh = new Mesh({
        geometry: geometry,
        shader: shader,
        state: State.for2d(),
    });
    
    mesh.position.set(app.screen.width / 2, app.screen.height / 2);
    app.stage.addChild(mesh);

    // Ticker
    let time = 0;
    app.ticker.add((ticker) => {
        stats.begin();
        time += ticker.deltaTime * 0.01;
        
        // 更新數據
        myUniforms.uniforms.uTime = time;

        stats.end();
    });

    // GUI ... (維持不變)
    const gui = new GUI({ title: 'GPU Particles' });
    gui.add(params, 'count').disable().name('Particles: 100k');
    gui.add(params, 'actualRenderer').disable();
    gui.add(params, 'renderer', ['webgpu', 'webgl']).onChange((v: string) => {
        const url = new URL(window.location.href);
        url.searchParams.set('renderer', v);
        window.location.href = url.toString();
    });
    
    const backBtn = document.createElement('a');
    backBtn.innerText = '← Back';
    backBtn.href = './pixi_hub.html';
    Object.assign(backBtn.style, { position: 'absolute', top: '55px', left: '20px', color: 'white', background: 'rgba(0,0,0,0.5)', padding: '5px' });
    document.body.appendChild(backBtn);
})();