import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';
import { spriteWithFilter, type EffectDef, type ParamValues } from './types';

/**
 * Displacement —— 水面折射般的 UV 扭曲。
 *
 * 和 Dissolve 的差別很有意思：Dissolve 只改**當前像素**的顏色與 alpha，
 * 這一個則是去**別的地方取樣**——它是一個 gather 操作。這個差別決定了兩件事：
 *
 * 1. **它必須是 filter，不能只是 mesh 材質的一段數學**：要讀取鄰近像素，
 *    就得先有一張「已經畫好的」輸入貼圖。這是 filter 存在的理由，也是它的代價。
 *
 * 2. **padding 是有成本的**：波峰會把畫面往外推，超出 filter frame 的部分會被裁掉，
 *    所以要留 padding。但 filter 的暫存貼圖面積是 (w + 2p) × (h + 2p)——
 *    padding 從 0 加到 40px，在一個 200×200 的 sprite 上就是 **2.0 倍的 fillrate**。
 *    padding 不是「設大一點比較安全」的東西，它是直接乘在成本上的。
 *
 * 位移量以**像素**為單位（而非 UV），再用 `uInputSize.zw`（= 1/尺寸）換算回 UV，
 * 這樣參數的意義不會隨 sprite 大小漂移。取樣座標一律用 `uInputClamp` 夾住：
 * filter 的輸入貼圖是圖集的一塊，越界取樣會吃到隔壁的內容。
 */

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

// highp 不是裝飾用的。Pixi 的預設 filter vertex shader 也宣告了 uInputSize，
// 而 vertex 階段的 float 預設是 highp、fragment 階段是 mediump——
// 同一個 uniform 在兩階段精度不符，program 就 link 不起來：
//   "Precisions of uniform 'uInputSize' differ between VERTEX and FRAGMENT shaders"
// 而且它只丟 warning 不丟 error，畫面直接不出來。
uniform highp vec4 uInputSize;   // xy = 尺寸(px)、zw = 1/尺寸
uniform highp vec4 uInputClamp;  // xy = 可取樣範圍左上、zw = 右下

uniform float uTime;
uniform float uAmplitude;  // px
uniform float uFrequency;
uniform float uSpeed;

void main() {
    // 兩個方向用不同的頻率與相位，才不會看起來像整片一起平移
    vec2 offsetPx = vec2(
        sin(vTextureCoord.y * uFrequency + uTime * uSpeed),
        cos(vTextureCoord.x * uFrequency * 0.8 + uTime * uSpeed * 1.3) * 0.6
    ) * uAmplitude;

    vec2 uv = vTextureCoord + offsetPx * uInputSize.zw;
    uv = clamp(uv, uInputClamp.xy, uInputClamp.zw);

    finalColor = texture(uTexture, uv);
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

struct WaveUniforms {
    uTime: f32,
    uAmplitude: f32,
    uFrequency: f32,
    uSpeed: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> wave: WaveUniforms;

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

// 尾逗號是必要的——見 dissolve.ts 的「坑 3」。刪掉它，畫面會全白。
@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
) -> VSOutput {
    return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let offsetPx = vec2<f32>(
        sin(uv.y * wave.uFrequency + wave.uTime * wave.uSpeed),
        cos(uv.x * wave.uFrequency * 0.8 + wave.uTime * wave.uSpeed * 1.3) * 0.6
    ) * wave.uAmplitude;

    var coord = uv + offsetPx * gfu.uInputSize.zw;
    coord = clamp(coord, gfu.uInputClamp.xy, gfu.uInputClamp.zw);

    return textureSample(uTexture, uSampler, coord);
}
`;

export function createDisplacementFilter(): Filter {
    return new Filter({
        glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'wave-filter' }),
        gpuProgram: GpuProgram.from({
            vertex: { source, entryPoint: 'mainVertex' },
            fragment: { source, entryPoint: 'mainFragment' },
        }),
        // 波峰會把畫面往外推；沒有 padding 的話，超出 frame 的那一圈會被切平
        padding: 24,
        resources: {
            wave: new UniformGroup({
                uTime: { value: 0, type: 'f32' },
                uAmplitude: { value: 12, type: 'f32' },
                uFrequency: { value: 14, type: 'f32' },
                uSpeed: { value: 2, type: 'f32' },
            }),
        },
    });
}

export const displacementEffect: EffectDef = {
    id: 'displacement',
    i18nKey: 'shader.displacement',
    technique: 'filter',
    params: [
        { kind: 'range', key: 'uAmplitude', labelKey: 'shader.param.amplitude', min: 0, max: 32, step: 0.5, default: 12 },
        { kind: 'range', key: 'uFrequency', labelKey: 'shader.param.frequency', min: 1, max: 40, step: 0.5, default: 14 },
        { kind: 'range', key: 'uSpeed', labelKey: 'shader.param.speed', min: 0, max: 6, step: 0.1, default: 2 },
    ],
    sources: { glsl: fragment, wgsl: source },
    create: (texture) => {
        const filter = createDisplacementFilter();
        const u = (filter.resources.wave as UniformGroup).uniforms as Record<string, number>;

        return spriteWithFilter(
            texture,
            filter,
            (values: ParamValues) => {
                for (const [k, v] of Object.entries(values)) {
                    if (k in u && typeof v === 'number') u[k] = v;
                }
            },
            // 水波不需要面板上的自動播放開關：它的動力來自時間本身
            (elapsed: number) => {
                u.uTime = elapsed;
            },
        );
    },
};
