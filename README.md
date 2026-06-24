# Interactive 3D & Cross-Engine Frontend Demos

> TypeScript 打造的高互動前端技術作品集——涵蓋 **3D 互動場景（Babylon.js）**、**跨引擎渲染整合（PixiJS × Three.js 共用 WebGL Context）**，以及 **2D 渲染效能壓力測試**。聚焦複雜前端最難的部分：架構、即時互動、渲染效能與引擎底層。

🔗 **線上 Demo**：https://momowu910.github.io/demoMyself/

<!-- [TODO 截圖] 這裡放 1 張 3D 場景主視覺（建議寬版、含完整場景）。圖說範例：▲ Babylon.js 3D 互動場景：MVC 架構 + Havok 物理 + 即時輸入互動 -->

---

## 為什麼做這個

我有 6 年高互動前端（TypeScript + Canvas / WebGL）開發資歷。這個作品集是我把長年累積的**複雜狀態管理、即時互動與渲染效能**能力，延伸到 **3D 與跨引擎整合**領域的實作驗證。

其中的 3D 互動場景，主題取自我過去在商用產品上實際開發、上線過的一款多人卡牌/骰子遊戲——我刻意用 3D 重新實作一次，作為深入 3D frontend 工程的載體：重點不在遊戲本身，而在 3D 場景的架構設計、資源管理、物理互動與效能。

---

## Demo 一覽

### 1. 3D 互動場景（Babylon.js）— `src/babylonJSDemo/`

以 **MVC 架構**從零搭建的多人 3D 互動場景，~50 個模組、清楚的職責邊界，模擬接近真實產品的複雜度。

<!-- [TODO 截圖/GIF] 放一段操作 GIF：相機移動 / 卡牌或骰子互動 / GUI 點擊。圖說：▲ 即時輸入 → 射線揀選 → 物理互動的完整互動鏈 -->

**工程重點**
- **MVC 分層**：Models（資料）/ Controllers（流程）/ Views（呈現）職責分離，可擴充、可維護。
- **Manager 化的子系統**：相機、燈光、動畫、音效、輸入、互動、模型、GUI、物理、射線各自獨立成 Manager，模組邊界清楚。
- **狀態機**：以 State Machine 管理場景/流程階段切換（延續我在 2D 即時遊戲的狀態機實踐）。
- **物理互動**：整合 Havok 物理引擎處理骰子等真實物理互動。
- **資源管理**：集中式 asset 管線，統一載入 GLB 模型、貼圖、音效與 GUI 配置。

### 2. 跨引擎整合：PixiJS × Three.js 共用 WebGL Context — `src/pixiJSDemo/pixiXthree/`

進階渲染整合實驗：讓 **PixiJS（2D UI）** 與 **Three.js（3D 場景）** 繪製在**同一個 WebGL Context**，而非疊兩層 Canvas。

**解決的硬問題**
- **共用 Context 的狀態污染**：兩個引擎共用同一 GL Context 時，Depth Test / Culling / Stencil Buffer 等狀態會互相污染導致畫面錯亂——實作中明確管理並還原 GL 狀態。
- **記憶體與效能**：單一 Canvas / Context，省去多 Canvas 疊合的記憶體與合成成本。
- **座標與 Resize 同步**：處理 2D UI 與 3D 場景的座標轉換與 resize 一致性，讓 3D 物體可與 2D UI 無縫互動。
- **物理整合**：搭配 cannon-es 加入物理行為，驗證互動真實感。

### 3. 渲染效能壓力測試 — `src/pixiJSDemo/stressTest2/`、`optimization/`

針對 PixiJS v8 的效能壓測：在大量 Sprite / 物件下量測 **FPS 與 Draw Call**（以 stats.js 即時監看），驗證渲染優化手段的實際效益。

---

## 技術堆疊

- **語言**：TypeScript
- **渲染引擎**：Babylon.js v8、PixiJS v8、Three.js
- **物理**：Havok、cannon-es
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
