import { POCKET_COUNT, WHEEL_ORDER } from './rules';

/**
 * 球的軌跡：**跑一次物理模擬，再把整段旋轉到中獎那一格。**
 *
 * ## 為什麼不是「算一條曲線通到答案」
 *
 * 第一版是那樣做的：一條平滑的 ease-out 把球的角度從起點帶到終點，再疊上「吸附到格心」
 * 與「衝過頭再彈回」兩個修正項。**結果看起來像作弊**，而且原因很具體：
 *
 * > 修正項改的是**位置**。位置被外力搬動，速度就不連續，而人眼對速度的連續性
 * > 極度敏感——它不會告訴你哪裡不對，只會告訴你「這球不是自己滾的」。
 *
 * 業界不那樣做。RNG 輪盤的專利寫得很直白：**先選一條 bounce pattern（可以從真實牌局的
 * 錄影擷取出來），再修改它的起止點，讓球落在指定的格子**。也就是說，拿的是一條
 * 物理上本來就成立的軌跡，整條平移去對齊答案，而不是把球推向答案。
 *
 * 這一版就是那個做法，只是用模擬代替錄影：
 *
 * ```text
 *   1. 用一組物理參數跑完整段（等減速 → 脫軌 → 撞偏導器 → 在隔板間彈跳 → 停）
 *   2. 看它停在哪一格
 *   3. 把整段軌跡旋轉「目標格 − 實際落點」
 * ```
 *
 * **旋轉整段等於改變球的起跑角度，不動任何速度或加速度**——物理完全自洽，
 * 而球從哪個角度起跑本來就是隨機的，看不出差別。
 *
 * ## 物理模型（Small & Tse, *Chaos* 22(3), 2012 的四階段）
 *
 * | 階段 | 發生什麼 | 這裡怎麼做 |
 * |---|---|---|
 * | ① 球道 | 滾動摩擦 ⇒ **等減速**，被外緣約束 | `RIM_DECEL` 固定角加速度 |
 * | ② 脫軌 | `θ̇² = (g/r)·tanα` 時離開球道 | `OMEGA_CRIT` 臨界角速度 |
 * | ③ 內滑 | 在 stator 上往內掉，θ̇ 與 r 一起降 | `SLIDE_DECEL` ＋ 徑向等速下降 |
 * | ④ 撞擊 | 撞上**固定在 stator 的菱形偏導器**，掉到還在轉的轉子上 | 掃到偏導器角度才觸發 |
 * | ⑤ 落袋 | 在 frets 之間彈跳，逐次損失能量 | 每跨一條隔板一次碰撞 |
 *
 * ★ **第一版最根本的錯就在②**：它讓球的速度平滑衰減到近乎 0 才落下去，
 * 所以球是「慢慢停下來、滑進格子」。真實的球**在還很快的時候就脫軌**——
 * 那是一個臨界條件，不是一個終點——然後被偏導器打亂，在轉子上彈跳好幾格才停。
 * 那個「還很快」正是整段動畫的張力來源。
 *
 * ## 純函式還是保住了
 *
 * 模擬跑在 `planSpin` 裡（吃 seeded `rng`），結果存成一張取樣表；`sampleSpin(t)` 只做
 * 查表與插值。所以「同一個 plan 不管在哪一幀取樣、取樣幾次、掉幀多嚴重，位置都一樣」
 * 這件事完全沒變——斷線重連從第 7 秒接著播、Node 裡窮舉驗證，兩個都還在。
 */

/** 一個袋位佔多少角度 */
export const POCKET_ANGLE = (Math.PI * 2) / POCKET_COUNT;

/**
 * 轉子的角速度（弧度／秒，正值＝順時針）。
 *
 * 真實輪盤的轉子約 20~30 RPM，也就是 2~3 rad/s。**這個數字直接決定落袋好不好看**：
 * 球掉到轉子上之後，能不能彈、彈幾格，看的是「球與轉子的**相對**速度」。
 * 舊版為了讓玩家看清號碼把它放慢到 0.55（約 5 RPM），代價是球一落下就幾乎跟轉子同速，
 * 於是不管怎麼調都彈不起來。
 */
export const WHEEL_OMEGA = 2.0;

// ── 物理參數（單位：弧度、秒；半徑用 0~1，1＝球道、0＝袋位環）────────────────

/** ① 球道上的角減速。滾動摩擦 ⇒ 常數，不是 ease 曲線 */
const RIM_DECEL = 0.75;

