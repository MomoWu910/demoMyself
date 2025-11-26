# babylon_8_test

## 專案簡介
本專案以 TypeScript 與 BABYLON.js 開發，採用 MVC 架構，目標打造賭場場景的博弈遊戲（如百家樂、slot）。
- 目前以 搶莊二八槓 為主要開發遊戲

## 專案初始化
```bash
yarn install
```
或
```bash
npm install
```

## 啟動方式
```bash
yarn start
```
或
```bash
npm start
```

## 目錄結構與說明

```
├── app.ts                # 專案啟動入口
├── public/               # 靜態資源（index.html等）
├── res/                  # 遊戲素材（音效、模型、貼圖、UI等）
├── src/
│   ├── components/       # 可重用遊戲物件（Mesh、UI元件、卡牌、骰子等）
│   │   ├── cameras/      # 相機元件（如開發相機、玩家相機）
│   │   ├── cards/        # 卡牌元件（如多米諾、麻將）
│   │   ├── chips/        # 籌碼元件
│   │   ├── dealer/       # 荷官元件
│   │   ├── dices/        # 骰子元件（如骰子、骰盅）
│   │   ├── gui/          # GUI 元件（如玩家小卡、按鈕、座位）
│   │   ├── lights/       # 燈光元件（如方向光、半球光、點光源）
│   │   ├── players/      # 玩家元件
│   │   └── scene/        # 場景物件（如桌子、天花板、牆壁）
│   ├── constants/        # 常數、設定、工具
│   │   ├── assets.ts     # 資源鍵值對應
│   │   ├── config.ts     # 配置檔案
│   │   ├── enums.ts      # 列舉類型
│   │   ├── interfaces.ts # 介面定義
│   │   └── utils.ts      # 工具函數
│   ├── controllers/      # 遊戲流程控制（如發牌、下注、結算）
│   ├── engine/           # 物理引擎相關邏輯
│   ├── managers/         # 管理系統（如燈光、模型、UI）
│   │   ├── animationManager.ts # 動畫管理
│   │   ├── audioManager.ts     # 音效管理
│   │   ├── chipsManager.ts     # 籌碼管理
│   │   ├── guiManager.ts       # GUI 管理
│   │   ├── inputManager.ts     # 輸入管理
│   │   ├── interactManager.ts  # 互動管理
│   │   ├── lightsManager.ts    # 燈光管理
│   │   ├── modelsManager.ts    # 模型管理
│   │   ├── physicsManager.ts   # 物理管理
│   │   └── rayManager.ts       # 射線管理(目前用在gui元件互動)
│   ├── models/           # 資料模型（如玩家、遊戲狀態）
│   ├── states/           # 狀態機管理（遊戲階段切換）
│   └── views/            # 場景與視覺呈現（BABYLON.js場景、UI）
├── package.json            # 專案依賴與腳本
├── tsconfig.json           # TypeScript 設定
├── webpack.config.js       # Webpack 設定
```

## 主要技術
- TypeScript
- BABYLON.js
- Webpack
- Yarn / npm

## 開發建議
- 依照 MVC 架構分離資料、邏輯、視覺，方便擴充與維護。
- 遊戲物件請盡量模組化，方便重用。

---

