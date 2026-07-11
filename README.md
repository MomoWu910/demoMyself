# Interactive 3D & Cross-Engine Frontend Demos

> TypeScript 打造的高互動前端技術作品集——聚焦複雜前端最難的部分：**跨引擎渲染整合**、**即時 3D / PBR 渲染**，以及**渲染效能**。

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
- **Resize 與 DPI 一致性**：兩個 renderer 共用同一解析度（retina 下統一 DPR），避免各自縮放造成畫面溢出。
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

> 渲染質感層（IBL / 陰影 / 後製）抽成可重用的 `EnvironmentManager`、`ShadowManager`、`PostProcessManager`，參數集中在 `config/scene/renderConfig.ts`；材質 / 部件掃描邏輯在 `materialConfigurator.ts`。

### 3. 渲染效能 Lab（PixiJS v8）— `src/pixiJSDemo/`

針對 PixiJS v8 的效能壓測與最佳化，以 stats.js 即時監看 **FPS 與 Draw Call**：
- **Filter 壓力測試**（`stressTest/`）：每物件掛 ColorMatrixFilter 刻意打斷合批，比較 WebGL vs WebGPU 的 render pass 開銷。
- **Super Shiba Mark**（`stressTest2/`）：10 萬+ Sprite 壓測批次渲染器，CPU-bound 變換 vs GPU 光柵化。
- **Optimization Lab**（`optimization/`）：互動比較常見渲染陷阱（Tint vs Filter、Text vs BitmapText、Sprite vs Graphics）與最佳化解法。

### 4. RWD Showcase：站內建裝置模擬器 — `src/rwdShowcase/`

全站（含每個 canvas demo 的 HUD）都做了 RWD——任何裝置、任意拖拉視窗都不會爆版。這一頁把它變成可互動的展示：

- **真實 viewport 預覽**：以 iframe 用實際 CSS 尺寸載入本站任一頁面，RWD 斷點反應是真的，不是縮圖。
- **裝置預設集**：iPhone SE / iPhone 15 / iPad / Laptop / Desktop，一鍵直橫向切換。
- **自由拖拉**：拖曳外框右下角手把即時拉出任意尺寸，canvas demo 會跟著即時 resize。
- **效能護欄**：全程僅一個 live iframe（一次只跑一個 WebGL demo）；外框超出舞台時以 `transform: scale` 等比縮放，模擬器本身在手機上也不爆版。

> RWD 驗證方式：Playwright 以 6 種視窗尺寸（375×667 → 1920×1080，含橫向）× 全部 8 頁跑截圖矩陣，自動檢查橫向溢出（`scrollWidth > clientWidth`）與 console error。

---

## 技術堆疊

- **語言**：TypeScript
- **渲染引擎**：Babylon.js v8、PixiJS v8、Three.js
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
