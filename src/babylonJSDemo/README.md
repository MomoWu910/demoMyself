# 3D Product Configurator (Babylon.js)

以 Babylon.js 打造的即時 3D 產品配置器，聚焦 PBR 渲染質感與即時可配置性。

## 重點

- **即時材質配置**：質感 preset（Matte / Leather / Glossy / Metallic）+ 顏色 tint + glTF `KHR_materials_variants` colorway 變體。
- **即時打光**：打光 preset（柔光棚 / 戲劇側光 / 電商白）+ 環境光強度 / 旋轉、主光強度 / 色溫滑桿 + 背景切換（studio / 漸層 / 深色 / 純白）。
- **model-agnostic UI**：自動掃描 sub-mesh，多部件長出分件配置 UI、單一 mesh 退回整件，換模型免改程式。
- **IBL 環境光照**：prefiltered `.env` 環境貼圖（studio 攝影棚質感）。
- **後製管線**：ACES tone mapping、bloom、FXAA / MSAA、vignette、film grain、SSAO2。
- **柔和陰影** + **ArcRotateCamera 轉盤** + **HTML overlay 控制面板**。

## 結構

```text
src/
├── configurator/
│   ├── configuratorView.ts     # 場景：相機、光照、載入模型、變體切換、轉盤
│   ├── materialConfigurator.ts # 掃描 sub-mesh → 部件 / 質感 preset / 顏色 tint 引擎
│   ├── index.ts                # 進入點 + UI 綁定（質感 / 顏色 / 打光 / 背景 / 自動旋轉 / 重置）
│   └── index.html              # canvas + 玻璃擬態控制面板 + 載入畫面
├── managers/                 # 可重用渲染質感層
│   ├── environmentManager.ts # IBL 環境貼圖 + skybox + ACES tone mapping
│   ├── shadowManager.ts      # 柔和陰影（自動註冊投影者）
│   └── postProcessManager.ts # DefaultRenderingPipeline + SSAO2
├── config/scene/renderConfig.ts  # 渲染參數集中設定
└── constants/assets.ts       # 資產鍵（環境貼圖）
```

## 執行

從專案根目錄 `yarn start`，開啟 `http://localhost:8080/configurator.html`。
