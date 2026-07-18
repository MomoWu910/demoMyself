import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';

/**
 * 首頁的 signature：一面流動的雙色 shader 光場。
 *
 * 沿用 Shader Lab 那套「同時手寫 GLSL 與 WGSL」的自訂 filter 寫法（見 shaderLab/effects）。
 * domain-warped fbm 做出有機的流動，一條低頻的相位讓整面在**琥珀（GLSL/WebGL）↔ 紫（WGSL/WebGPU）**
 * 之間緩慢呼吸——這個作品集的識別就是「同一件事做兩遍」，連背景都在講這件事。
 *
 * 刻意壓得很暗、對比很低：它是背景，不能蓋過節點與文字，所以只在 ink 底色上疊薄薄一層 tone，
 * 再加暈影把邊角壓下去。
 */

// WebGL：GLSL 300 es
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform float uTime;
uniform float uAspect;
uniform vec3 uInk;
uniform vec3 uAmber;
uniform vec3 uViolet;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * vnoise(p);
        p = p * 2.0 + vec2(11.3, 7.7);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = vTextureCoord;
    uv.x *= uAspect;
    float t = uTime * 0.03;

    // domain warp：讓流動有機、不像規則的等高線
    vec2 q = vec2(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t + vec2(5.2, 1.3)));
    float f = fbm(uv * 3.0 + q * 1.5 + t);

    // 低頻相位：整面在琥珀↔紫之間呼吸。中點往琥珀偏，兩色才平衡（原本偏紫）
    float toneMix = 0.38 + 0.46 * sin(uv.x * 1.1 - uv.y * 0.8 + uTime * 0.12);
    toneMix = clamp(toneMix, 0.0, 1.0);
    vec3 tone = mix(uAmber, uViolet, toneMix);
    // 琥珀在暗底上的視覺份量比紫弱，補一點亮度讓它站得住
    tone *= mix(1.3, 1.0, toneMix);

    vec3 col = uInk;
    col += tone * smoothstep(0.35, 0.92, f) * 0.15;          // 主體薄霧
    float ridge = smoothstep(0.55, 0.61, f) - smoothstep(0.61, 0.7, f);
    col += tone * ridge * 0.10;                               // 脊線上的細絲高光

    // 暈影：邊角壓暗，中央讓內容站得住
    vec2 c = vTextureCoord - 0.5;
    float vig = clamp(1.0 - dot(c, c) * 1.15, 0.0, 1.0);
    col *= mix(0.68, 1.0, vig);

    finalColor = vec4(col, 1.0);
}
`;

// WebGPU：WGSL。filter 的 group(0) 佈局要跟 Pixi 對得上（見 shaderLab dissolve 的註解）。
const source = /* wgsl */ `
struct GlobalFilterUniforms {
    uInputSize: vec4<f32>,
    uInputPixel: vec4<f32>,
    uInputClamp: vec4<f32>,
    uOutputFrame: vec4<f32>,
    uGlobalFrame: vec4<f32>,
    uOutputTexture: vec4<f32>,
};

struct FieldUniforms {
    uTime: f32,
    uAspect: f32,
    uInk: vec3<f32>,
    uAmber: vec3<f32>,
    uViolet: vec3<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> field: FieldUniforms;

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

// 尾逗號是必要的（Pixi v8 用 regex 解析 vertex attribute）——見 shaderLab dissolve 坑 3
@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
) -> VSOutput {
    return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
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
    for (var i = 0; i < 5; i++) {
        v += a * vnoise(p);
        p = p * 2.0 + vec2<f32>(11.3, 7.7);
        a *= 0.5;
    }
    return v;
}

@fragment
fn mainFragment(@location(0) uv0: vec2<f32>) -> @location(0) vec4<f32> {
    var uv = uv0;
    uv.x = uv.x * field.uAspect;
    let t = field.uTime * 0.03;

    let q = vec2<f32>(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t + vec2<f32>(5.2, 1.3)));
    let f = fbm(uv * 3.0 + q * 1.5 + t);

    var toneMix = 0.38 + 0.46 * sin(uv.x * 1.1 - uv.y * 0.8 + field.uTime * 0.12);
    toneMix = clamp(toneMix, 0.0, 1.0);
    var tone = mix(field.uAmber, field.uViolet, toneMix);
    tone = tone * mix(1.3, 1.0, toneMix); // 琥珀在暗底上補一點亮度，兩色才平衡

    var col = field.uInk;
    col += tone * smoothstep(0.35, 0.92, f) * 0.15;
    let ridge = smoothstep(0.55, 0.61, f) - smoothstep(0.61, 0.7, f);
    col += tone * ridge * 0.10;

    let c = uv0 - 0.5;
    let vig = clamp(1.0 - dot(c, c) * 1.15, 0.0, 1.0);
    col = col * mix(0.68, 1.0, vig);

    return vec4<f32>(col, 1.0);
}
`;

export interface FieldFilter {
    filter: Filter;
    setTime: (seconds: number) => void;
    setAspect: (aspect: number) => void;
}

export function createFieldFilter(): FieldFilter {
    const uniforms = new UniformGroup({
        uTime: { value: 0, type: 'f32' },
        uAspect: { value: 1, type: 'f32' },
        uInk: { value: new Float32Array([0.043, 0.047, 0.063]), type: 'vec3<f32>' },
        uAmber: { value: new Float32Array([1.0, 0.541, 0.239]), type: 'vec3<f32>' },
        uViolet: { value: new Float32Array([0.71, 0.482, 1.0]), type: 'vec3<f32>' },
    });

    const filter = new Filter({
        glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'home-field' }),
        gpuProgram: GpuProgram.from({
            vertex: { source, entryPoint: 'mainVertex' },
            fragment: { source, entryPoint: 'mainFragment' },
        }),
        resources: { field: uniforms },
        // 半解析度渲染：這面光場很柔、看不出差，但每像素十幾次 noise 的 fragment 成本直接砍 4 倍，
        // 是這個全螢幕 shader 最省電的一刀。
        resolution: 0.5,
    });

    const u = uniforms.uniforms as { uTime: number; uAspect: number };
    return {
        filter,
        setTime: (s) => (u.uTime = s),
        setAspect: (a) => (u.uAspect = a),
    };
}
