import { Filter, GlProgram, GpuProgram, UniformGroup, defaultFilterVert } from 'pixi.js';
import type { SkyPalette } from './sky';

/**
 * 首頁的 signature：一面水。
 *
 * 整個畫面是一潭靜水，看到的不是雲本身而是**雲的倒影**——所以 fbm 在 y 方向被壓扁成橫向條紋
 * （各向異性取樣），這是倒影和霧的差別。
 *
 * 水面平常是**完全靜止**的，只有倒影在緩緩流動。漣漪只在使用者 hover 節點時產生（點擊另有一發
 * 大的當轉場），所以畫面上每一次擾動都對應一個剛發生的動作，沒有背景自己在動的東西。
 * 節點則像浮在水面上的葉子，被別人的漣漪推著晃——見 scene.ts 的 sampleWater 用法。
 *
 * 關鍵在於漣漪**不畫任何亮圈**：它算出來的是高度場，取解析梯度當水面斜率，拿斜率去偏移倒影的取樣
 * 座標。漣漪經過的地方雲會被扭開又合攏，亮度變化則來自斜面反光。這樣漣漪和倒影是同一潭水，
 * 而不是兩層疊在一起的貼紙——差別很大，一畫亮圈就破功。
 *
 * 沿用 Shader Lab 那套「同時手寫 GLSL 與 WGSL」的自訂 filter 寫法（見 shaderLab/effects）。
 * 一條低頻相位讓整面在**琥珀（GLSL/WebGL）↔ 紫（WGSL/WebGPU）**之間緩慢呼吸——
 * 這個作品集的識別就是「同一件事做兩遍」，連水色都在講這件事。
 *
 * 刻意壓得很暗、對比很低：它是背景，不能蓋過節點與文字，所以只在 ink 底色上疊薄薄一層 tone，
 * 再加暈影把邊角壓下去。
 */

/**
 * 同時餵給 GLSL 與 WGSL 的水面常數——兩邊要調就一起調，不然雙後端會長得不一樣。
 *
 * 水滴是**瞬時脈衝**：每一發都帶自己的起始時間，排程完全在 CPU 端（節點每隔幾秒滴一次、
 * hover 補一發、點擊打一發大的）。shader 只認「這裡有一發從 t0 開始的漣漪」，
 * 所以三種漣漪走同一條路徑，不必在 fragment 裡寫兩套迴圈。
 *
 * slot 數量要撐得住同時存活的漣漪，否則新的一發會蓋掉還在擴散的舊的，看起來就是漣漪「走到一半
 * 被切斷」。漣漪改成只由 hover 觸發後，閒置時是 0 發；但滑鼠快速掃過多個節點會連發，
 * 每發存活約 11 秒，所以格子仍要留寬。挑格子時選**最舊的**（而不是 ring buffer 無腦輪替），
 * 犧牲的永遠是最沒價值的那發。
 */
const MAX_DROPS = 16;
/** 超過這個歲數的漣漪一定衰減光了（exp(-11×0.5)≈0.004），CPU 端主動回收讓格子能重用。 */
const DROP_LIFETIME = 11;
const WAVE = {
    /** 波前每秒擴散多遠（單位＝畫面高度） */
    speed: 0.19,
    /** 波紋空間頻率：越大圈數越密 */
    freq: 48.0,
    /** 波前往中心的指數衰減：尾巴留幾圈 */
    tail: 5.5,
    /** 整發漣漪隨時間的生命衰減 */
    life: 0.5,
    /** 水面斜率偏移倒影 uv 的強度（斜率已正規化成 O(1)，這裡就是實際的 uv 位移上限） */
    warp: 0.045,
    /** 斜面反光強度 */
    spec: 0.32,
};

/**
 * 月光帶的橫向位置與寬度（aspect 空間，跟 uv.x 同一套）。
 * 0.72 偏右：讓它落在節點圖的空檔上，不從標題或節點正中間穿過去。
 */
const GLINT = { x: 0.72, w: 0.2 };

// WebGL：GLSL 300 es
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

// vTextureCoord 的 1.0 **不是**畫面右邊緣——Pixi 從 texture pool 拿的輸入紋理比輸出區域大，
// 有效範圍只到 uOutputFrame.zw / uInputSize.xy。漣漪的落點是畫面座標，不還原就會整體偏掉。
// highp 是必要的：預設 filter vertex shader 也宣告了這兩個，vertex 預設 highp 而 fragment 預設
// mediump，精度不符會 link 失敗（見 shaderLab/chromatic 的同一個坑）。
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;

