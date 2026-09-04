/**
 * `admin-check.mjs` 專用的打包入口。
 *
 * 為什麼需要它：驗證腳本要同時碰 ledger、opsConfig、betSlip 與 SlotServer，
 * 而**這幾個模組之間有共用狀態**（ledger 的記憶體快取）。
 * 如果腳本分別 esbuild 打包四次，會得到四份互不相干的模組實例——
 * `record()` 寫進去的注單，`query()` 讀不到，測試會以「查不到資料」的形式失敗，
 * 而那個症狀指向的是錯的地方。
 *
 * 打成同一包就只有一份實例，跟瀏覽器裡的情況一致。
 */
export * as ledger from '../arcade/server/ledger';
export * as opsConfig from '../arcade/server/opsConfig';
export * as betSlip from '../arcade/server/betSlip';
export * as rouletteRules from '../arcade/games/roulette/rules';
export { SlotServer } from '../arcade/server/slotServer';
export { Wallet } from '../arcade/server/wallet';
