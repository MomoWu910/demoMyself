# Interactive 3D & Cross-Engine Frontend Demos

> TypeScript 打造的高互動前端技術作品集——聚焦複雜前端最難的部分：**跨引擎渲染整合**、**即時 3D / PBR 渲染**，以及**可重現的渲染效能分析**（量出來的，不是講出來的）。

🔗 **線上 Demo**：https://momowu910.github.io/demoMyself/

<!-- [TODO 截圖] 放 1 張跨引擎 demo 或產品配置器主視覺（建議寬版）。 -->

---

## 關於這個作品集

我有 6 年高互動前端（TypeScript + Canvas / WebGL）開發資歷。這個作品集把長年累積的**即時渲染、複雜狀態與效能**能力，延伸到 **3D 與引擎底層整合**領域，做成幾個聚焦的技術驗證——重點不在功能多寡，而在每個 demo 各自解掉一個前端較少人碰、但有難度的問題。

---

## Demo 一覽

### 1. 跨引擎渲染整合：PixiJS × Three.js 共用 WebGL Context — `src/pixiJSDemo/pixiXthree/`

旗艦 demo，一個互動物理沙盒。讓 **PixiJS（2D HUD）** 與 **Three.js（3D 物理場景）** 繪製在**同一個 WebGL Context**，而非疊兩層 Canvas。拖曳可傾斜容器讓物件滾動，2D HUD 疊在 3D 上即時顯示 FPS / Draw Call / 物件數，並提供 Add / Shake / Reset / Gravity 控制。

**解決的硬問題**
- **共用 Context 的狀態污染**：兩個引擎共用同一 GL Context 時，Depth Test / Culling / Stencil / Scissor / Framebuffer 等狀態會互相污染導致畫面錯亂——每幀明確還原 GL 狀態，並呼叫各自的 `resetState()` 才交棒給對方繪製。
- **記憶體與效能**：單一 Canvas / Context，省去多 Canvas 疊合的記憶體與合成成本。
- **Resize 與 DPI 一致性**：兩個 renderer 共用同一解析度（retina 下統一 DPR），避免各自縮放造成畫面溢出；矮視窗（手機橫向）以 Three `setViewOffset` 將 3D 主體抬離底部按鈕列，不被 HUD 遮擋。
- **物理整合**：搭配 cannon-es，容器為 kinematic body，傾斜時以角速度推動內部剛體（球 / 方塊）做出真實翻滾。

### 2. 3D 產品配置器（Babylon.js）— `src/babylonJSDemo/src/configurator/`

以 Babylon.js 打造的即時 3D 產品配置器，聚焦 **PBR 渲染質感**與**即時可配置性**。

**工程重點**
- **即時材質配置**：切換質感 preset（Matte / Leather / Glossy / Metallic，覆寫 metallic / roughness / clearCoat）、套用顏色 tint，並保留 glTF `KHR_materials_variants` colorway 變體（midnight / beach / street）。
- **即時打光**：3 組打光 preset（柔光棚 / 戲劇側光 / 電商白）+ 環境光強度 / 旋轉、主光強度 / 色溫四條滑桿；背景可切換 studio 天空盒 / 漸層 / 深色 / 純白。
- **model-agnostic UI**：自動掃描模型 sub-mesh——多部件就長出分件（鞋面 / 鞋底…）配置 UI，單一 mesh 則退回整件配置，換模型不用改程式。
- **IBL 環境光照**：以 prefiltered `.env` 環境貼圖作為 image-based lighting，讓 PBR 材質取得正確的環境反射與環境光（studio 攝影棚質感）。
- **後製管線**：ACES tone mapping、克制的 bloom、FXAA / MSAA、vignette、film grain，選配 SSAO2 環境光遮蔽。
- **柔和陰影**：方向光 blur exponential shadow map，並自動將載入的模型註冊為投影者。
- **轉盤互動**：ArcRotateCamera 自動旋轉（互動時暫停）+ 軌道操作 + HTML overlay 玻璃控制面板。
- **行動裝置適配**：控制面板在手機收合為 bottom sheet；相機依面板遮擋量每幀 lerp 上移（`targetScreenOffset.y`）並拉遠 radius，讓主體完整置中於未被面板蓋住的可視區。

> 渲染質感層（IBL / 陰影 / 後製）抽成可重用的 `EnvironmentManager`、`ShadowManager`、`PostProcessManager`，參數集中在 `config/scene/renderConfig.ts`；材質 / 部件掃描邏輯在 `materialConfigurator.ts`。

### 3. 渲染效能實測報告（PixiJS v8）— `src/findings/`、`src/bench/`