uniform float uTime;
uniform float uAspect;
uniform float uDropCount;
uniform float uCloud;
uniform float uVig;
uniform float uGlint;
uniform vec3 uSkyTop;
uniform vec3 uHorizon;
uniform vec3 uWater;
uniform vec3 uSun;
// xy = 落點（正規化螢幕座標），z = 起始時間 t0，w = 強度（0 = 這格沒用）
uniform vec4 uDrops[${MAX_DROPS}];
// x = 擴散速度倍率，y = 波紋密度倍率（轉場那發要又快又疏，hover 則細碎）
uniform vec4 uDropMod[${MAX_DROPS}];

const float W_SPEED = ${WAVE.speed.toFixed(3)};
const float W_FREQ = ${WAVE.freq.toFixed(1)};
const float W_TAIL = ${WAVE.tail.toFixed(1)};
const float W_LIFE = ${WAVE.life.toFixed(3)};
const float W_WARP = ${WAVE.warp.toFixed(4)};
const float W_SPEC = ${WAVE.spec.toFixed(3)};
const float GLINT_X = ${GLINT.x.toFixed(3)};
const float GLINT_W = ${GLINT.w.toFixed(3)};

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

/**
 * 月光帶專用的細波紋。兩層就夠——單層 value noise 在這種高頻下會把自己的格子露出來，
 * 整片變成方塊狀噪點；但也不需要 fbm 的五個八度，那是給雲用的，這裡只要打散規則感。
 */
float ripples(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.3 + vec2(3.1, 7.7)) * 0.35;
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

/**
 * 累加所有水滴在 p 處造成的**水面斜率**（不是高度）。
 *
 * 高度 h = sin(x·FREQ) · exp(x·TAIL) · exp(-age·LIFE)，其中 x = d - 波前半徑（波前外側 x>0，還沒傳到）。
 * 斜率用解析微分而不是有限差分——省掉每滴多算兩次取樣，而且不會因為半解析度而抖。
 */
vec2 waterSlope(vec2 p) {
    vec2 slope = vec2(0.0);
    int count = int(uDropCount);
    for (int i = 0; i < ${MAX_DROPS}; i++) {
        if (i >= count) break; // 上限是常數（有些驅動不吃動態迴圈邊界），實際只跑到活著的發數
        vec4 drop = uDrops[i];
        if (drop.w <= 0.0) continue;

        vec2 c = vec2(drop.x * uAspect, drop.y);
        vec2 d = p - c;
        float r = length(d);
        if (r < 1e-4) continue;

        float age = uTime - drop.z;
        if (age < 0.0) continue; // 還沒開始滴

        float speed = W_SPEED * uDropMod[i].x;
        float freq = W_FREQ * uDropMod[i].y;
        float x = r - age * speed;
        if (x > 0.0) continue; // 波前還沒抵達這裡

        float envelope = exp(x * W_TAIL) * exp(-age * W_LIFE) * drop.w;
        // d(h)/d(r)：波本身的導數 + 包絡的導數。除以 freq 正規化——否則斜率量級直接正比於
        // 波紋密度，調密一點整個畫面就被推爛。正規化後 slope 落在 O(1)，warp/spec 的常數才有意義。
        float dhdr = (cos(x * freq) + (W_TAIL / freq) * sin(x * freq)) * envelope;
        slope += (d / r) * dhdr;
    }
    return slope;
}

