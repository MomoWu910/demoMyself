# 遊樂場 — `src/arcade/`

站內 [`/arcade.html`](https://momowu910.github.io/demoMyself/arcade.html)。一個大廳、兩款玩法（老虎機、百家樂），**跑在同一個 Pixi `Application`、同一個 ticker、同一份 GPU 記憶體上**。

這一頁的視覺刻意跟站台其他頁不同調——其他頁是冷色極簡加一面水，這裡是暖紫霓虹。共用的仍然是字體與版面節奏。

---

## 為什麼要有這一頁

站內跨頁切換是整頁導覽（`location.href`），瀏覽器會把 document、JS heap、WebGL context 一起丟掉，**隔離是免費的**。但頁內在玩法之間切換沒有這道保險：舊玩法的 texture、每幀 callback、resize 監聽、`setTimeout` 只要漏掉一個，玩個三輪就開始掉幀，而且症狀會出現在**下一個**玩法身上。

所以這一頁做的是三件在單一 demo 裡看不出必要性的事：**資源契約**、**協定層**、**可驗證的數學**。

---

## 分層

分層的判準只有一句：**換玩法時它該不該被重設。**

```text
src/arcade/
├── core/
│   ├── module.ts        玩法模組的契約 + ModuleHost（掛載 / 卸載 / 核對）
│   └── stage.ts         Application、背景層、場景切換
├── net/
│   ├── protocol.ts      共用封包（hello / welcome / balance / error）與 GameId
│   ├── games/*.ts       各玩法自己的封包型別
│   └── fakeSocket.ts    仿 WebSocket 的介面 + 型別註冊表
├── server/
│   ├── wallet.ts        餘額。活在連線之外，跨桌延續的只有它
│   ├── gameServer.ts    玩法 server 的介面
│   ├── slotServer.ts / baccaratServer.ts
│   └── *-check.mjs      驗證腳本（Node 直跑，不進 bundle）
├── common/              籌碼、牌、路圖等跨玩法元件
├── games/<玩法>/        規則、視圖、該玩法的 store
├── lobby/               大廳。跟玩法走同一套契約
└── ui/                  React 殼：HUD、各玩法的面板
```

**元件庫導向**：`common/` 放籌碼、牌、桌面、路圖，玩法只是配方。這才是博弈平台的實際架構——每款各寫一套的話，第三款的成本跟第一款一樣。

**大廳跟玩法走同一套契約**是刻意的。它大可只是 canvas 外的一層選單，但那樣「回到空舞台」這個狀態就永遠不會發生，資源核對也就少了最乾淨的那個對照點。

---

## 資源契約：模組拿不到裸的 `app`

想加每幀邏輯得走 `ctx.frame()`，想長期持有物件得走 `ctx.track()`，全部登記在案，卸載時由 host 統一收回。**寫得出來的路徑就只有會被清乾淨的那一條。**

```ts
export interface ModuleContext {
    readonly root: Container;      // 卸載時整棵連同子節點一起 destroy
    readonly app: Application;     // 借來烘貼圖用，不要存起來
    readonly screen: { width: number; height: number };

    frame(fn: (ticker: Ticker) => void): void;   // 每幀邏輯，卸載時自動移除
    onResize(fn: (w: number, h: number) => void): void;
    track<T extends Disposable>(obj: T, destroyOptions?: DestroyOptions): T;
    onDispose(fn: () => void): void;             // 清 timer、關 socket、kill tween
}
```

剩下的漏洞是模組自己 `new` 出來卻沒 `track` 的東西，所以 host 在卸載後會核對一次，數字顯示在 HUD 上（`tracked` / `leaked` / `tex`）。

**回收順序由外而內**：① 先停每幀邏輯（否則 destroy 到一半 ticker 還在對半死的物件動手）→ ② 跑模組自己的收尾 → ③ 拆場景樹 → ④ 最後才 destroy 登記的資源。

### 這套機制第一次被執行，就抓到真的在漏

契約寫在只有一款玩法的時候，從來沒發生過切換，所以它兩天沒被執行過。大廳做完、第一次能真的切場景，一驗就中：renderer 握著的 texture source 每進出一次就疊一階（1 → 65 → 70 → 75 → 79 → 81），**而 `leaked` 全程回報 0**。

- **根因**：Pixi v8 的 `Texture.destroy()` 預設**不釋放底層的 `TextureSource`**，`Container.destroy({ children: true })` 也不會碰子物件的 texture。destroy 確實被呼叫了，只是沒叫到底。
- **修法兩處**：`ctx.track(source, true)`（烘出來的 atlas）、根容器 `destroy({ children: true, texture: true, textureSource: true })`——第三個才是 GPU 記憶體。
- **基線錯了兩次才對**：Pixi 畫文字會在字體 atlas 開頁，那是全域快取、不該還。開站量一次 → 第一次進出就 +10；每個場景記自己的第一次 → 每款玩法用的字不同、開的頁數也不同，交叉進出時誤報；**記「同場景上一次」的值、比相鄰兩次** → 對。全域快取的增長是一次性的，**真的漏會每進出一次就漲一階，永遠停不下來**。

> 教訓：**寫了驗證機制但沒有觸發它的路徑，跟沒寫一樣。**

---

## 協定層：輸贏的決定權在前端之外

玩法不呼叫 server，中間隔一層仿 WebSocket 的介面。前端連 server 的參考都拿不到，就寫不出「先偷看結果再決定怎麼轉」的程式碼。

- **延遲是真實存在的**：封包帶 180–320ms 的模擬 RTT、握手 420ms。UI 因此被迫處理「按鈕鎖住、轉軸先空轉、不能連按兩次」，而不是寫成同步呼叫、上線才發現整套互動要重做。
- **失敗是常態**：餘額不足、封包錯誤走同一條 error 路徑回來，前端只有一個地方要處理。
- **一條連線＝一張桌**：玩法掛載時開、卸載時關。跨桌延續的只有錢包。
- **型別**：`FakeSocket<G extends GameId>` 配一張 `GameProtocols` 註冊表——玩法端寫 `new FakeSocket('slot', …)`，收發的封包型別就推得出來。執行期路由與編譯期泛型的接縫需要一次 cast，收斂在 `createServer` 一處。

沒有做的是重連與封包佇列——那是真專案的事，這裡做了只會讓重點模糊掉。

---

## 驗證腳本

四支，共 216 項判定。用 Node 直跑，Pixi 與 GSAP 的替身在 `dev/stub-*.mjs`（不進 production bundle）。

```bash
npm run check:slot       # 十萬把取樣 + 21 項：RTP、中獎率、賠付表
npm run check:reel       # 81 項：轉軸時序、停軸落點與順序
npm run check:baccarat   # 50 萬局 + 76 項：補牌表、賠付、莊家優勢
npm run check:road       # 38 項：五張路圖的推算
```

**改了什麼就要重跑哪一支**：`PAYOUTS` / `WEIGHTS` → `check:slot`；`COAST_CELLS` / `SNAP_TIME` / `STOP_STAGGER` / `DIR` / `stopOrder` → `check:reel`。

**`check:baccarat` 的價值在於有外部真值可對**：八副牌的莊家優勢是公開數字（莊 1.06% / 閒 1.24% / 和 8:1 為 14.36% / 對子 11:1 為 10.36%，勝率 45.86 / 44.62 / 9.52）。補牌表抄錯、和局忘了退還莊閒本金、對子看成點數而不是牌面，都會讓數字偏出去；50 萬局實測落在 1 個標準誤內。補牌表是**整張 8×10 攤開來比**，並一併斷言「真的比了 80 格」——防的是迴圈寫錯卻印綠燈。

---

## 兩個反直覺的根因

**① 停軸順序倒置**（左一比左二晚停）

距離驅動的減速段，**起始速度越慢，滑行反而拖越久**：距離固定 10 格，滿速 26 格/秒要 0.63 秒走完，被夾到下限的龜速要 1.05 秒，差距比錯開停軸的 0.22 秒還大。而起轉到等速要 0.48 秒、模擬 RTT 只有 0.18~0.32 秒，所以**第一根軸必然**在還沒加速完時就收到結果，用最慢的速度進滑行、被後面滿速的軸反超。

修法：錯開的延遲改成**從該軸到達等速那一刻起算**（記剩餘時間而不是時刻，避免 Pixi ticker 與 GSAP ticker 兩個時基對不上）。

原本的測試沒抓到，是因為它預設先轉 0.42 秒才給結果——那時早就滿速了。**邊界案例要往「比預期更快」的方向測**，不是只測正常路徑。

**② 路圖把一條長龍當成好幾條**

大路要存成「一欄＝一條龍、長度不受限」，六列是**畫的時候**才有的約束（拖尾在排版階段才做）。三張衍生路（大眼仔 / 小路 / 曱甴路）比對的是「前面第幾條龍有多長」，若照網格欄算，長龍被拖尾切成三欄後整張圖從那裡開始全錯——而且只在出現超過六局同一邊時才發作，隨手測幾局碰不到。

順帶一提，三張衍生路的差別**只有一個數字**：回看幾欄（1 / 2 / 3），判定規則完全一樣；起算點也不必寫特例，`r===0` 需 `c>=k+1`、`r>0` 需 `c>=k`，自然長成賭場說的「大眼仔從大路第二欄第二行開始，若第二欄只有一顆則從第三欄第一行」。

---

## 其他實作筆記

- **轉軸是四個階段的接力**（蓄力 → 加速 → 等速 → 距離驅動減速 → 對齊格線回彈），用一個 `Phase` enum 管，不用多個布林——布林組合會生出不存在的狀態。減速做成**距離驅動**（速度隨已走完的比例衰減，不是隨時間），好處是落點在減速開始的當下就算定，掉幀也不會停歪。
- **符號往下掉**：方向抽成 `DIR` 常數，`offset` 維持「永遠遞增的進度」，只在排版時換算成有號的捲動位置，所以停止落點的算法完全不必管方向。
- **起轉演法與停軸順序做成面板選項**：加新的轉法只要動 `SpinStyle` 與 `SPIN_STYLES` 兩處，UI 會自己長出來。兩者都是純表演——盤面在收到封包當下就定了。
- **canvas 與 DOM 對齊**：下注區在 canvas 裡、操作面板是 DOM。面板高度**要實測**（`ResizeObserver` 量了寫進 store，玩法訂閱它重排），寫死的話總有一種語言 × 玩法 × 視窗寬度的組合會讓注區被蓋掉一半——實測中文 179.9px、英文再高 8px。
- **發牌固定抽 6 張但一局只用 4~6 張**，沒用到的要放回牌靴，否則消耗速度與對子／和局頻率都會偏；換靴要清路圖歷史，且用 `shoeChanged` 旗標而不是讓 client 從 remaining 變大自己推斷。
- **已知且刻意保留**：單筆停軸間隔是 9~15 幀（0.15~0.25 秒）而非齊整的 0.22，來自取整讓滑行距離在 10~11 格間浮動。測試因此拆成「平均不漂移 ±0.03」與「單筆在已知範圍 ±0.08」兩層。

---

## 加一款玩法

1. `net/games/<玩法>.ts` 寫封包型別，在 `fakeSocket.ts` 的 `GameProtocols` 補一列（忘了補會在 `createServer` 的 switch 上編譯失敗）。
2. `server/<玩法>Server.ts` 實作 `handle()`——握手是共用樣板，留在 socket 裡。
3. `games/<玩法>/` 寫規則與視圖，盡量從 `common/` 取用元件。
4. `ui/<玩法>Panel.tsx` 掛進 HUD 的讀數／控制兩個插槽。
5. 大廳卡片與 `ModuleId` 各補一項。
