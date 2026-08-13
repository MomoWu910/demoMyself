/**
 * 受控時鐘版的 gsap 替身。
 *
 * 真 gsap 活在自己的 ticker 上，測試裡沒辦法決定它什麼時候推進。這裡改成手動推進：
 * harness 每模擬一幀就呼叫 clock.advance(dt)，先跑 tween 再跑 reel.update()，
 * 順序固定，結果可重現。
 */

const active = new Set();

function ease(name) {
    if (!name || name === 'none') return (t) => t;

    // gsap 的 powerN = 指數 N+1（power1 是二次、power2 是三次…）
    const power = /^power(\d)\.(in|out|inOut)$/.exec(name);
    if (power) {
        const p = parseInt(power[1], 10) + 1;
        const dir = power[2];
        if (dir === 'in') return (t) => Math.pow(t, p);
        if (dir === 'out') return (t) => 1 - Math.pow(1 - t, p);
        return (t) => (t < 0.5 ? Math.pow(2 * t, p) / 2 : 1 - Math.pow(2 - 2 * t, p) / 2);
    }

    const back = /^back\.out\(([\d.]+)\)$/.exec(name);
    if (back) {
        const c1 = parseFloat(back[1]);
        const c3 = c1 + 1;
        return (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    throw new Error(`stub-gsap 沒實作這個 ease：${name}`);
}

function to(target, vars) {
    const { duration = 0.5, delay = 0, ease: easeName, onUpdate, onComplete, repeat, yoyo, ...props } = vars;
    const fn = ease(easeName);
    const from = {};
    for (const k of Object.keys(props)) from[k] = target[k];

    const tween = { elapsed: -delay, killed: false, done: false };
    tween.kill = () => {
        tween.killed = true;
        active.delete(tween);
    };
    tween.step = (dt) => {
        tween.elapsed += dt;
        if (tween.elapsed < 0) return;
        const t = duration > 0 ? Math.min(1, tween.elapsed / duration) : 1;
        const e = fn(t);
        for (const k of Object.keys(props)) target[k] = from[k] + (props[k] - from[k]) * e;
        onUpdate?.();
        if (t >= 1) {
            tween.done = true;
            active.delete(tween);
            onComplete?.();
        }
    };
    active.add(tween);
    return tween;
}

function delayedCall(delay, cb) {
    const tween = { elapsed: 0, killed: false, done: false };
    tween.kill = () => {
        tween.killed = true;
        active.delete(tween);
    };
    tween.step = (dt) => {
        tween.elapsed += dt;
        if (tween.elapsed >= delay) {
            tween.done = true;
            active.delete(tween);
            cb();
        }
    };
    active.add(tween);
    return tween;
}

function fromTo(target, fromVars, toVars) {
    for (const k of Object.keys(fromVars)) target[k] = fromVars[k];
    return to(target, toVars);
}

export const clock = {
    advance(dt) {
        for (const tw of [...active]) if (!tw.killed) tw.step(dt);
    },
    reset() {
        active.clear();
    },
    get pending() {
        return active.size;
    },
};

const gsap = { to, fromTo, delayedCall };
export default gsap;