/**
 * ② 脫軌的臨界角速度。
 *
 * 論文裡它是 `√((g/r)·tanα)`——**球離開球道永遠發生在同一個速度上**，與它跑多快進來無關。
 * 這裡不需要真實單位，直接定一個讓畫面好看的值；重點是它**遠大於 0**：
 * 球是在還很快的時候脫軌的。
 */
const OMEGA_CRIT = 4.5;

/** ③ 脫軌之後摩擦變大（球不再貼著光滑的球道跑） */
const SLIDE_DECEL = 1.6;
/** ③ 往內掉的速度（半徑／秒）。慢一點，球才有一段「在斜面上滑向偏導器」可看 */
const SLIDE_DROP_RATE = 0.55;

/**
 * ④ 偏導器所在的半徑，以及有幾個（真實輪盤是 8 個，交錯排列）。view 層要照著畫。
 *
 * ⚠️ 這個數字**同時是物理也是版面**：球算的是「掉到這個半徑才撞得到」，而畫面上
 * 菱形就畫在這裡。第一版設 0.62，換算到畫面上剛好壓在號碼環（0.657）上——
 * 物理沒錯，但看起來像球撞到了號碼。真實輪盤的偏導器在**球道與號碼環之間**，
 * 所以要比號碼環更外側。
 */
export const DEFLECTOR_RADIUS = 0.86;
export const DEFLECTOR_COUNT = 8;

/** ④ 撞上偏導器之後保留多少角速度。這是整段最劇烈的一次能量損失 */
const DEFLECTOR_KEEP = 0.42;
/** ④ 撞擊把球往上拋多少（半徑），以及之後掉到轉子上的速度 */
const DEFLECTOR_KICK = 0.22;
const FALL_RATE = 1.6;

/** ⑤ 跨過一條隔板保留多少相對角速度 */
const FRET_KEEP = 0.72;
/** ⑤ 慢到這個程度（弧度／秒）之後，撞到隔板就彈回去而不是越過 */
const FRET_REBOUND_BELOW = 1.2;
/** ⑤ 彈回時保留多少（負號代表方向反過來） */
const FRET_REBOUND_KEEP = 0.45;
/** ⑤ 相對角速度低於此值就算停了 */
const SETTLE_OMEGA = 0.30;
/** ⑤ 每次撞隔板往上彈多少（乘上相對角速度），以及彈起的上限 */
const FRET_KICK = 0.075;
const FRET_KICK_MAX = 0.24;
/** ⑤ 彈起之後掉回袋位環的速度。太快的話畫面上只剩一兩幀，看不出它彈過 */
const POCKET_FALL_RATE = 1.35;

/** 球沉進袋位要多久 */
const SETTLE_TIME = 0.32;

/** 模擬的積分步長。夠小才不會在高速段跳過隔板 */
const SIM_DT = 1 / 480;
/** 存下來的取樣間隔。碰撞的速度突變要保得住，所以比畫面更新率密一點 */
const SAMPLE_DT = 1 / 120;
/** 模擬最長跑多久，防呆用 */
const SIM_MAX_T = 40;

/**
 * 尾段（脫軌到停下）大概多久。
 *
 * 用來反推球道段該跑多長，好讓整趟接近 server 給的 `duration`。**它只是估計值**——
 * 真正的尾段長度由碰撞決定，所以 `planSpin` 會拿第一次模擬的實際結果再修一次。
 */
const TAIL_ESTIMATE = 2.1;

export interface SpinPlan {
    /** 中獎號碼。球最後一定落在這一格 */
    winning: number;
    /** server 要求的時長。球可能**早一點**停（真實中球也是先停、荷官再報號） */
    duration: number;
    /** 轉子在 t=0 的角度 */
    wheelStart: number;
    /** 球實際停下來的時刻 */
    settleAt: number;
    /**
     * 取樣表：每 `dt` 秒一筆，球**相對轉子**的角度與半徑。
     *
     * 存相對角而不是世界角，是因為**整段旋轉對齊**就是在這個座標裡做的，
     * 而且落袋之後球跟著轉子走 ⇒ 相對角是常數，表的尾巴天然是平的。
     */
    dt: number;
    relative: number[];
    radius: number[];
}

