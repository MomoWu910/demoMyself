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

旗艦 demo。讓 **PixiJS（2D UI）** 與 **Three.js（3D 場景）** 繪製在**同一個 WebGL Context**，而非疊兩層 Canvas。

**解決的硬問題**
- **共用 Context 的狀態污染**：兩個引擎共用同一 GL Context 時，Depth Test / Culling / Stencil Buffer 等狀態會互相污染導致畫面錯亂——實作中明確管理並還原 GL 狀態。
- **記憶體與效能**：單一 Canvas / Context，省去多 Canvas 疊合的記憶體與合成成本。
- **座標與 Resize 同步**：處理 2D UI 與 3D 場景的座標轉換與 resize 一致性，讓 3D 物體可與 2D UI 無縫互動。
- **物理整合**：搭配 cannon-es 加入物理行為，驗證互動真實感。

### 2. 3D 產品配置器（Babylon.js）— `src/babylonJSDemo/src/configurator/`

以 Babylon.js 打造的 3D 產品 viewer / 材質配置器，聚焦 **PBR 渲染質感**與 **glTF 材質變體**的即時切換。

**工程重點**
- **即時材質變體**：載入內建 `KHR_materials_variants` 的 glTF 模型，即時切換不同配色 / 材質（midnight / beach / street）。
- **IBL 環境光照**：以 prefiltered `.env` 環境貼圖作為 image-based lighting，讓 PBR 材質取得正確的環境反射與環境光（studio 攝影棚質感）。
- **後製管線**：ACES tone mapping、克制的 bloom、FXAA / MSAA、vignette、film grain，選配 SSAO2 環境光遮蔽。
- **柔和陰影**：方向光 blur exponential shadow map，並自動將載入的模型註冊為投影者。
- **轉盤互動**：ArcRotateCamera 自動旋轉（互動時暫停）+ 軌道操作 + HTML overlay 控制面板。

> 渲染質感層（IBL / 陰影 / 後製）抽成可重用的 `EnvironmentManager`、`ShadowManager`、`PostProcessManager`，參數集中在 `config/scene/renderConfig.ts`。

### 3. 渲染效能 Lab（PixiJS v8）— `src/pixiJSDemo/stressTest2/`、`optimization/`

針對 PixiJS v8 的效能壓測：在大量 Sprite / 物件下量測 **FPS 與 Draw Call**（以 stats.js 即時監看），驗證渲染優化手段的實際效益。

---

## 技術堆疊

- **語言**：TypeScript
- **渲染引擎**：Babylon.js v8、PixiJS v8、Three.js
- **3D / 材質**：PBR、IBL（`.env` prefiltered environment）、glTF（KHR_materials_variants）
- **物理**：cannon-es
- **動畫**：GSAP
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