重點不是「我做了壓測」，而是「我量出了什麼」。站內 [`/findings.html`](https://momowu910.github.io/demoMyself/findings.html) 是一份**可重現**的技術報告：數據由站內的 benchmark runner 直接產出，原始 JSON 原樣存在 `src/findings/results/`，沒有手動修飾過任何一個數字。

**量測方法**（`src/bench/`）
- **主指標是 CPU frame time 的中位數與 p95，不是 FPS**。vsync 會把 FPS 鎖在螢幕更新率上，輕負載時每個案例都回報 60fps——即使其中一個已經吃掉大半個 frame budget。
- **量測窗口**：Pixi 的 render 掛在 ticker 的 `LOW (-25)`，所以計時器在 `HIGH (25)` 開啟、`UTILITY (-50)` 關閉，一個樣本 = 這一幀完整的 CPU 工作（場景更新 + 指令提交）。
- **暖機**：每個案例先跑 45 幀丟棄（避開 JIT、貼圖上傳、shader 編譯），再取樣 180 幀。
- **誠實標註量不到的**：GPU 光柵化時間在瀏覽器觀測不到（`EXT_disjoint_timer_query` 已被各引擎停用），不報告而不是用猜的；WebGPU 的 draw call 錄在 `GPURenderPassEncoder` 上、無等價攔截點，該欄位標 n/a 而不是填 0。

**四條結論**
1. **每物件一個 filter，就是每物件一個 render pass**——tint 只是頂點屬性、幾乎免費（500 個 sprite → 1 個 draw call）；改掛 ColorMatrixFilter 後合批崩潰（→ 1000 個 draw call）。
2. **Draw call 不是全部的真相**——每幀重畫 Graphics 與用預生成貼圖的 Sprite，**draw call 同樣是 1**，CPU 卻差 **6.5 倍**：成本在 CPU 端的三角化（tessellation），不在合批數。只優化「看得到的數字」不等於優化瓶頸。
3. **會變動的 Text 每幀都在重傳貼圖**——逐幀變動的文字（分數 / 計時器 / 傷害數字）一律該用 BitmapText。
4. **同一筆成本，被兩個 backend 記在不同地方**（壓軸）——500 個逐幀變動的 Text，CPU frame time 在 WebGL 是 12.7ms、WebGPU 是 182.2ms，看起來 WebGPU 慘輸 14 倍；但真實幀率剛好相反（3.2 fps vs 5.5 fps）。WebGL 的 `texSubImage2D` 把上傳丟給驅動就返回，大部分成本從沒進入 CPU 量測窗口；WebGPU 同步阻塞在 JS，把整筆帳記在看得見的地方。而這台螢幕是 120Hz、budget 只有 8.3ms——兩邊其實都不及格，只是帳單開在不同地方。**只看單一指標，會讓結論完全反過來。**

> **可重現性**：上述數字經兩次獨立執行交叉驗證，誤差在 2% 以內（WebGPU 的 Text naive：177.9ms / 182.2ms）。那個反直覺的 14 倍落差是穩定現象，不是量測雜訊。

**實驗附件**（結論在前，實驗在後，供人重現）
- **Optimization Lab**（`pixiJSDemo/optimization/`）：三組 A/B 對照（Tint vs Filter、Text vs BitmapText、Sprite vs Graphics），內建 Benchmark Runner——按一次 `Run Benchmark`，就能在自己的硬體上得到自己的數字（可匯出 Markdown / JSON）。
- **Filter 壓力測試**（`pixiJSDemo/stressTest/`）：把結論 1 推到極端，直到 render pass 淹沒 GPU。
- **Super Shiba Mark**（`pixiJSDemo/stressTest2/`）：光譜另一端，10 萬+ Sprite 塞進單一批次，瓶頸從 GPU 移到 CPU-bound 變換。

### 4. RWD Showcase：站內建裝置模擬器 — `src/rwdShowcase/`

全站（含每個 canvas demo 的 HUD）都做了 RWD——任何裝置、任意拖拉視窗都不會爆版。這一頁把它變成可互動的展示：

- **真實 viewport 預覽**：以 iframe 用實際 CSS 尺寸載入本站任一頁面，RWD 斷點反應是真的，不是縮圖。
- **裝置預設集**：iPhone SE / iPhone 15 / iPad / Laptop / Desktop，一鍵直橫向切換。
- **自由拖拉**：拖曳外框右下角手把即時拉出任意尺寸，canvas demo 會跟著即時 resize。
- **效能護欄**：全程僅一個 live iframe（一次只跑一個 WebGL demo）；外框超出舞台時以 `transform: scale` 等比縮放，模擬器本身在手機上也不爆版。

> RWD 驗證方式：Playwright 以 6 種視窗尺寸（375×667 → 1920×1080，含橫向）× 全部 9 頁跑截圖矩陣，自動檢查橫向溢出（`scrollWidth > clientWidth`）與 console error。

---

## 技術堆疊

- **語言**：TypeScript
- **渲染引擎**：Babylon.js v8、PixiJS v8、Three.js
- **效能量測**：自製 benchmark runner（`src/bench/`）— CPU frame time 中位數 / p95、draw call 攔截、環境偵測，可匯出 Markdown / JSON
- **3D / 材質**：PBR、IBL（`.env` prefiltered environment）、glTF（KHR_materials_variants）
- **物理**：cannon-es
- **動畫**：GSAP
- **i18n**：自製輕量中英雙語切換（`src/i18n`，localStorage 持久化）
- **建置 / 部署**：Webpack、gh-pages

---

## 本機執行

```bash
yarn install   # 或 npm install
yarn start     # 啟動後開啟 http://localhost:8080
```

---

## 作者

**Eric Wu** — Frontend Engineer（高互動 / 3D / 複雜 Web 應用）
momowu.works@gmail.com
