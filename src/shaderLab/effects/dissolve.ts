import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';
import { hexToRgb, type EffectDef, type ParamValues } from './types';

/**
 * Dissolve —— 程序化 noise 溶解，帶灼燒邊緣。
 *
 * 遊戲裡最常見的出場 / 死亡特效。刻意不用 noise 貼圖，改在 shader 裡用 hash + fbm
 * 即時算出來：省一張貼圖與一次取樣，代價是多幾十道 ALU 指令——在現代 GPU 上這是划算的交易。
 *
 * 三個坑：
 *
 * 1. **premultiplied alpha**：Pixi 的 filter 輸入輸出都是預乘的。要改顏色就得先除回去、
 *    算完再乘回來，否則半透明邊緣會出現一圈髒黑邊。
 *
 * 2. **GLSL 與 WGSL 的 noise 必須算出同一個值**，否則兩個 backend 的溶解圖案會不一樣。
 *    hash 用的常數 (127.1, 311.7, 43758.5453) 兩邊必須一模一樣。
 *
 * 3. **WGSL 的 mainVertex 參數，最後一定要有尾逗號**（實際踩到才發現的）。
 *    Pixi v8 是用 regex 解析 WGSL 的 vertex attribute：
 *      @location\((\d+)\)\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_<>]+)(?:,|\s|$)
 *    結尾那組要求型別後面接「逗號 / 空白 / 字串結尾」。若把參數擠成單行，型別後面會是右括號，
 *    三個條件都不符 → attribute 解析成空物件 → pipeline 的 VertexState 缺 slot 0 →
 *    render pipeline 靜默失效、畫面全白。
 *    最惡劣的是它只在 console 丟 warning、不丟 error，所以你會盯著一張白畫面完全不知道發生什麼事。
 */

// WebGL：GLSL 300 es（Pixi v8 的 filter 走 WebGL2）
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uProgress;
uniform float uEdgeWidth;
uniform float uNoiseScale;
uniform vec3 uEdgeColor;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep 內插，避免格線感
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

// fbm：疊 4 個八度，讓溶解邊界有大塊也有細節
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec4 color = texture(uTexture, vTextureCoord);
    float n = fbm(vTextureCoord * uNoiseScale);

    // n 低於 progress 的地方被吃掉；smoothstep 讓邊界有一點柔化，不會鋸齒
    float alpha = smoothstep(uProgress, uProgress + 0.02, n);
    // 剛好在消失邊緣的那一圈 → 發光
    float glow = (1.0 - smoothstep(uProgress, uProgress + uEdgeWidth, n)) * alpha;

    vec3 rgb = color.rgb;
    if (color.a > 0.0) rgb /= color.a;       // 解除預乘
    rgb = mix(rgb, uEdgeColor, glow);

    float outAlpha = color.a * alpha;
    finalColor = vec4(rgb * outAlpha, outAlpha); // 重新預乘
}
`;

// WebGPU：WGSL。vertex 得自己寫——Pixi 沒有給 WGSL 的預設 filter vertex。
const source = /* wgsl */ `
struct GlobalFilterUniforms {
    uInputSize: vec4<f32>,
    uInputPixel: vec4<f32>,
    uInputClamp: vec4<f32>,
    uOutputFrame: vec4<f32>,
    uGlobalFrame: vec4<f32>,
    uOutputTexture: vec4<f32>,
};

struct DissolveUniforms {
    uProgress: f32,
    uEdgeWidth: f32,
    uNoiseScale: f32,
    uEdgeColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> dissolve: DissolveUniforms;

struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
    var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
    position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
    return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

// 參數後面那個尾逗號是必要的 —— 原因見本檔頂部的註解「坑 3」。刪掉它，畫面會全白。
@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
) -> VSOutput {
    return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

// 以下三個函式必須跟 GLSL 版算出完全相同的值，否則兩個 backend 的溶解圖案會長得不一樣
fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn valueNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}

fn fbm(p0: vec2<f32>) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var p = p0;
    for (var i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var color = textureSample(uTexture, uSampler, uv);
    let n = fbm(uv * dissolve.uNoiseScale);

    let alpha = smoothstep(dissolve.uProgress, dissolve.uProgress + 0.02, n);
    let glow = (1.0 - smoothstep(dissolve.uProgress, dissolve.uProgress + dissolve.uEdgeWidth, n)) * alpha;

    var rgb = color.rgb;
    if (color.a > 0.0) { rgb /= color.a; }
    rgb = mix(rgb, dissolve.uEdgeColor, glow);

    let outAlpha = color.a * alpha;
    return vec4<f32>(rgb * outAlpha, outAlpha);
}
`;

export function createDissolveFilter(): Filter {
    return new Filter({
        glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'dissolve-filter' }),
        gpuProgram: GpuProgram.from({
            vertex: { source, entryPoint: 'mainVertex' },
            fragment: { source, entryPoint: 'mainFragment' },
        }),
        resources: {
            dissolve: new UniformGroup({
                uProgress: { value: 0.35, type: 'f32' },
                uEdgeWidth: { value: 0.08, type: 'f32' },
                uNoiseScale: { value: 6, type: 'f32' },
                uEdgeColor: { value: new Float32Array([1.0, 0.45, 0.1]), type: 'vec3<f32>' },
            }),
        },
    });
}

export const dissolveEffect: EffectDef = {
    id: 'dissolve',
    i18nKey: 'shader.dissolve',
    params: [
        { kind: 'range', key: 'uProgress', labelKey: 'shader.param.progress', min: 0, max: 1, step: 0.01, default: 0.35 },
        { kind: 'range', key: 'uEdgeWidth', labelKey: 'shader.param.edgeWidth', min: 0.01, max: 0.3, step: 0.01, default: 0.08 },
        { kind: 'range', key: 'uNoiseScale', labelKey: 'shader.param.noiseScale', min: 1, max: 24, step: 0.5, default: 6 },
        { kind: 'color', key: 'uEdgeColor', labelKey: 'shader.param.edgeColor', default: '#ff7319' },
    ],
    sources: { glsl: fragment, wgsl: source },
    // fbm 的值域約 0～0.94、且集中在中段：progress 超過 0.75 幾乎整隻都被吃光，
    // 低於 0.05 又完全看不出在溶解。擺盪只在真正有戲的那一段來回。
    animate: { key: 'uProgress', cycleSeconds: 5.2, min: 0.05, max: 0.75 },
    create: createDissolveFilter,
    apply: (filter: Filter, values: ParamValues) => {
        const u = (filter.resources.dissolve as UniformGroup).uniforms as Record<string, unknown>;
        for (const [k, v] of Object.entries(values)) {
            if (!(k in u)) continue;
            if (typeof v === 'string') {
                // vec3 uniform：就地改寫既有的 Float32Array，不要換掉整個 buffer
                (u[k] as Float32Array).set(hexToRgb(v));
            } else {
                u[k] = v;
            }
        }
    },
};
