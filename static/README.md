# static —— 別的專案 build 出來的靜態產物

這個資料夾裡的東西**原樣複製到 `dist/` 根層**（見 `webpack.config.js` 的 CopyWebpackPlugin），
發佈後就是 `https://momowu910.github.io/demoMyself/<子資料夾>/`。

它存在的理由：有些作品有自己的引擎與建置流程，不可能併進這裡的 webpack。
與其硬整合，不如讓它各自 build、把成品放進來。

| 子資料夾 | 來源 | 怎麼更新 |
|---|---|---|
| `cocos-casino/` | `~/cocos-lab` 的 `06-lobby` 大廳 ＋ 三款玩法（分包） | `cd ~/cocos-lab && yarn build:casino` → `cd ~/demoMyself && yarn sync:cocos casino` |
| `cocos-roulette/` | `~/cocos-lab` 的 `03-roulette` | ⚠️ **沒有建置目標了**，見下 |
| `cocos-slot/` | `~/cocos-lab` 的 `04-slot` | ⚠️ **沒有建置目標了**，見下 |

> ⚠️ **分包之後只剩 `casino` 一個建置目標。**
>
> Bundle 裡的場景不能當主包的起始場景（指定了也沒用，Cocos 會安靜地退回第一個找得到的
> 場景），所以三款玩法不再有各自的建置設定——`build-configs/` 現在只剩 `casino.json`。
>
> `cocos-roulette/` 與 `cocos-slot/` 留著是為了**已經發出去的網址**：裡面是分包前建的
> 產物，自包含、照樣跑得動，但**不會再跟著 cocos-lab 的改動更新**。
> 要看最新的輪盤與老虎機，走 `cocos-casino/` 的大廳進去。

> ⚠️ **`yarn sync:cocos` 一定要帶作品名。** 舊版是「掃描所有 `web-mobile*`，
> 挑最新的那個」——那是為了應付 Cocos 建置面板的亂編號（`web-mobile-001`…）。
> 但現在 cocos-lab 走 CLI 建置、`outputName` 由設定檔寫死，而且同時存在
> 多個作品的產物，「挑最新」會把剛建好的 slot 同步到輪盤的網址去，
> **而且那種錯誤會安靜地成功**。
>
> 另外 Cocos 那邊建置時**編輯器必須完全關閉**（⌘Q），兩個實例會搶 asset-db 的鎖。

## 為什麼編譯產物進版控

一般來說編譯產物不該進 git。這裡是刻意的例外：

- 發佈走 `gh-pages -d dist`，而 `dist/` 本身不進版控——產物不放這裡就只存在於某一台機器上
- 這幾個作品的建置環境很重（Cocos Creator 是一個幾 GB 的 App），
  CI 上重建的成本遠高於直接存成品
- 它們更新的頻率很低（一個作品 build 幾次而已）
