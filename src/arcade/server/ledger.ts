import type { GameId } from '../net/protocol';
import * as audit from './auditLog';
import { can } from './auth';
import { AUDIT_GAME_LABEL, OPS_CHANNEL, type OpsMessage } from './opsChannel';
import { drop, hydrate, persist } from './storage';
import { record as recordTx } from './txLedger';

/**
 * 注單流水帳：**遊戲產生的每一筆下注，在這裡留下一筆不會被改的紀錄。**
 *
 * 這一層原本不存在——四款玩法各自算完賠付、更新錢包，然後那一局就消失了。
 * 對玩家來說夠用（他只在意現在有多少錢），但**營運端要的東西完全不同**：
 * 昨天這款遊戲賠了多少、某個玩家是不是一直押同一個對沖組合、
 * 三天前那局爭議單當時的餘額是多少。這些問題錢包答不出來，
 * 因為錢包只有「現在」，沒有「發生過什麼」。
 *
 * 所以注單表的第一個設計原則是 **append-only**：只增不改。
 * 結算錯了要開一筆沖正單，不是回頭去改原本那筆——原本那筆是證據。
 *
 * ---
 *
 * **為什麼欄位裡要存餘額前後？**
 * 對帳用。玩家來客訴「我明明有 500 為什麼押不下去」的時候，
 * 要能重建那一刻的錢包狀態，而不是只看得到現在的餘額。
 * 這個欄位是冗餘的（理論上可以從頭累加算出來），
 * 但**對帳資料就是要冗餘**，不然出事的時候沒有第二個來源可以互相驗證。
 *
 * **為什麼有效投注要跟下注額分開？**
 * 輪盤同時押紅跟黑，下注額是兩份，但風險幾乎是零。
 * 抽水跟返水如果照下注額算，這種對沖注就變成穩賺的套利。
 * 所以「有效投注」是另一個數字，由玩法自己決定怎麼算。
 * 這個 demo 的計法很簡化（見各 server 的呼叫點），但**欄位要在**——
 * 這是那種一開始沒留、之後補起來要動整張表的欄位。
 */

/** 一筆注單。欄位順序照真實後台的閱讀習慣排：識別 → 內容 → 金額 → 狀態 → 時間 */
export interface BetRecord {
    /** 注單號。demo 用時間戳 + 序號，真實系統會是全域唯一的發號器 */
    id: string;
    /**
     * 寫入序號。**排序的第二把鑰匙。**
     *
     * 同一局的多筆注單結算時間完全相同——百家樂押莊又押閒是一次結算，
     * 三筆注單的 `settledAt` 一模一樣。
     *
     * JavaScript 的 `sort` 從 ES2019 起是**穩定**的，所以這不會弄丟資料；
     * 問題在方向：穩定的意思是「相等的鍵維持輸入順序」，
     * 而輸入順序是寫入先後（舊的在前）。於是**按時間降序查詢的時候，
     * 同一毫秒裡最先寫入的那筆會排在最前面**，而使用者要的是最後寫入的那筆。
     *
     * 這個 bug 是寫測試時被咬到的：連續寫兩筆沖正交易，
     * 取「最新的那一筆」拿到的卻是先寫的那筆。畫面上的症狀會是
     * 「明細的第一列不是我剛剛做的那個動作」——很容易被當成沒有存檔。
     *
     * 真實系統靠資料庫的自增主鍵解決，這裡自己維護一個。
     */
    seq: number;
    /** 局號。同一局裡的多筆注單共用，注單查詢要能用它把一局撈齊 */
    roundId: string;
    game: GameId;
    /**
     * 玩家識別。這個 demo 只有一個玩家，但欄位一定要在——
     * 少了它，之後要支援多玩家就得動整張表跟所有查詢
     */
    player: string;
    /** 注別。老虎機是 'spin'，百家樂是 'banker'/'player'/'tie'，輪盤是注別 key */
    betType: string;
    /** 下注額 */
    stake: number;
    /** 有效投注。對沖注要打折，見檔頭說明 */
    validStake: number;
    /** 派彩總額（**含本金返還**）。沒中就是 0 */
    payout: number;
    /** 淨輸贏 = payout − stake。正數是玩家贏，負數是平台贏 */
    net: number;
    balanceBefore: number;
    balanceAfter: number;
    /** 結算狀態。demo 只會產生 settled，欄位留著是因為爭議單要能標記 */
    status: 'settled' | 'void';
    betAt: number;
    settledAt: number;
}

