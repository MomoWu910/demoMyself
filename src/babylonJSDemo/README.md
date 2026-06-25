# 3D Product Configurator (Babylon.js)

以 Babylon.js 打造的 3D 產品 viewer / 材質配置器，聚焦 PBR 渲染質感與 glTF 材質變體即時切換。

## 重點

- **即時材質變體**：glTF `KHR_materials_variants`，即時切換配色 / 材質。
- **IBL 環境光照**：prefiltered `.env` 環境貼圖（studio 攝影棚質感）。
- **後製管線**：ACES tone mapping、bloom、FXAA / MSAA、vignette、film grain、SSAO2。
- **柔和陰影** + **ArcRotateCamera 轉盤** + **HTML overlay 控制面板**。

## 結構

```text
src/
├── configurator/
│   ├── configuratorView.ts   # 場景：相機、光照、載入模型、變體切換、轉盤
│   ├── index.ts              # 進入點 + UI 綁定（色塊、自動旋轉、重置）
│   └── index.html            # canvas + 玻璃擬態控制面板 + 載入畫面
├── managers/                 # 可重用渲染質感層
│   ├── environmentManager.ts # IBL 環境貼圖 + skybox + ACES tone mapping
│   ├── shadowManager.ts      # 柔和陰影（自動註冊投影者）
│   └── postProcessManager.ts # DefaultRenderingPipeline + SSAO2
├── config/scene/renderConfig.ts  # 渲染參數集中設定
└── constants/assets.ts       # 資產鍵（環境貼圖）
```

## 執行

從專案根目錄 `yarn start`，開啟 `http://localhost:8080/configurator.html`。