void main() {
    // 還原成 0..1 的畫面座標，漣漪落點才跟節點對得上
    vec2 screen = vTextureCoord * uInputSize.xy / uOutputFrame.zw;

    vec2 uv = screen;
    uv.x *= uAspect;
    float t = uTime * 0.03;

    // 水面斜率：漣漪唯一的產物。它推開倒影的取樣座標，也決定斜面反光。
    vec2 slope = waterSlope(uv);
    vec2 ruv = uv - slope * W_WARP;

    // 倒影不是霧：雲映在水面上會被壓成橫向條紋，所以 y 方向頻率拉高。
    vec2 auv = vec2(ruv.x, ruv.y * 2.6);

    // domain warp：讓流動有機、不像規則的等高線
    vec2 q = vec2(fbm(auv * 2.0 + t), fbm(auv * 2.0 - t + vec2(5.2, 1.3)));
    float f = fbm(auv * 3.0 + q * 1.5 + t);

    // 天色的垂直漸層。畫面**上方**是遠處水面：視線幾乎貼著水掠過去，映到的是地平線那圈暖光；
    // **下方**是腳邊的水，近乎垂直看下去，映的是天頂。真實水面就是這樣分層的，
    // 這條漸層是「像一潭水」和「像一團霧」的分水嶺——比換什麼顏色都關鍵。
    // 反向寫成 1.0 - smoothstep(小, 大, x)：edge0 > edge1 的倒序 smoothstep 在 WGSL 是未定義行為，
    // 兩邊要保持同一種寫法，不然雙後端會長得不一樣
    float horizonMix = 1.0 - smoothstep(0.02, 0.62, screen.y);
    vec3 tone = mix(uSkyTop, uHorizon, horizonMix);

    // 地平線的光要染在**水面本身**，不能只疊在雲上——不然黃昏會整個消失：橘色只在雲影裡出現，
    // 而雲影本來就只有兩三成強度，一整面水看起來仍是冷灰。真實的夕陽是遠處那片水都在發橘光。
    // 平方讓它收在畫面上緣成為一條光帶，而不是把上半面全染掉。
    float glow = horizonMix * horizonMix;
    vec3 col = mix(uWater, uHorizon, glow * 0.5);
    col += tone * smoothstep(0.35, 0.92, f) * uCloud;         // 倒影主體
    float ridge = smoothstep(0.55, 0.61, f) - smoothstep(0.61, 0.7, f);
    col += tone * ridge * uCloud * 0.67;                      // 雲隙間的細絲高光

    // 斜面反光：水面傾斜處把光反成另一個角度。這不是疊上去的亮圈，是斜率的直接後果——
    // 所以它只會出現在漣漪確實扭到倒影的地方，兩者永遠對得上。
    // 取的是**光源色**而不是天色：日正當中是冷白、黃昏是橘金、夜裡是月光的青白，
    // 有一顆真的光源在照，漣漪才不像自體發光。
    float spec = clamp(dot(slope, vec2(0.55, -0.84)), -1.0, 1.0);
    col += uSun * spec * W_SPEC;

    // 月光帶：光源正下方那條被水波揉碎的亮路。三個因子相乘——
    // ① 高斯橫向包絡，決定它是一條帶而不是一片；② 靠近地平線才亮（遠處水面才照得到）；
    // ③ 拿雲的 fbm 當碎片遮罩，讓它斷成粼粼的亮片，不是一根均勻的光柱。
    // 少了 ③ 會像一道探照燈，那是最容易破功的地方。
    float gx = (uv.x - GLINT_X * uAspect) / GLINT_W;
    float band = exp(-gx * gx) * (0.45 + 0.55 * horizonMix);
    // 碎片遮罩要用**水波**不是雲：拿 f（雲的 fbm）當遮罩的話，亮起來的是雲的形狀，
    // 看起來就成了「右上角一團亮雲」而不是一條鋪在水上的光路。
    // x 低頻、y 極高頻＝被壓扁的細長橫紋，那才是水面碎光的樣子（方形斑點就破功了）。
    // smoothstep 的下緣拉到 0.5：只留最亮的那些片，稀疏才像粼粼，糊成一片就成了一塊亮斑。
    float ripple = ripples(vec2(ruv.x * 7.0, ruv.y * 130.0 + uTime * 0.05));
    float shimmer = smoothstep(0.5, 0.92, ripple);
    col += uSun * band * shimmer * uGlint;

    // 暈影：邊角壓暗，中央讓內容站得住。白天壓太多會顯髒，所以深度跟著天色走。
    vec2 c = screen - 0.5;
    float vig = clamp(1.0 - dot(c, c) * 1.15, 0.0, 1.0);
    col *= mix(uVig, 1.0, vig);

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
    uDropCount: f32,
    uCloud: f32,
    uVig: f32,
    uGlint: f32,
    uSkyTop: vec3<f32>,
    uHorizon: vec3<f32>,
    uWater: vec3<f32>,
    uSun: vec3<f32>,
    uDrops: array<vec4<f32>, ${MAX_DROPS}>,
    uDropMod: array<vec4<f32>, ${MAX_DROPS}>,
};