/** 注單查詢的條件。**這組參數是照「送給後端」的形狀設計的**，理由見 query() */
export interface LedgerQuery {
    game?: GameId | 'all';
    /**
     * 只看某個玩家。**玩家頁與風控查詢的地基**——
     * 沒有這個條件，「調出這個帳號的所有注單」就得把全站的注單撈回前端再過濾
     */
    player?: string;
    /** 只看某一局。點開一筆注單要看「同一局還押了什麼」時用 */
    roundId?: string;
    /**
     * 結算狀態。預設 `'all'`——**明細要看得到作廢單**，它是爭議處理的證據。
     *
     * 注意這跟 `stats()` 不一致：報表一律排除作廢單。
     * 這個不對稱是刻意的，理由見 `stats()` 的說明。
     */
    status?: BetRecord['status'] | 'all';
    /** 時間區間（毫秒時間戳），開區間都可省略 */
    from?: number;
    to?: number;
    /** 下注額下限，用來找大額注單 */
    minStake?: number;
    /** 只看贏的／只看輸的 */
    outcome?: 'all' | 'win' | 'loss';
    sortBy?: 'settledAt' | 'stake' | 'net';
    sortDir?: 'asc' | 'desc';
    /** 從 0 起算 */
    page?: number;
    pageSize?: number;
}

/** 查詢結果。**分頁一定要回總數**，否則前端算不出有幾頁 */
export interface LedgerPage {
    rows: BetRecord[];
    total: number;
    page: number;
    pageSize: number;
}

/** 彙總統計。儀表板用 */
export interface LedgerStats {
    count: number;
    totalStake: number;
    totalValidStake: number;
    totalPayout: number;
    /** 平台的淨收益 = 總下注 − 總派彩。正數代表平台贏 */
    grossWin: number;
    /**
     * 實際派彩率 = 總派彩 ÷ 總下注。
     *
     * 這個數字要跟遊戲設定的 RTP 比對。短期會偏離很遠（那是變異數不是有問題），
     * 局數夠多才會往設定值收斂——**這正是營運報表最容易被誤讀的地方**：
     * 一天的數字偏低就以為機台有問題，其實只是樣本不夠。
     */
    payoutRate: number;
    /**
     * 下注額的平方和。**這個欄位只有一個用途：算有效樣本數**
     * （見 admin/baseline.ts 的 `effectiveSample`）。
     *
     * 派彩率是按金額加權的平均，所以判斷它「偏離得算不算多」時，
     * 該用的樣本量不是注單筆數，而是 (Σstake)²/Σstake²。
     * 這個數在資料層算，是因為它要跟總和走同一趟迴圈——
     * 讓前端拿全部注單回去自己平方加總，正是這一層存在要避免的事。
     */
    totalStakeSq: number;
    byGame: Record<string, { count: number; stake: number; stakeSq: number; payout: number }>;
    /**
     * 按玩家彙總。**玩家排行、大戶監控、對沖偵測全部從這裡長出來。**
     *
     * 這裡多帶了 `validStake`，因為玩家維度最有用的一個指標是
     * **有效投注比 = 有效投注 ÷ 下注額**：正常玩家接近 1，
     * 押莊又押閒的對沖客會掉到 0.2 以下。這個比值不用另外算模型，
     * 它是既有欄位相除就得到的，而且**它是返水成本的直接來源**。
     *
     * 幾十個玩家的規模下，在這裡一次算完比讓前端逐人查詢便宜得多。
     * 真實系統上百萬個帳號時，這支要換成資料庫的 GROUP BY 加上時間區間的物化表。
     */
    byPlayer: Record<string, {
        count: number;
        stake: number;
        validStake: number;
        payout: number;
        /** 最後一筆注單的結算時間。「這個帳號多久沒來了」是留存的第一個問題 */
        lastAt: number;
    }>;
}

