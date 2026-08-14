/**
 * 首頁 render graph 的單一真實來源。
 *
 * 這個作品集的動線被畫成一張「活的 GPU render graph」：每個專案是一個 pass（節點），
 * 邊代表**兩端節點共用的技術**（不是有向的資料流——A 跟 B 之間畫線，是因為兩者都用到這項技術）。
 *
 * **邊是照 import 關係畫的，而且分兩級**（見 EdgeKind）：兩端 import 同一個自寫模組 ≠
 * 兩端各自 import 同一個第三方函式庫。原本這兩種混在一起畫成同一條線，會讓人以為
 * Cross-Engine 跟 Shader Lab 之間有共用程式碼（實際上只是都建在 Pixi 上）。
 *
 * 對照 import 時要注意**一個節點的範圍不等於一個資料夾**：Findings 節點涵蓋結論頁
 * 底下那三個實驗（頁面直接連過去），所以它算「建在 Pixi 上」——雖然 `src/findings/`
 * 自己一個 pixi import 都沒有。
 *
 * 這裡描述節點與邊，Pixi 舞台照著畫、
 * React overlay 照著長 inspector——之後跨頁導覽也吃同一份資料。
 *
 * 座標是正規化的（0..1，y 向下），刻意排出「架構」而非隨機散佈：
 * Cross-Engine 是共用 WebGL context 的樞紐、Shader Lab 與 Findings 靠 bench 相連、
 * Configurator 是自成一島的 Babylon 3D 旗艦（技術上跟其他人不共用底層——這件事本身就是資訊）。
 * Arcade 掛在 Cross-Engine 的另一側，讓三條 Pixi 邊都從同一個樞紐散出去。
 */

/**
 * 技術的顏色語彙（琥珀=GLSL/WebGL，紫=WGSL/WebGPU，藍=Pixi，綠=Three，紅=Babylon，
 * 檸檬綠=React）。
 *
 * 判準是**這項技術能不能區分節點**，不是它重不重要：上色的前提是「有些 pass 有、
 * 有些沒有」。TypeScript 每頁都用，畫上去只會讓每個圓都多一段一模一樣的顏色。
 *
 * React 原本被歸在「每個專案都有」而排除，但那個前提是錯的——查 import 只有
 * Shader Lab、Configurator 與 Arcade 用，Cross-Engine 刻意維持零框架
 * （lil-gui / Pixi 畫的 HUD）、Findings 與 RWD 是靜態頁。六個節點裡三個有，
 * 區辨力足夠，而且它標示出一件真的架構事實：**只有需要資料驅動 UI 的那幾頁，
 * 才採用「React 管 canvas 外、引擎管 canvas 內」的分工**。
 *
 * 檸檬綠是算出來的，不是挑順眼的：現有色的色相集中在 24° 與 148°~358°，
 * 70° 正好是最大的空缺，與每一個現有色的 CIELAB 距離都 ≥58（其他候選最多 46）。
 * 不用 React 官方青 #61dafb，一來它與 neutral 灰只差 34，二來 cyan-on-black
 * 正是這個作品集刻意離開的那張「AI 預設臉」。
 */
export type Tone = 'glsl' | 'wgsl' | 'dual' | 'pixi' | 'three' | 'babylon' | 'react' | 'neutral';

/** tone → CSS hex。首頁 zoom 轉場與落地頁 reveal 共用同一組色，動線才連得起來。 */
export const TONE_HEX: Record<Tone, string> = {
    glsl: '#ff8a3d',
    wgsl: '#b57bff',
    dual: '#d98ad6',
    pixi: '#5aa9ff',
    three: '#4fd18b',
    babylon: '#f2555a',
    react: '#c3e327',
    neutral: '#9aa0b2',
};

