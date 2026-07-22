/**
 * 程序生成表面細節的 fragment shader。
 *
 * **一支 shader 服務三種紋理 × 兩種輸出**（uKind / uMode 切換），而不是寫六支：
 * 三種紋理的差別只在 height() 那一段怎麼堆疊 noise，法線與粗糙度的推導完全共用。
 * 拆成六支就要維護六份「高度轉法線」的重複碼。
 *
 * 產出的貼圖只跑一次（見 surfaceDetail.ts 的 refreshRate = 0），之後每幀就只是
 * 一次普通的貼圖取樣——跟載入一張 JPG 完全相同的成本。
 *
 * **所有 noise 都帶 period 參數**，在 hash 之前先 `mod(p, period)`。少了這件事，
 * 貼圖左右邊界的隨機值對不起來，鞋面上會出現一條直的接縫，近拍機位一看就穿幫。
 */
export const SURFACE_SHADER = `
precision highp float;
varying vec2 vUV;

uniform float uKind;     // 0 = fabric, 1 = leather, 2 = metal
uniform float uMode;     // 0 = normal map, 1 = roughness
uniform float uDensity;  // 一張貼圖裡塞幾個週期（必須是整數才平鋪得起來）

float hash(vec2 p, float period) {
    p = mod(p, period);
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i, period), hash(i + vec2(1.0, 0.0), period), u.x),
        mix(hash(i + vec2(0.0, 1.0), period), hash(i + vec2(1.0, 1.0), period), u.x),
        u.y);
}

float fbm(vec2 p, float period) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
        sum += amp * noise(p, period);
        p *= 2.0;        // 頻率加倍，period 也要跟著加倍才維持無縫
        period *= 2.0;
        amp *= 0.5;
    }
    return sum;
}

/** voronoi 距離場——皮革表面那種不規則細胞紋 */
float cells(vec2 p, float period) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float d = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = vec2(hash(ip + g, period), hash(ip + g + vec2(17.3, 5.1), period));
            d = min(d, length(g + o - fp));
        }
    }
    return d;
}

float height(vec2 uv) {
    if (uKind < 0.5) {
        // 布料：經紗與緯紗兩組正交的圓弧，交叉處最高
        vec2 p = uv * uDensity;
        float warp = sin(p.x * 6.2831853);
        float weft = sin(p.y * 6.2831853);
        return (max(warp, weft) * 0.5 + 0.5) * 0.72 + fbm(p * 3.0, uDensity * 3.0) * 0.28;
    }
    if (uKind < 1.5) {
        // 皮革：細胞紋為主，疊一層細噪點當毛孔
        vec2 p = uv * uDensity;
        return (1.0 - cells(p, uDensity)) * 0.74 + fbm(p * 8.0, uDensity * 8.0) * 0.26;
    }
    // 金屬：沿 U 方向極度拉長的 noise，就是拉絲的刷痕
    vec2 p = uv * vec2(uDensity * 6.0, uDensity * 0.25);
    return fbm(p, uDensity * 6.0) * 0.85 + noise(p * 4.0, uDensity * 24.0) * 0.15;
}

void main(void) {
    if (uMode < 0.5) {
        // 中央差分求梯度 → 切線空間法線。texel 大小寫死 1/512，與生成尺寸一致。
        float e = 1.0 / 512.0;
        float hl = height(vUV - vec2(e, 0.0));
        float hr = height(vUV + vec2(e, 0.0));
        float hd = height(vUV - vec2(0.0, e));
        float hu = height(vUV + vec2(0.0, e));
        vec3 n = normalize(vec3((hl - hr) * 9.0, (hd - hu) * 9.0, 1.0));
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    } else {
        // PBR 的 roughness 讀 metallicTexture 的 green channel（見 surfaceDetail.ts）
        float h = height(vUV);
        gl_FragColor = vec4(0.0, clamp(0.34 + h * 0.5, 0.0, 1.0), 0.0, 1.0);
    }
}
`;