// 儲存位置與遷移都搬到 storage.ts 了（見那支檔案的 LEGACY_KEY）
/**
 * 保留上限。localStorage 通常只有 5MB，一筆注單 JSON 大約 250 bytes。
 *
 * 這個數字從 8000 提到 20000，是因為展示資料從「7 天、1 個玩家」擴到
 * 「30 天、40 個玩家」——**而玩家維度一加進來，需要的樣本量就不是等比例增加的**：
 * 要看得出某個帳號的行為異常，那個帳號自己就得有夠多的注單，
 * 不是全站總筆數夠就好。
 *
 * 實測 30 天種子約 1.3 萬筆、JSON 約 3.4MB，仍在 5MB 之內但已經沒有很多餘裕。
 * 再往上加就該換 IndexedDB 了——localStorage 是同步 API，
 * 檔案再大下去，每次寫注單都會卡住主執行緒。
 *
 * 真實系統不會有這個問題（注單在資料庫裡，舊的搬去冷儲存），
 * 這個常數存在純粹是因為 demo 把「資料庫」放在瀏覽器裡。
 */
const MAX_ROWS = 20000;

/**
 * 這個 demo 的玩家識別。
 *
 * ⚠️ **已經搬到 `players.ts` 的 `SELF_ID`**，這裡只留一個轉出。
 *
 * 搬家的理由值得記一筆：這個常數原本住在注單表裡，因為當時「玩家」只是注單的一個欄位。
 * 等到真的有了玩家名冊，它就該住在名冊那邊——**注單表不該是「玩家是誰」的權威來源**，
 * 它只是引用了一個 id。留在這裡會變成兩個模組各自宣稱自己知道玩家是誰。
 */
export { SELF_ID as PLAYER_ID } from './players';

/**
 * 頻道與訊息型別都搬到 `opsChannel.ts` 了，這裡只轉出。
 *
 * 搬家是為了解開相依循環：注單作廢要開一筆沖正交易，
 * 於是 ledger 得匯入 txLedger，而 txLedger 早就匯入了這裡的 OPS_CHANNEL。
 * 詳見 opsChannel.ts 的檔頭。
 */
export { OPS_CHANNEL, type OpsMessage } from './opsChannel';

let cache: BetRecord[] | null = null;
let seq = 0;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(rows: BetRecord[]) => void>();

/**
 * 惰性取得廣播頻道。
 *
 * 包在 try/catch 裡是因為**驗證腳本會在 Node 底下 import 到玩法 server**
 * （見 package.json 的 check:* 系列），那個環境沒有 BroadcastChannel 也沒有 localStorage。
 * 少了這層保護，跑一次 `yarn check:slot` 就會在 import 階段炸掉。
 */
function getChannel(): BroadcastChannel | null {
    if (channel) return channel;
    try {
        channel = new BroadcastChannel(OPS_CHANNEL);
        channel.onmessage = (ev: MessageEvent<OpsMessage>) => {
            const msg = ev.data;
            if (msg?.kind === 'bets') {
                /**
                 * 別的分頁寫進來的注單，直接**接在快取後面**。
                 *
                 * localStorage 時代這裡是把快取設成 null、下次查詢再重讀——
                 * 因為那時候重讀是同步的，什麼時候讀都拿得到完整資料。
                 * **換成 IndexedDB 之後那個寫法會變成災難**：快取一旦設成 null，
                 * 同步的 `load()` 就只能回空陣列，於是後台側欄的注單總數
                 * 在遊戲那端下第一注的瞬間變成 0。
                 * （這個 bug 真的發生了，而且畫面上看起來像「資料被清掉了」。）
                 *
                 * 改成 append 是對的，不只是比較快：注單表是 append-only，
                 * 而廣播帶的正好是剛寫進去的那幾筆，順序就是寫入順序。
                 *
                 * opsChannel 不認識 BetRecord（它是相依圖的葉節點，不該知道任何一張表的內容），
                 * 所以型別在這裡收斂。**斷言只出現在邊界上**是刻意的。
                 */
                const rows = msg.rows as BetRecord[];
                cache = load().concat(rows);
                for (const r of rows) {
                    if (r.seq >= seq) seq = r.seq + 1;
                }
                for (const fn of listeners) fn(rows);
            } else if (msg?.kind === 'bets.void') {
                // 作廢改的是既有那一列的狀態，不是新增——併不進來，只能重讀。
                // 重讀是非同步的，所以通知訂閱者要等它完成，否則畫面會先用舊資料重繪一次
                void init().then(() => {
                    for (const fn of listeners) fn([]);
                });
            } else if (msg?.kind === 'cleared') {
                cache = [];
                for (const fn of listeners) fn([]);
            }
        };
    } catch {
        channel = null;
    }
    return channel;
}