export interface ProjectNode {
    id: string;
    /** 導向的頁面 */
    href: string;
    /** i18n key 前綴：沿用現有 home.* 文案（{i18nKey}.title / .desc） */
    i18nKey: string;
    /**
     * 葉尖朝向（度，0 = 指向右方，順時針為正）。
     *
     * 每片葉子各朝一方，是為了讓它們讀起來像**散落在水面上**而不是排好的圖示。
     * 取值不是隨機的：一律讓葉尖大致背對畫面中心，葉子才不會全部指進來、
     * 把視線鎖死在中央那塊什麼都沒有的水面上。
     *
     * 這個角度只轉葉子本身——漂浮造成的傾斜疊在外層 container 上，兩者互不干擾，
     * 節點下方的文字標籤也因此永遠是正的（見 scene.ts 的 leafGfx）。
     */
    leafAngle: number;
    /** 面板與節點上顯示的技術標籤 */
    tags: string[];
    /**
     * 外框要畫成哪幾段色＝這個 pass 用到的**引擎與著色器**。
     *
     * 節點外框因此不只是識別色，而是「這東西用什麼做的」——跟左下角技術棧同一套映射，
     * 兩邊互為對照。只列有顏色的技術（見 Tone 的說明），沒有的就不佔一段，
     * 否則每個圓都會被 React/TypeScript 這種共通項塞滿、失去區辨力。
     * 省略時退回單色 tone。
     */
    stack?: Tone[];
    /** 這個 pass 自身的色調傾向（Shader Lab 是 dual：琥珀↔紫） */
    tone: Tone;
    /** 正規化座標（桌面/寬螢幕） */
    x: number;
    y: number;
    /** 節點視覺半徑（正規化到畫布短邊） */
    r: number;
    /**
     * 窄手機（<520px）用的直式 zig-zag 座標——左右交錯，標籤才不會互相疊。
     *
     * 六個節點要塞進一支手機的高度，靠的是 x **嚴格**左右交錯（.68 / .32 輪流）：
     * 交錯之後相鄰兩個只要垂直錯開就夠，標籤水平重疊看不出來，y 因此可以靠到 0.08。
     * 排法是配對（組內差 ~0.08、組間差 ~0.16），不是六等分——等分會讓每一個都離得一樣遠，
     * 讀起來是一條清單而不是一張圖。**破壞交錯的代價很具體**：同側相鄰時 y 要差到 0.19
     * 以上才不會讓上面那個的標籤壓到下面那片葉子（葉子朝下那端連葉柄佔到 1.3×r，
     * 標籤本身還有一行字高），而六個節點沒有那麼多垂直空間可以攤。
     *
     * 三個邊界不能動：最上不高於 0.26（會撞左上的 wordmark）、
     * RWD 留在**左**下（小螢幕的技術棧會收成右下角一顆按鈕）、
     * 且明顯低於其他節點（包圍框的底邊靠 `max(rwd.py, …)` 穿過它，
     * 見 scene.ts 的 drawWrapFrame；被其他節點的框底追過就會變成浮在框內）。
     */
    narrow: { x: number; y: number; r: number };
}

/**
 * 一條邊憑什麼存在。**這張圖是照 import 關係畫的**，不是照「感覺上有關」，
 * 所以「共用」分成兩級——被問到「共用什麼？」時兩者的答案完全不同：
 *
 * - `module`：兩端都 import **這個 repo 裡我自己寫的同一個模組**（目前只有 `src/bench/`）。
 *   實線＋沿線流動的封包：Findings 的 JSON 真的是 Shader Lab 那套 runner 產出來的。
 * - `library`：兩端各自 import **同一個第三方函式庫**，彼此之間沒有互相 import。
 *   虛線、不畫封包——沒有東西在它們之間流動，只是建構在同一塊地基上。
 * - `meta`：RWD 那種「包住站內每一頁」的全站關聯，不畫成線（見 scene.ts 的 drawWrapFrame）。
 */
export type EdgeKind = 'module' | 'library' | 'meta';

export interface ResourceEdge {
    from: string;
    to: string;
    /** 這條邊代表哪一項共用技術——mono 標籤直接畫在邊上 */
    resource: string;
    tone: Tone;
    kind: EdgeKind;
    /**
     * 標籤沿曲線法線的偏移量。正 = 往弧彎出去的那側（預設側），負 = 另一側。
     * 用來拆開兩條邊的標籤在畫面上疊在一起的情形——`bench` 與 `Pixi v8` 的中點很近。
     *
     * 單位是「短邊 780px 時的像素」，實際會隨版面縮放：寫死像素的話，
     * 在直屏窄screen上這個位移相對整張圖太大，標籤會被推去撞節點自己的標籤。
     */
    labelOffset?: number;
}

