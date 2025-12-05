# DemoMyself - Eric Wu's Game Dev Portfolio

這是一個展示前端遊戲開發技術的專案集合，主要使用 **TypeScript** 進行開發，並整合了 **Babylon.js**、**PixiJS** 與 **Three.js** 等主流渲染引擎。

專案包含多個獨立的 Demo，涵蓋了 3D 博弈遊戲架構、高效能 2D 渲染壓力測試，以及跨引擎整合實驗。

## 🚀 快速開始

### 安裝依賴

```bash
yarn install
# 或
npm install
```

### 啟動開發伺服器

```bash
yarn start
# 或
npm start
```

啟動後請訪問 `http://localhost:8080` (預設埠號依 Webpack 設定而定)。

---

## 📂 專案結構

本專案採用 Monorepo 風格的目錄結構，所有原始碼位於 `src/` 下：

```
src/
├── home/               # 專案入口首頁 (Landing Page)
├── babylonJSDemo/      # Babylon.js 3D 博弈遊戲 Demo
├── pixiJSDemo/         # PixiJS v8 相關實驗與 Demo
│   ├── pixiXthree/     # PixiJS + Three.js 共用 Context 整合範例
│   ├── stressTest2/    # PixiJS 效能壓力測試
│   └── optimization/   # 渲染優化實驗
├── threeJSDemo/        # Three.js 相關 Demo (預留)
└── tools/              # 共用工具函式庫
```

---

## 🎮 Demo 介紹

### 1. 3D Casino Demo (Babylon.js)

位於 `src/babylonJSDemo/`

這是一個採用 **MVC 架構** 開發的 3D 博弈遊戲場景（目標為搶莊二八槓）。展示了完整的遊戲開發流程，包含資源管理、場景建置、物理互動與遊戲邏輯分離。

**主要特色：**

- **MVC 架構**：分離資料 (Models)、邏輯 (Controllers) 與 視覺 (Views)。
- **完整遊戲系統**：包含相機、燈光、音效、動畫、輸入與物理系統的管理 (Managers)。
- **物理引擎整合**：使用 Havok 處理物理互動。

### 2. PixiJS x Three.js Hybrid Demo

位於 `src/pixiJSDemo/pixiXthree/`

這是一個進階的渲染整合實驗，展示如何將 **PixiJS (2D UI)** 與 **Three.js (3D 場景)** 整合在**同一個 WebGL Context** 中。

**技術亮點：**

- **Shared WebGL Context**：讓 PixiJS 直接繪製在 Three.js 的 Canvas 上，無需建立多個 Canvas 重疊，節省記憶體並提升效能。
- **State Management**：解決了兩個引擎共用 Context 時的 WebGL 狀態污染 (State Pollution) 問題（如 Depth Test, Culling, Stencil Buffer 衝突）。
- **Seamless Integration**：3D 場景中的物體可與 2D UI 完美互動，並解決了 Resize 同步與座標轉換問題。

### 3. PixiJS Stress Test

位於 `src/pixiJSDemo/stressTest2/`

針對 PixiJS v8 的效能壓力測試，用於評估在大量物件（如粒子、Sprite）下的渲染效能 (FPS, Draw Calls)。

---

## 🛠 技術堆疊

- **語言**: TypeScript
- **渲染引擎**:
  - [Babylon.js](https://www.babylonjs.com/) (v8.2)
  - [PixiJS](https://pixijs.com/) (v8)
  - [Three.js](https://threejs.org/)
- **物理引擎**: Havok
- **動畫**: GSAP
- **建置工具**: Webpack

## 👤 作者

**Eric Wu** - Senior Game Frontend Engineer