/**
 * 從持久層灌進記憶體。**啟動時 await 一次**（見 admin/index.tsx 的 bootstrap）。
 *
 * 沒呼叫的話 `load()` 會回空陣列——那正是驗證腳本要的行為：
 * Node 底下沒有 IndexedDB 也沒有 localStorage，本來就從空的開始。
 */
export async function init(): Promise<void> {
    cache = await hydrate<BetRecord>('ledger');
    // 序號接續既有資料。重新整理之後寫的注單，序號不能比重整前的還小，
    // 否則新注單會排到舊注單前面去
    for (const r of cache) {
        if (r.seq >= seq) seq = r.seq + 1;
    }
}

function load(): BetRecord[] {
    // **讀取永遠是同步的。** 持久層是非同步的，但它只在啟動時被等一次，
    // 之後這裡讀的都是記憶體（理由見 server/storage.ts 的檔頭）
    return (cache ??= []);
}

function save(rows: BetRecord[]): void {
    // **記憶體永遠是完整的那一份，而且先更新。**
    // 持久化失敗是儲存層的問題，不該讓這次工作階段的資料跟著消失。
    //
    // 原本的寫法把「配額爆了就砍一半」的結果也寫回 cache，結果是——
    // 只要 localStorage 不可用（Node 驗證腳本、無痕視窗、停用網站資料），
    // **每寫一次注單就把記憶體裡的資料砍掉一半**。
    // 那個 bug 在正常瀏覽器裡完全看不出來，是 `yarn check:admin` 抓出來的：
    // 寫入 5 筆卻只查得到 2 筆。
    //
    // 換成 IndexedDB 之後連「砍一半重試」都不需要了：容量大了兩個量級，
    // 而降級邏輯集中在 storage.ts 一個地方。
    cache = rows;
    persist('ledger', rows);
}

/** 產生注單號。時間戳 + 序號，同一毫秒內連開多筆也不會撞號 */
function nextId(now: number): string {
    seq += 1;
    return `${now.toString(36)}-${(seq % 100000).toString(36).padStart(4, '0')}`;
}

/** 產生局號。同一局的多筆注單要共用它 */
export function newRoundId(game: GameId, now = Date.now()): string {
    return `${game}-${now.toString(36)}`;
}

/** 寫入注單。**這是唯一的寫入口**，玩法 server 都走這裡 */
export function record(entries: Omit<BetRecord, 'id' | 'seq' | 'status'>[]): BetRecord[] {
    if (!entries.length) return [];
    const now = Date.now();
    const rows: BetRecord[] = entries.map((e) => ({ ...e, id: nextId(now), seq: seq, status: 'settled' as const }));

    const all = load().concat(rows);
    // 超過上限就砍最舊的
    save(all.length > MAX_ROWS ? all.slice(all.length - MAX_ROWS) : all);

    getChannel()?.postMessage({ kind: 'bets', rows } satisfies OpsMessage);
    for (const fn of listeners) fn(rows);
    return rows;
}