export const NODES: ProjectNode[] = [
    {
        id: 'crossEngine',
        href: './pixi_x_three.html',
        i18nKey: 'home.crossEngine',
        leafAngle: 202, // 左上角的節點，葉尖朝左上
        tags: ['PixiJS v8', 'Three.js', 'WebGL Context'],
        // 同一個 WebGL context 上跑 Pixi 與 Three——外框就是這三者
        stack: ['pixi', 'three', 'glsl'],
        tone: 'pixi',
        x: 0.31,
        y: 0.36,
        r: 0.085,
        narrow: { x: 0.68, y: 0.26, r: 0.12 },
    },
    {
        id: 'shaderLab',
        href: './shader_lab.html',
        i18nKey: 'home.shader',
        leafAngle: -28, // 右上角，葉尖朝右上
        tags: ['GLSL', 'WGSL', 'React + Zustand'],
        // 雙寫 GLSL/WGSL：琥珀↔紫，正是這個作品集的識別；面板是 React + Zustand
        stack: ['glsl', 'wgsl', 'react'],
        tone: 'dual',
        x: 0.72,
        y: 0.31,
        r: 0.085,
        narrow: { x: 0.32, y: 0.35, r: 0.13 },
    },
    {
        id: 'arcade',
        href: './arcade.html',
        i18nKey: 'home.arcade',
        // 葉尖朝右上。**不能取正上方（-90）**：那會讓葉柄指向正下方，而葉柄那端比葉尖
        // 多伸出約 0.36×r（見 leaf.ts 的 leafStem），垂直總長 1.51×r 就超過 scene.ts
        // 給標籤讓出的 1.25×r，標籤會壓在葉柄上。45° 把垂直佔用壓到 1.34×r。
        leafAngle: -45,
        // 「Simulated socket」不寫成 WebSocket：這裡是仿 WebSocket 介面的同行程實作
        // （net/fakeSocket.ts），沒有真的連線——標籤要對得上 source 才禁得起追問
        tags: ['PixiJS v8', 'React', 'Simulated socket'],
        // 玩法全畫在 Pixi 裡，HUD／面板是 React——跟 Shader Lab 同一套分工。
        // 假 WebSocket 那層沒有對應的顏色：色彩語彙只給引擎與著色器（見 Tone），
        // 多開一色會讓外框的讀法從「用什麼畫的」變成「用了哪些技術」。
        stack: ['pixi', 'react'],
        tone: 'pixi',
        // 這是唯一擺在圖上緣的節點，x 不能再往左：左上角的 wordmark 寬度是**固定的**
        // （30ch 的 tagline），而節點座標是正規化的——瀏覽器視窗越窄，葉子越靠近那塊字。
        // 0.52 是視窗剛好 520px（再窄就換 narrow 排版）時葉子左緣仍在 wordmark 右側的位置。
        x: 0.52,
        // 0.22 是量出來的下限：視窗 520px 時 wordmark 底緣在 117px，葉子上緣正好落在它下面。
        // 這個節點同時被兩件事夾著——再往上撞 wordmark，再往下就貼上 Cross-Engine。
        y: 0.22,
        // 比其他節點小一號：它夾在 wordmark 與 Cross-Engine 之間，是全圖餘裕最少的位置
        r: 0.07,
        narrow: { x: 0.68, y: 0.51, r: 0.12 },
    },
    {
        id: 'findings',
        href: './findings.html',
        i18nKey: 'home.lab',
        leafAngle: 118, // 圖的下緣中段，葉尖朝下偏左
        tags: ['CPU Frame Time', 'Draw Calls', 'bench'],
        // 量測的對象是 Pixi，也橫跨兩個後端
        stack: ['pixi', 'glsl', 'wgsl'],
        tone: 'neutral',
        x: 0.42,
        y: 0.66,
        r: 0.075,
        narrow: { x: 0.32, y: 0.61, r: 0.115 },
    },
    {
        id: 'configurator',
        href: './configurator.html',
        i18nKey: 'home.configurator',
        leafAngle: 42, // 右下角，葉尖朝右下
        tags: ['Babylon.js', 'PBR / IBL', 'glTF'],
        // 自成一島的 Babylon——技術上不與其他 pass 共用渲染底層，這件事本身就是資訊。
        // 唯一的例外是那圈檸檬綠：面板跟 Shader Lab 一樣是 React 管的。
        stack: ['babylon', 'react'],
        // tone 要跟 stack 的主色一致：它同時是 zoom 轉場與落地頁 reveal 的顏色，
        // 外框紅、點下去卻轉紫會很突兀
        tone: 'babylon',
        x: 0.74,
        y: 0.68,
        r: 0.08,
        narrow: { x: 0.68, y: 0.76, r: 0.12 },
    },
    {
        id: 'rwd',
        href: './rwd_showcase.html',
        i18nKey: 'home.rwd',
        leafAngle: 158, // 左下角，葉尖朝左下
        tags: ['Responsive', 'Device Simulator'],
        tone: 'neutral',
        x: 0.16,
        // 0.64 → 0.57：左下的技術棧多了一行圖例之後長高，RWD 的標籤正好被它壓到。
        // 這是整張圖唯一跟 overlay 文字搶位置的節點（其餘都在畫面中右側）。
        y: 0.57,
        r: 0.06,
        // 留在左下：小螢幕的技術棧會收成右下角一顆按鈕，RWD 換到右邊就會跟它擠在一起
        narrow: { x: 0.32, y: 0.90, r: 0.10 },
    },
];

