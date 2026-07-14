import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';
import { spriteWithFilter, type EffectDef, type ParamValues } from './types';

/**
 * Chromatic Aberration —— 鏡頭色差。
 *
 * 真實鏡頭的玻璃對不同波長的光折射率不同，紅光與藍光沒有精確落在同一點上，
 * 於是畫面邊緣會出現紅／藍分離。**離光軸越遠越明顯**——所以偏移量要隨著離中心的距離增加，
 * 這就是 uFalloff 這個指數在做的事。均勻的整片位移不是色差，那只是印刷沒對準。
 *
 * 做法：同一個座標取樣三次，三次的位置沿著「往中心的方向」各自錯開，
 * 只取其中一個 channel（R 取外推的、G 取原位的、B 取內縮的）。
 *
 * **這裡有一個前三個效果都沒碰到的坑：預乘 alpha 遇上三次獨立取樣。**
 *
 * filter 的輸入是預乘的（rgb 已經乘過 alpha）。三個取樣點落在不同位置，
 * 各自的 alpha 也就不同——如果直接把三個預乘後的 channel 拼起來，
 * 每個 channel 等於被「別人的」alpha 加權過，半透明邊緣會出現顏色偏移與髒邊。
 *
 * 正解是：三個樣本各自先除回自己的 alpha（解除預乘）拿到真實顏色，組合出 rgb 之後，
 * 再用一個統一的 alpha（三者取最大，才不會把邊緣的色散裁掉）重新預乘。
 */

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

// highp 是必要的：Pixi 的預設 filter vertex shader 也宣告了 uInputSize，
// 而 vertex 階段預設 highp、fragment 階段預設 mediump，精度不符會導致 program link 失敗
uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;

uniform float uStrength;  // px
uniform float uFalloff;

void main() {
    vec2 center = (uInputClamp.xy + uInputClamp.zw) * 0.5;

    // 以像素為單位思考，參數的意義才不會隨 sprite 大小漂移
    vec2 dirPx = (vTextureCoord - center) * uInputSize.xy;
    float len = length(dirPx);

    // 離光軸越遠、色散越大——這是色差之所以是色差、而不是「印刷沒對準」的關鍵
    float radius = 0.5 * min(uInputSize.x, uInputSize.y);
    float r = clamp(len / max(radius, 1.0), 0.0, 1.0);

    // normalize(vec2(0)) 是 NaN；正中心那一點要自己擋掉
    vec2 dir = len > 0.001 ? dirPx / len : vec2(0.0);
    vec2 offset = dir * uStrength * pow(r, uFalloff) * uInputSize.zw;

    vec4 cr = texture(uTexture, clamp(vTextureCoord + offset, uInputClamp.xy, uInputClamp.zw));
    vec4 cg = texture(uTexture, vTextureCoord);
    vec4 cb = texture(uTexture, clamp(vTextureCoord - offset, uInputClamp.xy, uInputClamp.zw));

    // 三個樣本各自解除預乘，否則每個 channel 會被「別人的」alpha 加權，邊緣會髒掉
    vec3 rgb = vec3(
        cr.a > 0.0 ? cr.r / cr.a : 0.0,
        cg.a > 0.0 ? cg.g / cg.a : 0.0,
        cb.a > 0.0 ? cb.b / cb.a : 0.0
    );

    // alpha 取三者最大：取小的話會把邊緣散出去的顏色又裁掉，色差就白做了
    float alpha = max(max(cr.a, cg.a), cb.a);

    finalColor = vec4(rgb * alpha, alpha); // 重新預乘
}
`;

const source = /* wgsl */ `
struct GlobalFilterUniforms {
    uInputSize: vec4<f32>,
    uInputPixel: vec4<f32>,
    uInputClamp: vec4<f32>,
    uOutputFrame: vec4<f32>,
    uGlobalFrame: vec4<f32>,
    uOutputTexture: vec4<f32>,
};

struct ChromaUniforms {
    uStrength: f32,
    uFalloff: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> chroma: ChromaUniforms;

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

// 尾逗號是必要的——見 dissolve.ts 的「坑 3」
@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
) -> VSOutput {
    return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let center = (gfu.uInputClamp.xy + gfu.uInputClamp.zw) * 0.5;

    let dirPx = (uv - center) * gfu.uInputSize.xy;
    let len = length(dirPx);

    let radius = 0.5 * min(gfu.uInputSize.x, gfu.uInputSize.y);
    let r = clamp(len / max(radius, 1.0), 0.0, 1.0);

    var dir = vec2<f32>(0.0, 0.0);
    if (len > 0.001) { dir = dirPx / len; }
    let offset = dir * chroma.uStrength * pow(r, chroma.uFalloff) * gfu.uInputSize.zw;

    let cr = textureSample(uTexture, uSampler, clamp(uv + offset, gfu.uInputClamp.xy, gfu.uInputClamp.zw));
    let cg = textureSample(uTexture, uSampler, uv);
    let cb = textureSample(uTexture, uSampler, clamp(uv - offset, gfu.uInputClamp.xy, gfu.uInputClamp.zw));

    var rgb = vec3<f32>(0.0, 0.0, 0.0);
    if (cr.a > 0.0) { rgb.r = cr.r / cr.a; }
    if (cg.a > 0.0) { rgb.g = cg.g / cg.a; }
    if (cb.a > 0.0) { rgb.b = cb.b / cb.a; }

    let alpha = max(max(cr.a, cg.a), cb.a);

    return vec4<f32>(rgb * alpha, alpha);
}
`;

export function createChromaticFilter(): Filter {
    return new Filter({
        glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'chromatic-filter' }),
        gpuProgram: GpuProgram.from({
            vertex: { source, entryPoint: 'mainVertex' },
            fragment: { source, entryPoint: 'mainFragment' },
        }),
        // 色散會把顏色推出原本的輪廓，沒有 padding 的話最外圈會被切掉
        padding: 16,
        resources: {
            chroma: new UniformGroup({
                uStrength: { value: 6, type: 'f32' },
                uFalloff: { value: 2, type: 'f32' },
            }),
        },
    });
}

export const chromaticEffect: EffectDef = {
    id: 'chromatic',
    i18nKey: 'shader.chromatic',
    technique: 'filter',
    params: [
        { kind: 'range', key: 'uStrength', labelKey: 'shader.param.chromaStrength', min: 0, max: 30, step: 0.5, default: 6 },
        { kind: 'range', key: 'uFalloff', labelKey: 'shader.param.chromaFalloff', min: 0.5, max: 4, step: 0.1, default: 2 },
    ],
    sources: { glsl: fragment, wgsl: source },
    animate: { key: 'uStrength', cycleSeconds: 4, min: 0, max: 18 },
    create: (texture) => {
        const filter = createChromaticFilter();
        const u = (filter.resources.chroma as UniformGroup).uniforms as Record<string, number>;

        return spriteWithFilter(texture, filter, (values: ParamValues) => {
            for (const [k, v] of Object.entries(values)) {
                if (k in u && typeof v === 'number') u[k] = v;
            }
        });
    },
};
