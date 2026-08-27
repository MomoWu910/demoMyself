import { POCKET_COUNT, WHEEL_ORDER } from './rules';

/**
 * 球的軌跡：**結果先定，動畫反推**。
 *
 * 這是這一款在整個遊樂場裡真正新增的東西。老虎機那邊已經證過一次同樣的原則
 * （server 給格位、轉軸演到那裡停住，見 games/slot/reel.ts），但那是一維的：
 * 一條捲軸往下捲，停在某一格。輪盤是**兩個反向旋轉的座標系相減**——
 * 玩家看到的號碼由「球的世界角減掉轉子當下的角度」決定，而那兩個東西都在動。
 *
 * 所以這裡不能用「轉一轉、隨機停」再回頭宣稱那是 server 給的號碼。流程是倒過來的：
 *
 * 1. server 先決定中獎號碼
 * 2. 算出**結束那一刻**轉子會轉到哪個角度（等速，所以是一條直線）
 * 3. 那個號碼的袋位在轉子上的固定角度加上去，得到球該停的**世界角**
 * 4. 反推球要往反方向轉幾圈才會剛好停在那裡
 *
 * 整段運動因此是一個**純函式** `sampleSpin(plan, t)`——同一個 plan 不管在哪一幀取樣、
 * 取樣幾次、掉幀多嚴重，算出來的位置都一樣。這件事有兩個實際好處：分頁切到背景再回來
 * 不會讓球飄到別的格子（沒有累加誤差），以及**它可以在 Node 裡被窮舉驗證**
 * （見 roulette-check.mjs 的「軌跡反解」一節），不必對著畫面數格子。
 */

/** 一個袋位佔多少角度 */
export const POCKET_ANGLE = (Math.PI * 2) / POCKET_COUNT;

/**
 * 轉子的角速度（弧度／秒，正值＝順時針）。
 *
 * 真實輪盤的轉子大約每分鐘轉 20~30 圈，換算過來比這裡快得多。刻意放慢是因為
 * **畫面上的轉子要能被讀**：玩家在下注期會盯著上一局的號碼在哪裡，轉太快就只是一片糊。
 */
export const WHEEL_OMEGA = 0.55;

/** 球至少繞幾圈。少於這個數字就看不出「球在跑」，只像瞬間移動到答案 */
const MIN_TURNS = 5;
/** 起始速度的隨機範圍（多繞 0~3 圈），讓每一局的長度手感不一樣 */
const EXTRA_TURNS = 3;

/**
 * 球從什麼時候開始往內掉（佔總時長的比例）。
 *
 * 0.62 之前球貼著外圈的球道跑，之後才進入落袋段——真實輪盤也是這個節奏：
 * 球在上緣繞很久，速度掉到某個值才會脫離軌道。這個轉折點是整段動畫最有張力的一刻，
 * 太早會讓後段拖沓，太晚則來不及看清楚它掉進哪一格。
 */
const DROP_AT = 0.62;

/** 落袋段撞幾次偏導器。真輪盤的球會在最後彈跳好幾下，一路彈才像球而不像磁鐵 */
const BOUNCES = 3.5;
/** 每次彈跳把球往外拋多少（佔球道到袋位環的距離） */
const BOUNCE_HEIGHT = 0.34;

export interface SpinPlan {
    /** 中獎號碼。球最後一定落在這一格 */
    winning: number;
    /** 這一趟要跑多久（秒） */
    duration: number;
    /** 轉子在 t=0 的角度 */
    wheelStart: number;
    /** 球在 t=0 的世界角 */
    ballStart: number;
    /**
     * 球在整趟裡要轉過的總角度（**負值**，因為球跟轉子反向）。
     *
     * 這個數字就是反解的結果——它被算出來的唯一目的，是讓 `ballStart + ballSweep`
     * 落在中獎袋位的世界角上。
     */
    ballSweep: number;
}

export interface SpinSample {
    /** 轉子當下的角度 */
    wheelAngle: number;
    /** 球當下的世界角 */
    ballAngle: number;
    /**
     * 球在半徑上的位置：1＝外圈球道，0＝袋位環。
     *
     * 落袋段會超過 1（彈跳把它往外拋），所以呼叫端不能假設它落在 [0,1]——
     * 這是刻意的，把彈跳做在半徑上比另外開一個「跳躍高度」欄位單純得多。
     */
    radius01: number;
    /** 球是不是已經落袋（之後它就跟著轉子一起走） */
    settled: boolean;
}

/** 某個號碼的袋位在**轉子座標**上的角度。轉子怎麼轉，它跟著怎麼轉 */
export function pocketAngleOf(n: number): number {
    const index = WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]);
    return index < 0 ? 0 : index * POCKET_ANGLE;
}

