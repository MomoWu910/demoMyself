# 3D Product Configurator (Babylon.js)

以 Babylon.js 打造的即時 3D 產品配置器，聚焦 PBR 渲染質感、即時可配置性，以及**由模型結構長出來的 UI**。
完整的工程論述在[根 README](../../README.md)。

## 重點

- **model-agnostic UI**：部件**依材質分組**自動產生——單椅長出 fabric / wood / metal 三個部件，單一材質的球鞋則整段隱藏。換模型免改程式。體積佔比小於 1% 的部件（品牌標籤、螺絲）會被濾掉：能配置卻看不到效果的選項，比沒有更糟。
- **多模型切換**：球鞋 ⇄ 單椅。glb 走 `asset/resource` 不進 bundle，切到誰才 fetch；先載新的、就緒後才 dispose 舊的，換模型時畫面沒有空窗。
- **表面細節兩種來源**：法線與粗糙度可切「自寫 GLSL 程序生成」或「CC0 掃描貼圖」，面板顯示兩者**量到的**取得成本（下載量、首次準備耗時）。兩者都只 bake 一次、每幀成本相同——所以不顯示 FPS，那會暗示不存在的效能差異。
- **即時材質配置**：質感 preset（Matte / Leather / Glossy / Metallic）+ 顏色 tint + glTF `KHR_materials_variants` colorway 變體。
- **即時打光**：打光 preset（柔光棚 / 戲劇側光 / 電商白）+ 環境光強度 / 旋轉、主光強度 / 色溫滑桿 + 背景切換（studio / 漸層 / 深色 / 純白）。
- **可分享、可匯出**：整組設定編成人看得懂的網址；五個機位 preset；匯出 2 倍解析度 PNG（讀 canvas 而非 RTT，才留得住 post-process）。
- **IBL 環境光照**：prefiltered `.env` 環境貼圖（studio 攝影棚質感）。
- **後製管線**：ACES tone mapping、bloom、FXAA / MSAA、vignette、film grain、SSAO2。
- **柔和陰影** + **ArcRotateCamera 轉盤** + **React 19 + Zustand 控制面板**（canvas 外歸 React、canvas 內歸 Babylon，兩邊只透過 store 溝通）。

## 結構

```text
src/
├── configurator/
│   ├── index.tsx               # 進入點：初始化舞台、灌 store、掛 React 面板、同步網址
│   ├── configuratorView.ts     # 場景：相機／機位、光照、載入與換模型、變體、截圖
│   ├── materialConfigurator.ts # 依材質分組成部件 + 質感 preset / 顏色 tint / 表面貼圖
│   ├── products.ts             # 可切換的模型清單（含各自的朝向修正）
│   ├── surfaceDetail.ts        # 表面細節兩種來源 + 取得成本量測
│   ├── surfaceShader.ts        # 程序生成法線／粗糙度的 GLSL（三種紋理 × 兩種輸出）
│   ├── store.ts                # Zustand 單一狀態來源（每個 action 同時把狀態套進場景）
│   ├── share.ts                # 設定 ⇄ 網址
│   ├── capture.ts              # PNG 匯出（檔名帶設定）
│   ├── ui/Panel.tsx            # React 控制面板（面板是 store 的投影）
│   └── index.html              # canvas + 玻璃擬態外殼 + 載入畫面
├── managers/                 # 可重用渲染質感層
│   ├── environmentManager.ts # IBL 環境貼圖 + skybox + ACES tone mapping
│   ├── shadowManager.ts      # 柔和陰影（自動註冊投影者）
│   └── postProcessManager.ts # DefaultRenderingPipeline + SSAO2
├── config/scene/renderConfig.ts  # 渲染參數集中設定
└── constants/assets.ts       # 資產鍵（環境貼圖）
```

模型與貼圖的出處與授權見 `res/models/CREDITS.md`、`res/textures/CREDITS.md`。

## 執行

從專案根目錄 `yarn start`，開啟 `http://localhost:8080/configurator.html`。
