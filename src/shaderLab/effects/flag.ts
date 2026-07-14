import { GlProgram, GpuProgram, Mesh, PlaneGeometry, Shader, Texture, UniformGroup } from 'pixi.js';
import type { EffectDef, EffectInstance, ParamValues } from './types';

/**
 * Waving Flag —— 這一個不是 filter，shader 就是這面旗子的**材質本身**。
 *
 * 前兩個效果都在 fragment 階段做文章：它們拿到一張「已經畫好的」畫面，再逐像素改寫。
 * 這一個相反——**幾何是在 vertex shader 裡被扭曲的**。一張 48×16 細分的 plane，
 * 每個頂點依自己的 UV 算出正弦波位移；GPU 一次處理幾百個頂點，而不是幾十萬個像素。
 *
 * 為什麼這件事值得做：
 *
 * - **它證明 shader 不只是 fragment**。旗子的飄動、草的擺動、水面的起伏、角色的呼吸，
 *   這些在真實產品裡都該在 vertex 做——頂點數遠少於像素數，這是最便宜的一階動畫。
 * - **它是「寫進 mesh 材質」的實例**，也就是前兩張成本卡一直在講的那個替代方案：
 *   沒有額外的 render pass、沒有暫存貼圖、不會把物件踢出合批。代價是它讀不到自己以外的
 *   像素——所以水波那種 gather 效果就做不到。這個取捨是這整個 Lab 想講的核心。
 *
 * 明暗不是打光，是**波的斜率**：對位移函數取對 u 的導數，斜率大的地方視為背光而壓暗。
 * 一行 cos 就換到立體感，這是很典型的「用數學假裝物理」。
 *
 * Pixi v8 自訂 mesh shader 的接線（這塊網路上幾乎查不到，是讀 Pixi 原始碼挖出來的）：
 *
 * - **WebGL**：`GlMeshAdaptor` 會把 `groups[100]` 設成 global uniforms、`groups[101]` 設成
 *   local uniforms。GLSL 端直接宣告 `uniform mat3 uProjectionMatrix / uWorldTransformMatrix /
 *   uTransformMatrix` 就會被餵值（是普通 uniform，不是 UBO）。
 * - **WebGPU**：Pixi 靠 `layout[0].globalUniforms` 與 `layout[1].localUniforms` **這兩個名字**
 *   存不存在，來決定要不要自動綁定那兩個 bind group。所以 group 0 / group 1 的變數名稱
 *   一個字都不能改，自訂的貼圖與 uniform 只能從 group 2 開始擺。
 */

const vertexGl = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;

out vec2 vUV;
out float vShade;

// 由 Pixi 自動餵值：global（groups[100]）與 local（groups[101]）
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uSpeed;
uniform float uShading;

void main() {
    // 旗杆在左邊：振幅隨著離旗杆的距離線性增加，靠杆的一側幾乎不動
    float grip = aUV.x;
    float phase = aUV.x * uFrequency - uTime * uSpeed;

    vec2 pos = aPosition;
    pos.y += sin(phase) * uAmplitude * grip;

    // 明暗 = 波的斜率（對 u 的導數）。面朝我們的地方亮、側過去的地方暗——
    // 沒有光源、沒有法線，一行 cos 就換到立體感。
    // 注意這裡刻意「不」乘上振幅與頻率：斜率的真實量級是 amp * freq * grip，
    // 拿它直接當明暗會在大振幅下整片飽和，只剩一半亮一半暗的硬邊。
    // 明暗要的是波的「相位」，不是它的絕對陡度。
    float slope = cos(phase) * grip;
    vShade = clamp(1.0 + slope * uShading * 0.3, 0.55, 1.45);

    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(pos, 1.0)).xy, 0.0, 1.0);

    vUV = aUV;
}
`;

const fragmentGl = /* glsl */ `
in vec2 vUV;
in float vShade;

out vec4 finalColor;

uniform sampler2D uTexture;

void main() {
    vec4 color = texture(uTexture, vUV);
    // 貼圖是預乘的：rgb 與 a 一起縮放才不會破壞預乘關係，所以只乘 rgb 是安全的
    finalColor = vec4(color.rgb * vShade, color.a);
}
`;

// 面板的 GLSL 分頁要同時看到 vertex 與 fragment——這個效果的重點就在 vertex
const glsl = `// ---- vertex ----\n${vertexGl.trim()}\n\n// ---- fragment ----\n${fragmentGl.trim()}\n`;

const wgsl = /* wgsl */ `
// group 0 / group 1 的名字是 Pixi 的約定：它靠 layout[0].globalUniforms 與
// layout[1].localUniforms 存不存在，來決定要不要自動綁定。改名字就沒人餵值了。
struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
};

struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
};

struct FlagUniforms {
    uTime: f32,
    uAmplitude: f32,
    uFrequency: f32,
    uSpeed: f32,
    uShading: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(3) @binding(0) var<uniform> flag: FlagUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) shade: f32,
};

// 參數後面的尾逗號是必要的——Pixi v8 用 regex 解析 vertex attribute，少了它
// attribute 會解析成空物件，pipeline 靜默失效、畫面全白。
@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
) -> VSOutput {
    let grip = aUV.x;
    let phase = aUV.x * flag.uFrequency - flag.uTime * flag.uSpeed;

    var pos = aPosition;
    pos.y += sin(phase) * flag.uAmplitude * grip;

    let slope = cos(phase) * grip;
    let shade = clamp(1.0 + slope * flag.uShading * 0.3, 0.55, 1.45);

    let mvp = globalUniforms.uProjectionMatrix
        * globalUniforms.uWorldTransformMatrix
        * localUniforms.uTransformMatrix;

    let clip = vec4<f32>((mvp * vec3<f32>(pos, 1.0)).xy, 0.0, 1.0);

    return VSOutput(clip, aUV, shade);
}

@fragment
fn mainFragment(
    @location(0) uv: vec2<f32>,
    @location(1) shade: f32,
) -> @location(0) vec4<f32> {
    let color = textureSample(uTexture, uSampler, uv);
    return vec4<f32>(color.rgb * shade, color.a);
}
`;