/**
 * 查詢注單。
 *
 * **這個函式刻意寫成「後端該做的事」的形狀**：篩選、排序、分頁全部在這裡做完，
 * 只回一頁的資料加上總數。前端拿到 rows 就直接畫，不再過濾。
 *
 * 在 demo 裡這看起來是多餘的——資料就在同一支程式的記憶體裡，
 * 前端自己 filter 也一樣。但真實的注單表是百萬列起跳，
 * **「先全部撈回前端再過濾」在那個量級是直接讓瀏覽器死掉的做法**，
 * 而這種寫法在資料量小的時候完全看不出問題，等資料長大才爆。
 * 所以形狀從一開始就照對的來，之後把這支函式換成 API 呼叫，前端一行都不用改。
 */
export function query(q: LedgerQuery = {}): LedgerPage {
    const {
        game = 'all',
        player,
        roundId,
        status = 'all',
        from,
        to,
        minStake,
        outcome = 'all',
        sortBy = 'settledAt',
        sortDir = 'desc',
        page = 0,
        pageSize = 25,
    } = q;

    let rows = load();

    if (game !== 'all') rows = rows.filter((r) => r.game === game);
    if (player) rows = rows.filter((r) => r.player === player);
    if (roundId) rows = rows.filter((r) => r.roundId === roundId);
    if (status !== 'all') rows = rows.filter((r) => r.status === status);
    if (from != null) rows = rows.filter((r) => r.settledAt >= from);
    if (to != null) rows = rows.filter((r) => r.settledAt <= to);
    if (minStake != null) rows = rows.filter((r) => r.stake >= minStake);
    if (outcome === 'win') rows = rows.filter((r) => r.net > 0);
    else if (outcome === 'loss') rows = rows.filter((r) => r.net < 0);

    // 排序前先複製：load() 回的是快取本體，就地排序會把儲存順序也改掉，
    // 而儲存順序是「寫入先後」，那是注單表唯一不該被查詢條件動到的東西
    const sorted = rows.slice().sort((a, b) => {
        // 主鍵相等時用寫入序號決勝，而且**方向要跟主鍵一致**。
        // 少了這一段，同一毫秒的注單在降序查詢時會是「最舊的排最前面」——
        // 因為 sort 是穩定的，相等的鍵維持的是寫入順序（見 BetRecord.seq）
        const d = a[sortBy] - b[sortBy] || a.seq - b.seq;
        return sortDir === 'asc' ? d : -d;
    });

    const total = sorted.length;
    const start = page * pageSize;
    return { rows: sorted.slice(start, start + pageSize), total, page, pageSize };
}

/** 彙總。條件跟 query 共用，所以報表跟明細**永遠是同一組篩選算出來的** */
export function stats(q: LedgerQuery = {}): LedgerStats {
    // 借用 query 的篩選但不分頁：pageSize 給一個大數，避免兩邊的篩選邏輯各寫一份而走鐘
    //
    // **作廢的注單一律排除，而且是寫死的不是預設值。**
    //
    // 這是報表與明細唯一該不一致的地方：一筆被作廢的注單在明細裡必須看得到
    // （它是爭議處理的證據，連同沖正交易一起構成完整的來龍去脈），
    // 但它**不該進任何一個統計數字**——派彩率、平台淨收、有效投注，
    // 算進去的話報表就在描述一件已經被推翻的事。
    //
    // 寫死而不是給呼叫端選，是因為「不小心把作廢單算進報表」這種錯誤
    // 在畫面上完全看不出來，只有對帳的時候才會發現差了幾百塊。
    const all = query({ ...q, status: 'settled', page: 0, pageSize: Number.MAX_SAFE_INTEGER }).rows;

    const byGame: LedgerStats['byGame'] = {};
    const byPlayer: LedgerStats['byPlayer'] = {};
    let totalStake = 0;
    let totalStakeSq = 0;
    let totalValidStake = 0;
    let totalPayout = 0;

    for (const r of all) {
        totalStake += r.stake;
        totalStakeSq += r.stake * r.stake;
        totalValidStake += r.validStake;
        totalPayout += r.payout;
        const g = (byGame[r.game] ??= { count: 0, stake: 0, stakeSq: 0, payout: 0 });
        g.count++;
        g.stake += r.stake;
        g.stakeSq += r.stake * r.stake;
        g.payout += r.payout;

        const p = (byPlayer[r.player] ??= { count: 0, stake: 0, validStake: 0, payout: 0, lastAt: 0 });
        p.count++;
        p.stake += r.stake;
        p.validStake += r.validStake;
        p.payout += r.payout;
        // 取最大值而不是「最後一筆」：`query()` 的結果順序跟著排序條件走，
        // 假設它是時間序的話，換一個排序這個欄位就悄悄變成別的意思
        if (r.settledAt > p.lastAt) p.lastAt = r.settledAt;
    }

    return {
        count: all.length,
        totalStake,
        totalStakeSq,
        totalValidStake,
        totalPayout,
        grossWin: totalStake - totalPayout,
        payoutRate: totalStake > 0 ? totalPayout / totalStake : 0,
        byGame,
        byPlayer,
    };
}