const W_SPEED: f32 = ${WAVE.speed.toFixed(3)};
const W_FREQ: f32 = ${WAVE.freq.toFixed(1)};
const W_TAIL: f32 = ${WAVE.tail.toFixed(1)};
const W_LIFE: f32 = ${WAVE.life.toFixed(3)};
const W_WARP: f32 = ${WAVE.warp.toFixed(4)};
const W_SPEC: f32 = ${WAVE.spec.toFixed(3)};
const GLINT_X: f32 = ${GLINT.x.toFixed(3)};
const GLINT_W: f32 = ${GLINT.w.toFixed(3)};

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

// 月光帶的細波紋——兩層打散 value noise 的格子（見 GLSL 版註解）
fn ripples(p: vec2<f32>) -> f32 {
    return vnoise(p) * 0.65 + vnoise(p * 2.3 + vec2<f32>(3.1, 7.7)) * 0.35;
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

// 水面斜率——與 GLSL 版同一套解析微分，兩邊要改就一起改
fn waterSlope(p: vec2<f32>) -> vec2<f32> {
    var slope = vec2<f32>(0.0);
    let count = i32(field.uDropCount);
    for (var i = 0; i < ${MAX_DROPS}; i++) {
        if (i >= count) { break; }
        let drop = field.uDrops[i];
        if (drop.w <= 0.0) { continue; }

        let c = vec2<f32>(drop.x * field.uAspect, drop.y);
        let d = p - c;
        let r = length(d);
        if (r < 1e-4) { continue; }

        let age = field.uTime - drop.z;
        if (age < 0.0) { continue; }

        let speed = W_SPEED * field.uDropMod[i].x;
        let freq = W_FREQ * field.uDropMod[i].y;
        let x = r - age * speed;
        if (x > 0.0) { continue; }

        let envelope = exp(x * W_TAIL) * exp(-age * W_LIFE) * drop.w;
        let dhdr = (cos(x * freq) + (W_TAIL / freq) * sin(x * freq)) * envelope;
        slope += (d / r) * dhdr;
    }
    return slope;
}

@fragment
fn mainFragment(@location(0) uv0: vec2<f32>) -> @location(0) vec4<f32> {
    // 還原成 0..1 的畫面座標（uv0 的 1.0 不是畫面右緣，見 GLSL 版註解）
    let screen = uv0 * gfu.uInputSize.xy / gfu.uOutputFrame.zw;

    var uv = screen;
    uv.x = uv.x * field.uAspect;
    let t = field.uTime * 0.03;

    let slope = waterSlope(uv);
    let ruv = uv - slope * W_WARP;
    let auv = vec2<f32>(ruv.x, ruv.y * 2.6); // 倒影被壓成橫向條紋

    let q = vec2<f32>(fbm(auv * 2.0 + t), fbm(auv * 2.0 - t + vec2<f32>(5.2, 1.3)));
    let f = fbm(auv * 3.0 + q * 1.5 + t);

    // 天色垂直漸層：上方遠處水面映地平線暖光，下方近處映天頂（見 GLSL 版註解）
    let horizonMix = 1.0 - smoothstep(0.02, 0.62, screen.y);
    let tone = mix(field.uSkyTop, field.uHorizon, horizonMix);

    // 地平線的光染進水面本身，不只疊在雲上（見 GLSL 版註解）
    let glow = horizonMix * horizonMix;
    var col = mix(field.uWater, field.uHorizon, glow * 0.5);
    col += tone * smoothstep(0.35, 0.92, f) * field.uCloud;
    let ridge = smoothstep(0.55, 0.61, f) - smoothstep(0.61, 0.7, f);
    col += tone * ridge * field.uCloud * 0.67;

    // 斜面反光：斜率的直接後果，不是疊上去的亮圈。取光源色而非天色
    let spec = clamp(dot(slope, vec2<f32>(0.55, -0.84)), -1.0, 1.0);
    col += field.uSun * spec * W_SPEC;

    // 月光帶：橫向高斯包絡 × 靠近地平線 × fbm 碎片遮罩（見 GLSL 版註解）
    let gx = (uv.x - GLINT_X * field.uAspect) / GLINT_W;
    let band = exp(-gx * gx) * (0.45 + 0.55 * horizonMix);
    let ripple = ripples(vec2<f32>(ruv.x * 7.0, ruv.y * 130.0 + field.uTime * 0.05));
    let shimmer = smoothstep(0.5, 0.92, ripple);
    col += field.uSun * band * shimmer * field.uGlint;

    let c = screen - 0.5;
    let vig = clamp(1.0 - dot(c, c) * 1.15, 0.0, 1.0);
    col = col * mix(field.uVig, 1.0, vig);

    return vec4<f32>(col, 1.0);
}
`;

/** 一發打進水面的漣漪。座標是正規化螢幕座標（0..1，y 向下），跟 projects.ts 的節點同一套。 */
export interface Drop {
    x: number;
    y: number;
    /** 強度，1 = 標準一滴 */
    strength?: number;
    /** 擴散速度倍率，1 = 標準。轉場那發要橫掃全螢幕就得調高 */
    speed?: number;
    /** 波紋密度倍率，1 = 標準。越低圈越疏 */
    freq?: number;
    /** 誰打出這發的。取樣時可以把自己發出的波排除掉——波源就在它腳下，不排除會被自己震飛 */
    source?: string;
}

/**
 * 水面在某一點對**漂浮物**的作用。
 *
 * 注意這裡取的是波的**能量包絡**，不是逐點的波高/斜率——因為節點半徑（約 0.085）跟波長
 * （2π/72 ≈ 0.087）幾乎一樣大。一片跟波紋等寬的葉子，兩側同時被波峰和波谷托著、受力抵消，
 * 本來就不會跟著細紋抖；它是被整個波包推起來、推開、再落回。取振盪分量的話算出來會接近 0
 * （實測位移只有 0.7px），而且那是物理上正確的 0，不是係數調太小。
 */
export interface WaterSample {
    /** 波經過此處的能量，恆正。波包通過時最大，過了就衰減回 0 */
    energy: number;
    /** 徑向推力（能量 × 背離波源的方向）。漂浮物被經過的波往外推 */
    pushX: number;
    pushY: number;
}

export interface FieldFilter {
    filter: Filter;
    setTime: (seconds: number) => void;
    setAspect: (aspect: number) => void;
    /** 換上某個時刻的天色。呼叫端負責決定「現在幾點」，見 sky.ts */
    setSky: (palette: SkyPalette) => void;
    /** 打一發漣漪進水面。時間軸吃 setTime 餵進來的秒數，所以要先 setTime 再 emit。 */
    emit: (drop: Drop) => void;
    /**
     * 在 CPU 端取樣水面——用的是**和 shader 完全同一份公式**，所以浮在上面的東西怎麼晃，
     * 跟畫面上倒影怎麼扭，必然對得起來。`exclude` 用來略過某個來源自己發出的波。
     */
    sampleWater: (x: number, y: number, exclude?: string) => WaterSample;
    /** 清掉所有還在擴散的漣漪（版面重排、bfcache 還原時用） */
    clearDrops: () => void;
}

/** 一發還活著的漣漪。live 陣列是真實來源，每幀壓成連續的 uniform 陣列餵給 shader。 */
interface LiveDrop {
    x: number;
    y: number;
    t0: number;
    strength: number;
    speed: number;
    freq: number;
    source?: string;
}

export function createFieldFilter(): FieldFilter {
    const drops = new Float32Array(MAX_DROPS * 4);
    const dropMod = new Float32Array(MAX_DROPS * 4);
    const live: LiveDrop[] = [];
    let now = 0;

    const uniforms = new UniformGroup({
        uTime: { value: 0, type: 'f32' },
        uAspect: { value: 1, type: 'f32' },
        // 實際活著的發數。shader 只迴圈到這裡，所以把上限開到 16 不代表每幀都付 16 次的成本。
        // 用 f32 而不是 i32：uniform buffer 佈局全是 f32 最不容易跟 Pixi 的 std140 打架。
        uDropCount: { value: 0, type: 'f32' },
        // 天色由 sky.ts 依系統時鐘餵進來（setSky）。這裡的初值只是「還沒餵之前」的深夜，
        // 不是實際會看到的顏色。
        uCloud: { value: 0.15, type: 'f32' },
        uVig: { value: 0.76, type: 'f32' },
        uGlint: { value: 0.6, type: 'f32' },
        uSkyTop: { value: new Float32Array([0.027, 0.039, 0.078]), type: 'vec3<f32>' },
        uHorizon: { value: new Float32Array([0.051, 0.071, 0.141]), type: 'vec3<f32>' },
        uWater: { value: new Float32Array([0.016, 0.024, 0.047]), type: 'vec3<f32>' },
        uSun: { value: new Float32Array([0.561, 0.659, 0.847]), type: 'vec3<f32>' },
        uDrops: { value: drops, type: 'vec4<f32>', size: MAX_DROPS },
        uDropMod: { value: dropMod, type: 'vec4<f32>', size: MAX_DROPS },
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

    const u = uniforms.uniforms as {
        uTime: number;
        uAspect: number;
        uDropCount: number;
        uCloud: number;
        uVig: number;
        uGlint: number;
        uSkyTop: Float32Array;
        uHorizon: Float32Array;
        uWater: Float32Array;
        uSun: Float32Array;
    };
    return {
        filter,
        setTime: (s) => {
            now = s;
            u.uTime = s;

            // 回收衰減光的，再把還活著的壓成連續陣列。每幀最多搬 16 筆，CPU 成本可以忽略，
            // 換到的是 fragment 迴圈次數等於實際發數，而不是恆為上限。
            for (let i = live.length - 1; i >= 0; i--) {
                if (s - live[i].t0 > DROP_LIFETIME) live.splice(i, 1);
            }
            for (let i = 0; i < live.length; i++) {
                const d = live[i];
                drops[i * 4 + 0] = d.x;
                drops[i * 4 + 1] = d.y;
                drops[i * 4 + 2] = d.t0;
                drops[i * 4 + 3] = d.strength;
                dropMod[i * 4 + 0] = d.speed;
                dropMod[i * 4 + 1] = d.freq;
            }
            u.uDropCount = live.length;
        },
        setAspect: (a) => (u.uAspect = a),
        setSky: (p) => {
            // 就地寫進既有的 Float32Array（跟 uDrops 同一套做法），不換掉陣列本身——
            // Pixi 每幀都會把整個 uniform group 同步上去，改內容就夠了。
            u.uSkyTop.set(p.sky);
            u.uHorizon.set(p.horizon);
            u.uWater.set(p.water);
            u.uSun.set(p.sun);
            u.uCloud = p.cloud;
            u.uVig = p.vig;
            u.uGlint = p.glint;
        },
        sampleWater: (x, y, exclude) => {
            // 波的存在範圍與衰減跟 shader 的 waterSlope() 是同一套（同樣的 envelope、同樣先進
            // aspect 空間），差別只在這裡不取 sin/cos 的振盪分量——理由見 WaterSample 的說明。
            const aspect = u.uAspect;
            let energy = 0;
            let pushX = 0;
            let pushY = 0;

            for (const d of live) {
                if (exclude !== undefined && d.source === exclude) continue;

                const age = now - d.t0;
                if (age < 0) continue;

                const dx = (x - d.x) * aspect;
                const dy = y - d.y;
                const r = Math.hypot(dx, dy);
                if (r < 1e-4) continue;

                const speed = WAVE.speed * d.speed;
                const px = r - age * speed;
                if (px > 0) continue; // 波前還沒到

                const envelope = Math.exp(px * WAVE.tail) * Math.exp(-age * WAVE.life) * d.strength;
                energy += envelope;
                pushX += (dx / r) * envelope;
                pushY += (dy / r) * envelope;
            }

            return { energy, pushX, pushY };
        },
        emit: (d) => {
            live.push({
                x: d.x,
                y: d.y,
                t0: now,
                strength: d.strength ?? 1,
                speed: d.speed ?? 1,
                freq: d.freq ?? 1,
                source: d.source,
            });
            // 滿了才犧牲最舊的那發——它衰減得最多，被切斷最不明顯
            if (live.length > MAX_DROPS) {
                let oldest = 0;
                for (let i = 1; i < live.length; i++) {
                    if (live[i].t0 < live[oldest].t0) oldest = i;
                }
                live.splice(oldest, 1);
            }
        },
        clearDrops: () => {
            live.length = 0;
            u.uDropCount = 0;
        },
    };
}