/** 反過來：球相對轉子的角度落在哪一格。這是**驗證用**的反函式，也是除錯時最好用的一支 */
export function pocketAtAngle(relative: number): number {
    const norm = wrap(relative + POCKET_ANGLE / 2);
    return WHEEL_ORDER[Math.floor(norm / POCKET_ANGLE) % POCKET_COUNT];
}

/**
 * 排一趟球：給定中獎號碼與此刻的角度，算出球要怎麼跑。
 *
 * `rng` 只影響**手感**（多繞幾圈、跑多久），不影響結果——這是刻意的分工。
 * 隨機性可以留在 client，但它只能決定「怎麼演」，不能決定「演成什麼」。
 */
export function planSpin(
    winning: number,
    duration: number,
    wheelStart: number,
    ballStart: number,
    rng: () => number = Math.random
): SpinPlan {
    const wheelEnd = wheelStart + WHEEL_OMEGA * duration;
    // 球該停的世界角＝轉子結束時的角度 ＋ 那一格在轉子上的固定位置
    const target = wheelEnd + pocketAngleOf(winning);

    // 先取「不足一圈」的那一段（球是反向的，所以取負的餘數），再補上整圈數。
    // 用 wrap 而不是直接相減，是為了讓 sweep 永遠是負的——正的話球會倒著跑回去
    const partial = wrap(target - ballStart) - Math.PI * 2;
    const turns = MIN_TURNS + Math.floor(rng() * (EXTRA_TURNS + 1));

    return {
        winning,
        duration,
        wheelStart,
        ballStart,
        ballSweep: partial - Math.PI * 2 * turns,
    };
}

/**
 * 取樣：這一趟跑到第 `t` 秒時，轉子與球各在哪裡。
 *
 * `t` 超過 `duration` 之後球已經落袋，**它跟著轉子一起轉**——所以這支函式在結算階段
 * 也照樣可以一直呼叫下去，不必另外寫一段「停住之後的畫法」。
 */
export function sampleSpin(plan: SpinPlan, t: number): SpinSample {
    const wheelAngle = plan.wheelStart + WHEEL_OMEGA * t;

    if (t >= plan.duration) {
        // 落袋之後球被轉子帶著走，所以直接從**軌跡的終點**往下接，而不是回頭用
        // 「轉子角 ＋ 袋位角」重算一次。兩者在畫面上等價（差整數圈），但後者會讓
        // `ballAngle` 在落袋那一幀跳掉好幾圈——任何想對這條曲線做速度判斷的人都會被騙到
        return {
            wheelAngle,
            ballAngle: plan.ballStart + plan.ballSweep + WHEEL_OMEGA * (t - plan.duration),
            radius01: 0,
            settled: true,
        };
    }

    const u = Math.max(0, t) / plan.duration;
    return {
        wheelAngle,
        ballAngle: plan.ballStart + plan.ballSweep * ease(u),
        radius01: radiusAt(u),
        settled: false,
    };
}

/**
 * 球的減速曲線。
 *
 * 用四次的 ease-out 而不是線性摩擦（那會是二次的）：真實的球在脫離軌道前速度掉得很快，
 * 最後那一小段幾乎是慢動作，四次方比二次方更接近那個手感。**它必須滿足 ease(0)=0、
 * ease(1)=1**，否則球停的位置就不是反解算出來的那一格——這是整段程式碼唯一不能動的限制。
 */
function ease(u: number): number {
    const inv = 1 - u;
    return 1 - inv * inv * inv * inv;
}

/**
 * 球在半徑上的位置。
 *
 * 前段貼著球道（1），`DROP_AT` 之後往內掉，掉的過程中疊上幾次衰減的彈跳。
 * 彈跳用 `|sin|` 而不是完整的 sin：球撞到東西只會往外彈，不會穿過軌道往外飛。
 *
 * 收尾必須乾淨地回到 0——彈跳的振幅乘上 `(1-p)²` 就是為了這件事。差一點點的話，
 * 球會停在袋位環外面一點點的地方，看起來像浮著。
 */
function radiusAt(u: number): number {
    if (u <= DROP_AT) return 1;

    const p = (u - DROP_AT) / (1 - DROP_AT);
    const fall = 1 - p * p;
    const bounce = Math.abs(Math.sin(Math.PI * BOUNCES * p)) * BOUNCE_HEIGHT * (1 - p) * (1 - p);
    return fall + bounce;
}

/** 把角度收進 [0, 2π) */
export function wrap(angle: number): number {
    const two = Math.PI * 2;
    return ((angle % two) + two) % two;
}