/**
 * 作廢一筆注單（爭議單處理）。
 *
 * ---
 *
 * **注單是 append-only 的，那為什麼可以改？**
 *
 * 改的是**狀態**，不是金額。`settled → void` 是狀態推進，
 * 跟提領從「待審」變成「放行」是同一類事情——
 * 而金額、注別、時間、餘額前後這些欄位一個都不動，因為它們是發生過的事實。
 *
 * **錢怎麼調回去？開一筆沖正交易，不是改注單。**
 *
 * 作廢的財務效果是「這一局不算」：玩家贏了就收回，輸了就退還，
 * 也就是 `-net`。這筆調整走 `txLedger`，關聯回原注單號。
 * 於是帳上留下的是一條完整的線：原始注單（作廢）→ 沖正交易 → 稽核紀錄，
 * **三份文件互相指得回去**，而不是一筆被改過所以說不清楚的舊紀錄。
 *
 * @param reason 作廢原因。**必填**——沒有原因的作廢單在爭議升級時無法辯護
 */
export function voidBet(id: string, reason: string): BetRecord | undefined {
    if (!can('bet.void')) return undefined;
    if (!reason.trim()) return undefined;

    const rows = load();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return undefined;
    const target = rows[idx];
    // 已經作廢的不能再作廢一次。第二次的沖正交易會把錢重複調一遍
    if (target.status !== 'settled') return undefined;

    const next: BetRecord = { ...target, status: 'void' };
    const copy = rows.slice();
    copy[idx] = next;
    save(copy);

    const now = Date.now();
    const amount = -target.net;
    if (amount !== 0) {
        recordTx([{
            player: target.player,
            kind: 'adjust',
            amount,
            balanceBefore: target.balanceAfter,
            balanceAfter: target.balanceAfter + amount,
            status: 'done',
            ref: target.id,
            note: `注單作廢沖正：${reason}`,
            createdAt: now,
            reviewedAt: now,
        }]);
    }

    audit.record({
        action: 'bet.void',
        target: target.id,
        targetLabel: `${AUDIT_GAME_LABEL[target.game]} ${target.roundId}`,
        changes: [{ field: 'status', label: '注單狀態', before: '已結算', after: '已作廢' }],
        note: `${reason}${amount !== 0 ? `（沖正 ${amount > 0 ? '+' : ''}${amount}）` : '（金額為零，未開立沖正單）'}`,
        at: now,
    });

    getChannel()?.postMessage({ kind: 'bets.void', id } satisfies OpsMessage);
    for (const fn of listeners) fn([next]);
    return next;
}

/** 訂閱注單寫入（自己這一頁寫的、或別的分頁廣播過來的都會通知） */
export function subscribe(fn: (rows: BetRecord[]) => void): () => void {
    getChannel();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 清空。後台的「清除資料」用，會廣播讓遊戲那一頁也知道 */
export function clear(): void {
    cache = [];
    drop('ledger');
    getChannel()?.postMessage({ kind: 'cleared' } satisfies OpsMessage);
}

/** 目前筆數。種子資料要判斷「空的才灌」 */
export function count(): number {
    return load().length;
}
