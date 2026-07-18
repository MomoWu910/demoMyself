/**
 * 首頁 render graph 的單一真實來源。
 *
 * 這個作品集的動線被畫成一張「活的 GPU render graph」：每個專案是一個 pass（節點），
 * 邊代表**兩端節點共用的技術**（不是有向的資料流——A 跟 B 之間畫線，是因為兩者都用到這項技術）。這裡描述節點與邊，Pixi 舞台照著畫、
 * React overlay 照著長 inspector——之後跨頁導覽也吃同一份資料。
 *
 * 座標是正規化的（0..1，y 向下），刻意排出「架構」而非隨機散佈：
 * Cross-Engine 是共用 WebGL context 的樞紐、Shader Lab 與 Findings 靠 bench 相連、
 * Configurator 是自成一島的 Babylon 3D 旗艦（技術上跟其他人不共用底層——這件事本身就是資訊）。
 */

/** 邊代表的共用技術；tone 決定它畫成什麼顏色（琥珀=GLSL/WebGL，紫=WGSL/WebGPU）。 */
export type Tone = 'glsl' | 'wgsl' | 'dual' | 'pixi' | 'neutral';

/** tone → CSS hex。首頁 zoom 轉場與落地頁 reveal 共用同一組色，動線才連得起來。 */
export const TONE_HEX: Record<Tone, string> = {
    glsl: '#ff8a3d',
    wgsl: '#b57bff',
    dual: '#d98ad6',
    pixi: '#5aa9ff',
    neutral: '#9aa0b2',
};

export interface ProjectNode {
    id: string;
    /** 導向的頁面 */
    href: string;
    /** i18n key 前綴：沿用現有 home.* 文案（{i18nKey}.title / .desc / .cta） */
    i18nKey: string;
    /** 節點上的一個字元符號（不是 emoji 的裝飾，是 pass 的識別記號） */
    glyph: string;
    /** 面板與節點上顯示的技術標籤 */
    tags: string[];
    /** 這個 pass 自身的色調傾向（Shader Lab 是 dual：琥珀↔紫） */
    tone: Tone;
    /** 正規化座標（桌面/寬螢幕） */
    x: number;
    y: number;
    /** 節點視覺半徑（正規化到畫布短邊） */
    r: number;
    /** 窄手機（<520px）用的直式 zig-zag 座標——左右交錯，標籤才不會互相疊 */
    narrow: { x: number; y: number; r: number };
}

export interface ResourceEdge {
    from: string;
    to: string;
    /** 這條邊代表哪一項共用技術——mono 標籤直接畫在邊上 */
    resource: string;
    tone: Tone;
    /** RWD 這種「包住一切」的 meta 關聯畫成虛線、比較淡 */
    meta?: boolean;
}

export const NODES: ProjectNode[] = [
    {
        id: 'crossEngine',
        href: './pixi_x_three.html',
        i18nKey: 'home.crossEngine',
        glyph: '⊕',
        tags: ['PixiJS v8', 'Three.js', 'WebGL Context'],
        tone: 'pixi',
        x: 0.31,
        y: 0.36,
        r: 0.085,
        narrow: { x: 0.32, y: 0.28, r: 0.13 },
    },
    {
        id: 'shaderLab',
        href: './shader_lab.html',
        i18nKey: 'home.shader',
        glyph: '⇄',
        tags: ['GLSL', 'WGSL', 'React + Zustand'],
        tone: 'dual',
        x: 0.72,
        y: 0.31,
        r: 0.085,
        narrow: { x: 0.68, y: 0.37, r: 0.15 },
    },
    {
        id: 'findings',
        href: './findings.html',
        i18nKey: 'home.lab',
        glyph: '∿',
        tags: ['CPU Frame Time', 'Draw Calls', 'bench'],
        tone: 'neutral',
        x: 0.42,
        y: 0.66,
        r: 0.075,
        narrow: { x: 0.34, y: 0.54, r: 0.135 },
    },
    {
        id: 'configurator',
        href: './configurator.html',
        i18nKey: 'home.configurator',
        glyph: '◈',
        tags: ['Babylon.js', 'PBR / IBL', 'glTF'],
        tone: 'wgsl',
        x: 0.74,
        y: 0.68,
        r: 0.08,
        narrow: { x: 0.68, y: 0.71, r: 0.14 },
    },
    {
        id: 'rwd',
        href: './rwd_showcase.html',
        i18nKey: 'home.rwd',
        glyph: '▤',
        tags: ['Responsive', 'Device Simulator'],
        tone: 'neutral',
        x: 0.16,
        y: 0.64,
        r: 0.06,
        narrow: { x: 0.32, y: 0.88, r: 0.11 },
    },
];

export const EDGES: ResourceEdge[] = [
    { from: 'crossEngine', to: 'shaderLab', resource: 'Pixi v8', tone: 'pixi' },
    { from: 'crossEngine', to: 'findings', resource: 'Pixi v8', tone: 'pixi' },
    { from: 'shaderLab', to: 'findings', resource: 'bench', tone: 'neutral' },
    // RWD 包住站內每一頁——用淡虛線接到幾個節點示意，不喧賓奪主
    { from: 'rwd', to: 'crossEngine', resource: 'wraps', tone: 'neutral', meta: true },
    { from: 'rwd', to: 'findings', resource: 'wraps', tone: 'neutral', meta: true },
];

export function nodeById(id: string): ProjectNode {
    return NODES.find((n) => n.id === id) ?? NODES[0];
}

/** 圖例上要列的共用技術種類——這是 render graph 的圖例 key。 */
export const RESOURCE_LEGEND: Array<{ resource: string; tone: Tone }> = [
    { resource: 'WebGL Context', tone: 'glsl' },
    { resource: 'Pixi v8', tone: 'pixi' },
    { resource: 'bench', tone: 'neutral' },
    { resource: 'GLSL · WGSL', tone: 'dual' },
];