export interface SpinSample {
    /** 轉子當下的角度 */
    wheelAngle: number;
    /** 球當下的世界角 */
    ballAngle: number;
    /**
     * 球在半徑上的位置：1＝外圈球道，0＝袋位環。
     *
     * 撞擊與彈跳會讓它短暫超過 1 或跳動，所以呼叫端不能假設它是單調的。
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
 * 排一趟球。
 *
 * `rng` 只影響**怎麼演**（球跑多快進來、每一次碰撞損失多少、偏導器把它打到哪），
 * 不影響**結果**——結果是最後那一步旋轉硬套上去的。這個分工跟舊版一樣，
 * 只是舊版的「演」是一條假曲線，這一版的「演」是真的跑出來的。
 */
export function planSpin(
    winning: number,
    duration: number,
    wheelStart: number,
    ballStart: number,
    rng: () => number = Math.random
): SpinPlan {
    /**
     * 球道段該跑多久，要**回頭修**。
     *
     * 尾段（脫軌到停下）的長度是碰撞決定的，事前只能估。所以先用估計值跑一次、
     * 量出真正的尾段，再拿它反推球道段。
     *
     * ⚠️ **而且必須收在 `duration` 以內**：server 是照那個時間結算的，球比它晚停
     * 就會出現「還在滾但已經開獎」。所以這裡是一個帶上限的迭代——
     * 每次把超出的部分從球道段扣掉，最多三次（實測一到兩次就進去了）。
     */
    /**
     * ★ **每一次試跑都要用同一串亂數。**
     *
     * 這裡要解的是「球道段該多長，才能讓整趟剛好在 `duration` 內結束」，而尾段長度
     * 由碰撞決定 ⇒ 只能試跑。但如果每次試跑都從 `rng` 繼續抽，**尾段本身也會跟著變**，
     * 於是迭代在追一個一直在動的目標，來回震盪不收斂（實測 40 趟裡有兩趟怎麼調都超時）。
     *
     * 先抽一個種子、每次試跑都用它重建一個一模一樣的序列，尾段就只受球道段影響了。
     */
    const seed = Math.floor(rng() * 0x7fffffff);

    let rimSeconds = duration - TAIL_ESTIMATE;
    let run = simulate(rimSeconds, ballStart, seeded(seed));

    for (let i = 0; i < 4; i++) {
        const tail = run.settleAt - run.leftRimAt;
        const want = duration - tail - 0.06;
        if (run.settleAt <= duration && Math.abs(want - rimSeconds) < 0.05) break;
        rimSeconds = Math.max(0.4, want);
        run = simulate(rimSeconds, ballStart, seeded(seed));
    }

    /**
     * 保底：還是差幾毫秒的話，把**時間軸**壓一點點。
     *
     * 縮放時間等於整段等比例加速，物理仍然自洽（所有速度同乘一個常數），
     * 而且因為差距只有幾十毫秒，畫面上看不出快轉。
     * 這比「硬把表截斷」好得多——截斷會讓球在半空中突然停住。
     */
    let dt = SAMPLE_DT;
    let settleAt = run.settleAt;
    if (settleAt > duration && duration > 0) {
        const scale = duration / settleAt;
        dt = SAMPLE_DT * scale;
        settleAt = duration;
    }

    const second = run;

    /**
     * ★ **整段旋轉對齊。**
     *
     * 模擬停在哪一格是物理決定的（也就是隨機的），而 server 要的是 `winning`。
     * 把整張表加上一個常數，球就落在對的格子上——**加常數不改變任何一階或二階導數**，
     * 所以速度、加速度、每一次碰撞的力道全部原封不動。
     *
     * 這正是專利說的「選一條 pattern，再調整它的起止點」。
     */
    const landedRel = second.relative[second.relative.length - 1];
    const delta = shortestDelta(pocketAngleOf(winning) - landedRel);
    for (let i = 0; i < second.relative.length; i++) second.relative[i] += delta;

    return {
        winning,
        duration,
        wheelStart,
        settleAt,
        dt,
        relative: second.relative,
        radius: second.radius,
    };
}

/**
 * 取樣：這一趟跑到第 `t` 秒時，轉子與球各在哪裡。
 *
 * 表以外的時間（球已經停了、或 `t` 超過 server 給的時長）球跟著轉子走——
 * 相對角是常數，所以**這一段不必另外寫一套畫法**，把表的最後一筆一直用下去就是對的。
 */
export function sampleSpin(plan: SpinPlan, t: number): SpinSample {
    const wheelAngle = plan.wheelStart + WHEEL_OMEGA * t;
    const last = plan.relative.length - 1;

    const x = Math.max(0, t) / plan.dt;
    const i = Math.floor(x);

    if (i >= last) {
        return {
            wheelAngle,
            ballAngle: plan.relative[last] + wheelAngle,
            radius01: plan.radius[last],
            settled: true,
        };
    }

    // 線性插值。取樣是 120Hz，而畫面最多 60Hz ⇒ 插出來的點永遠在兩個真值之間
    const f = x - i;
    const rel = plan.relative[i] + (plan.relative[i + 1] - plan.relative[i]) * f;
    const rad = plan.radius[i] + (plan.radius[i + 1] - plan.radius[i]) * f;

    return {
        wheelAngle,
        ballAngle: rel + wheelAngle,
        radius01: rad,
        settled: t >= plan.settleAt,
    };
}

interface SimResult {
    relative: number[];
    radius: number[];
    settleAt: number;
    leftRimAt: number;
}

/**
 * 跑一次完整的落球。
 *
 * 狀態只有三個：球的世界角 `theta`、角速度 `omega`（負值＝與轉子反向）、半徑 `radius`。
 * 五個階段共用同一個積分迴圈，靠 `phase` 切換受力——**這樣階段之間不會有接縫**，
 * 速度是連續的（碰撞那一瞬間除外，那本來就該不連續）。
 */
function simulate(rimSeconds: number, ballStart: number, rng: () => number): SimResult {
    // 球道段要跑這麼久 ⇒ 反推它該用多快進場（等減速，所以是一條直線）
    const omega0 = -(OMEGA_CRIT + RIM_DECEL * Math.max(0, rimSeconds));

    let theta = ballStart;
    let omega = omega0;
    let radius = 1;
    let t = 0;

    let phase: 'rim' | 'slide' | 'fall' | 'pockets' | 'settling' = 'rim';
    let leftRimAt = 0;
    let settleAt = 0;
    let settleFrom = 0;
    let settleTo = 0;

    const relative: number[] = [];
    const radiusOut: number[] = [];
    let nextSample = 0;

    const deflectorStep = (Math.PI * 2) / DEFLECTOR_COUNT;

    while (t < SIM_MAX_T) {
        // 取樣（在積分之前，這樣 t=0 一定有一筆）
        while (t >= nextSample - 1e-9) {
            relative.push(theta - WHEEL_OMEGA * t);
            radiusOut.push(radius);
            nextSample += SAMPLE_DT;
        }

        if (phase === 'settling' && t >= settleAt) break;

        const prevTheta = theta;

        switch (phase) {
            case 'rim': {
                // ① 等減速。`omega` 是負的，所以「減速」是往 0 加
                omega += RIM_DECEL * SIM_DT;
                theta += omega * SIM_DT;
                // ② 臨界條件：速度掉到 OMEGA_CRIT 就離開球道——**此時球還很快**
                if (Math.abs(omega) <= OMEGA_CRIT) {
                    phase = 'slide';
                    leftRimAt = t;
                }
                break;
            }

            case 'slide': {
                // ③ 往內掉，摩擦變大
                omega += SLIDE_DECEL * SIM_DT;
                theta += omega * SIM_DT;
                radius -= SLIDE_DROP_RATE * SIM_DT;

                /**
                 * ④ 偏導器**固定在 stator 上**（不隨轉子轉），所以用世界角判定。
                 *
                 * 條件是「掃過」而不是「接近」：球必須真的經過那個角度才算撞上。
                 * 寫成「掉到半徑就吸到最近的偏導器」會讓球瞬移一下——
                 * 那又是一個直接搬動位置的修正項，正是這次要戒掉的東西。
                 */
                if (radius <= DEFLECTOR_RADIUS && crossedDeflector(prevTheta, theta, deflectorStep)) {
                    // 撞擊：角速度大幅損失，球被往上拋一點再掉下去
                    omega *= DEFLECTOR_KEEP * (0.8 + rng() * 0.4);
                    // 夾在球道以下：球撞到菱形會往上彈，但**不會彈回球道上**——
                    // 那在畫面上是球跳出碗外，而且會讓「還在球道」這件事變得不可判斷
                    radius = Math.min(0.95, radius + DEFLECTOR_KICK * (0.6 + rng() * 0.8));
                    phase = 'fall';
                }
                break;
            }

            case 'fall': {
                omega += SLIDE_DECEL * 0.5 * SIM_DT;
                theta += omega * SIM_DT;
                radius -= FALL_RATE * SIM_DT;
                if (radius <= 0) {
                    radius = 0;
                    phase = 'pockets';
                }
                break;
            }

            case 'pockets': {
                /**
                 * ⑤ 球在轉子上了，**主角換成相對速度**。
                 *
                 * 球本身已經慢下來，但轉子還在 2 rad/s 地轉，兩者相減仍然可觀——
                 * 這就是球會在袋位之間彈好幾格的原因，也是舊版把轉子放慢到 0.55
                 * 之後怎麼調都彈不起來的原因。
                 */
                const relBefore = theta - WHEEL_OMEGA * t;
                let omegaRel = omega - WHEEL_OMEGA;

                omega += Math.sign(-omegaRel) * 0.6 * SIM_DT;
                theta += omega * SIM_DT;
                radius = Math.max(0, radius - POCKET_FALL_RATE * SIM_DT);

                const relAfter = theta - WHEEL_OMEGA * (t + SIM_DT);
                omegaRel = omega - WHEEL_OMEGA;

                // 跨過一條隔板 ⇒ 一次碰撞
                if (crossedFret(relBefore, relAfter)) {
                    const speed = Math.abs(omegaRel);
                    if (speed < FRET_REBOUND_BELOW) {
                        // 慢了就翻不過去，被隔板擋回來——真球最後那幾下就是這樣來回。
                        // 相對速度反號＝球被轉子帶著往回走，畫面上就是「彈回去一格」
                        omega = WHEEL_OMEGA - omegaRel * FRET_REBOUND_KEEP;
                    } else {
                        omega = WHEEL_OMEGA + omegaRel * FRET_KEEP * (0.85 + rng() * 0.3);
                    }
                    radius += Math.min(FRET_KICK_MAX, speed * FRET_KICK);
                }

                if (Math.abs(omega - WHEEL_OMEGA) < SETTLE_OMEGA) {
                    // 沉進袋位：從現在的位置滑到格心。這是球最後那一下「掉進去」
                    phase = 'settling';
                    settleFrom = theta - WHEEL_OMEGA * t;
                    settleTo = Math.round(settleFrom / POCKET_ANGLE) * POCKET_ANGLE;
                    settleAt = t + SETTLE_TIME;
                }
                break;
            }

            case 'settling': {
                const k = 1 - Math.max(0, (settleAt - t) / SETTLE_TIME);
                const eased = 1 - (1 - k) * (1 - k);
                const rel = settleFrom + (settleTo - settleFrom) * eased;
                theta = rel + WHEEL_OMEGA * t;
                omega = WHEEL_OMEGA;
                radius = Math.max(0, radius - 1.2 * SIM_DT);
                break;
            }
        }

        t += SIM_DT;
    }

    // 收尾：最後一筆一定落在格心、半徑為 0，之後球跟著轉子走
    const finalRel = Math.round((theta - WHEEL_OMEGA * t) / POCKET_ANGLE) * POCKET_ANGLE;
    relative.push(finalRel);
    radiusOut.push(0);

    /**
     * ⚠️ `settleAt` 要等於**表結束的時刻**，不是模擬裡那個 settling 階段的結束時間。
     *
     * 兩者差幾毫秒，而那幾毫秒剛好夠讓 `sampleSpin` 落在「已經 settled，但還在表裡」
     * 的區間——於是它繼續插值，球在「停下之後」又動了一點點。
     * **這正是那條「停穩之後不能再移動」的界線，差一格取樣也是差。**
     */
    return {
        relative,
        radius: radiusOut,
        settleAt: (relative.length - 1) * SAMPLE_DT,
        leftRimAt,
    };
}

/** 這一步有沒有掃過某一個偏導器的角度 */
function crossedDeflector(from: number, to: number, step: number): boolean {
    const a = Math.floor(from / step);
    const b = Math.floor(to / step);
    return a !== b;
}

/** 這一步有沒有跨過一條隔板（隔板在兩個格心的正中間） */
function crossedFret(from: number, to: number): boolean {
    const a = Math.floor(from / POCKET_ANGLE + 0.5);
    const b = Math.floor(to / POCKET_ANGLE + 0.5);
    return a !== b;
}

/**
 * 一個確定性的小亂數產生器（mulberry32）。
 *
 * 存在的理由只有一個：**讓同一顆種子每次都長出同一串數字**，好讓 `planSpin` 的試跑
 * 可以重複。它不負責遊戲的隨機性——那是呼叫端傳進來的 `rng` 的事，這支只從它拿一顆種子。
 */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 把角度差收進 (-π, π]。整段旋轉要挑最短的那一邊，不然球會憑空多轉大半圈 */
function shortestDelta(delta: number): number {
    const two = Math.PI * 2;
    let d = ((delta % two) + two) % two;
    if (d > Math.PI) d -= two;
    return d;
}

/** 把角度收進 [0, 2π) */
export function wrap(angle: number): number {
    const two = Math.PI * 2;
    return ((angle % two) + two) % two;
}
