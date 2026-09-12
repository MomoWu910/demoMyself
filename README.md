# static —— 別的專案 build 出來的靜態產物

這個資料夾裡的東西**原樣複製到 `dist/` 根層**（見 `webpack.config.js` 的 CopyWebpackPlugin），
發佈後就是 `https://momowu910.github.io/demoMyself/<子資料夾>/`。

它存在的理由：有些作品有自己的引擎與建置流程，不可能併進這裡的 webpack。
與其硬整合，不如讓它各自 build、把成品放進來。

| 子資料夾 | 來源 | 怎麼更新 |
|---|---|---|
| `cocos-roulette/` | `~/cocos-lab`（Cocos Creator 3.8.8） | 在 Cocos 編輯器建置 web-mobile，然後跑 `yarn sync:cocos` |

## 為什麼編譯產物進版控

一般來說編譯產物不該進 git。這裡是刻意的例外：

- 發佈走 `gh-pages -d dist`，而 `dist/` 本身不進版控——產物不放這裡就只存在於某一台機器上
- 這幾個作品的建置環境很重（Cocos Creator 是一個幾 GB 的 App），
  CI 上重建的成本遠高於直接存成品
- 它們更新的頻率很低（一個作品 build 幾次而已）