export const EDGES: ResourceEdge[] = [
    // 各自 `import from 'pixi.js'`，兩邊沒有互相 import——這是共同依賴，不是共用程式碼。
    { from: 'crossEngine', to: 'shaderLab', resource: 'Pixi v8', tone: 'pixi', kind: 'library' },
    // Findings 節點代表的是**結論頁＋它底下那三個實驗**（findings/index.html 直接連向
    // Optimization Lab / Stress / Stress2），三個都 import pixi.js。`src/findings/` 這一個
    // 資料夾裡確實沒有 pixi，但拿單一 HTML 檔的 import 當判準會判錯這個節點的範圍。
    { from: 'crossEngine', to: 'findings', resource: 'Pixi v8', tone: 'pixi', kind: 'library' },
    // 遊樂場也是 `import from 'pixi.js'`，同樣接在 crossEngine 上——Pixi 的邊一律以它為樞紐
    // 匯集，否則四個都用 Pixi 的節點兩兩相連會變成完全圖。標籤推到弧的另一側，
    // 避開上方那條 crossEngine↔shaderLab 的 Pixi v8。
    { from: 'crossEngine', to: 'arcade', resource: 'Pixi v8', tone: 'pixi', kind: 'library', labelOffset: -30 },
    // src/bench/（BenchRunner / BenchPanel / drawCallCounter / 型別）被 shaderLab 的
    // runShaderBench、optimization、findings 三方 import；findings/results/*.json 就是
    // 同一個 runner 跑出來原樣存檔的。全站唯一真正的點對點程式碼共用。
    // 中點跟上面那條 Pixi v8 幾乎重疊，標籤推到弧的另一側去。
    { from: 'shaderLab', to: 'findings', resource: 'bench', tone: 'neutral', kind: 'module', labelOffset: -34 },
    // RWD 包住站內每一頁。meta 邊**不畫成線**——scene.ts 把它們畫成一圈框住所有節點的
    // 點狀輪廓（見 drawWrapFrame）。這裡列其餘每一個節點，是為了 hover RWD 時每一頁都跟著
    // 亮起來（isConnected 吃這份資料）：既然說「每一頁」，就不能只有其中兩頁有反應。
    { from: 'rwd', to: 'crossEngine', resource: 'wraps', tone: 'neutral', kind: 'meta' },
    { from: 'rwd', to: 'findings', resource: 'wraps', tone: 'neutral', kind: 'meta' },
    { from: 'rwd', to: 'shaderLab', resource: 'wraps', tone: 'neutral', kind: 'meta' },
    { from: 'rwd', to: 'configurator', resource: 'wraps', tone: 'neutral', kind: 'meta' },
    { from: 'rwd', to: 'arcade', resource: 'wraps', tone: 'neutral', kind: 'meta' },
];

export function nodeById(id: string): ProjectNode {
    return NODES.find((n) => n.id === id) ?? NODES[0];
}

/**
 * 左下角那塊列的是**技術棧**，不是 render graph 的圖例。
 *
 * 原本放的是圖例（哪條線代表什麼），但它同時混進了節點的識別色（琥珀 WebGL、粉紫 dual），
 * 那兩色在線上根本不存在，而真正存在的 `wraps` 虛線又沒被列出來——數量與顏色都對不上。
 * 更根本的是職責錯位：路人第一眼想知道的是「這個人會什麼」，而全站技術原本只藏在
 * 節點的 tags 裡、要 hover 才看得到。線的意思交給線上本來就有的文字標籤自明。
 *
 * tone 只給**識別色真的對得上**的項目：琥珀＝WebGL/GLSL、紫＝WebGPU/WGSL、藍＝Pixi，
 * 跟節點的雙半弧同一套語彙。其餘留白，不製造新的顏色謎題。
 */
export interface TechItem {
    name: string;
    tone?: Tone;
}

export interface TechGroup {
    /** 組名的 i18n key */
    i18nKey: string;
    items: TechItem[];
}

export const TECH_STACK: TechGroup[] = [
    {
        i18nKey: 'home.tech.render',
        items: [
            { name: 'PixiJS v8', tone: 'pixi' },
            { name: 'Three.js', tone: 'three' },
            { name: 'Babylon.js', tone: 'babylon' },
        ],
    },
    {
        i18nKey: 'home.tech.shader',
        items: [
            { name: 'GLSL', tone: 'glsl' },
            { name: 'WGSL', tone: 'wgsl' },
            { name: 'WebGL', tone: 'glsl' },
            { name: 'WebGPU', tone: 'wgsl' },
        ],
    },
    {
        i18nKey: 'home.tech.frontend',
        // React 有顏色、Zustand 與 TypeScript 沒有：判準是「能不能區分節點」。
        // 這兩個跟著 React 走（有 React 的頁才有 Zustand）或每頁都用，畫上去不帶資訊。
        items: [{ name: 'React', tone: 'react' }, { name: 'Zustand' }, { name: 'TypeScript' }],
    },
    {
        i18nKey: 'home.tech.bench',
        items: [{ name: 'bench' }, { name: 'Frame Time' }, { name: 'Draw Calls' }],
    },
];