const FLAG_WIDTH = 420;
const FLAG_HEIGHT = 280;

/**
 * 旗面是畫出來的，不是拿主體貼圖去湊。
 *
 * 這是為了「看得見」：vertex 位移必須有**直線**才顯形——直線彎成波浪，一眼就知道
 * 幾何被扭曲了。拿一張圓形貼圖當旗面，波動會被輪廓吃掉，看起來只像圖片在晃。
 * 柴犬留在中央當隊徽，跟站上其他 demo 呼應。
 */
function makeFlagTexture(emblem: Texture): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = FLAG_WIDTH;
    canvas.height = FLAG_HEIGHT;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    const bg = ctx.createLinearGradient(0, 0, FLAG_WIDTH, FLAG_HEIGHT);
    bg.addColorStop(0, '#0b3d54');
    bg.addColorStop(1, '#0f5e73');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FLAG_WIDTH, FLAG_HEIGHT);

    // 格線：波一來，這些直線就會彎
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
    ctx.lineWidth = 1;
    const step = 28;
    ctx.beginPath();
    for (let x = step; x < FLAG_WIDTH; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, FLAG_HEIGHT);
    }
    for (let y = step; y < FLAG_HEIGHT; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(FLAG_WIDTH, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 210, 255, 0.75)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, FLAG_WIDTH - 3, FLAG_HEIGHT - 3);

    // 隊徽（Assets 載進來的來源可能是 ImageBitmap 或 HTMLImageElement，兩者都能 drawImage）
    const src = (emblem.source as any).resource;
    if (src && (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap || src instanceof HTMLImageElement || src instanceof HTMLCanvasElement)) {
        const size = 150;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(src, (FLAG_WIDTH - size) / 2, (FLAG_HEIGHT - size) / 2 - 14, size, size);
        ctx.globalAlpha = 1;
    }

    ctx.font = 'bold 22px "SF Mono", ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(226, 250, 255, 0.92)';
    ctx.textAlign = 'center';
    ctx.fillText('GLSL ⇄ WGSL', FLAG_WIDTH / 2, FLAG_HEIGHT - 34);

    return Texture.from(canvas);
}

export const flagEffect: EffectDef = {
    id: 'flag',
    i18nKey: 'shader.flag',
    technique: 'mesh',
    params: [
        { kind: 'range', key: 'uAmplitude', labelKey: 'shader.param.flagAmp', min: 0, max: 60, step: 1, default: 26 },
        { kind: 'range', key: 'uFrequency', labelKey: 'shader.param.flagFreq', min: 1, max: 20, step: 0.5, default: 7 },
        { kind: 'range', key: 'uSpeed', labelKey: 'shader.param.speed', min: 0, max: 8, step: 0.1, default: 3 },
        { kind: 'range', key: 'uShading', labelKey: 'shader.param.shading', min: 0, max: 3, step: 0.05, default: 1 },
    ],
    sources: { glsl, wgsl },
    create: (texture): EffectInstance => {
        const flagTexture = makeFlagTexture(texture);

        // 細分要夠密，波才會平滑——這是 vertex 動畫真正的成本所在（頂點數），
        // 但 48×16 也才 768 個頂點，跟一張 sprite 的像素數比起來是零頭
        const geometry = new PlaneGeometry({
            width: FLAG_WIDTH,
            height: FLAG_HEIGHT,
            verticesX: 48,
            verticesY: 16,
        });

        const uniforms = new UniformGroup({
            uTime: { value: 0, type: 'f32' },
            uAmplitude: { value: 26, type: 'f32' },
            uFrequency: { value: 7, type: 'f32' },
            uSpeed: { value: 3, type: 'f32' },
            uShading: { value: 1, type: 'f32' },
        });

        const shader = new Shader({
            glProgram: GlProgram.from({ vertex: vertexGl, fragment: fragmentGl, name: 'flag-mesh' }),
            gpuProgram: GpuProgram.from({
                vertex: { source: wgsl, entryPoint: 'mainVertex' },
                fragment: { source: wgsl, entryPoint: 'mainFragment' },
            }),
            resources: {
                uTexture: flagTexture.source,
                uSampler: flagTexture.source.style,
                flag: uniforms,
            },
        });

        const mesh = new Mesh({ geometry, shader });
        // PlaneGeometry 的原點在左上角，把它挪到中心，舞台才好統一置中
        mesh.pivot.set(FLAG_WIDTH / 2, FLAG_HEIGHT / 2);

        const u = uniforms.uniforms as Record<string, number>;

        return {
            view: mesh,
            apply: (values: ParamValues) => {
                for (const [k, v] of Object.entries(values)) {
                    if (k in u && typeof v === 'number') u[k] = v;
                }
            },
            tick: (elapsed: number) => {
                u.uTime = elapsed;
            },
        };
    },
};
