/** Pointer deltas must be converted back to landscape coordinates in the portrait fallback. */
export function landscapeDelta(dx: number, dy: number, rotated: boolean): { x: number; y: number } {
    return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}
export interface Controls {
    movement: () => { x: number; y: number };
    clear: () => void;
    capture: () => void;
    cursorVisible: () => boolean;
}
export function createControls(canvas: HTMLCanvasElement, options: {
    active: () => boolean; rotated: () => boolean; touch: () => boolean;
    look: (x: number, y: number) => void; interact: () => void; map: () => void; jump: () => void;
}): Controls {
    const keys = new Set<string>();
    const joystick = document.getElementById('joystick')!;
    const stick = document.getElementById('stick')!;
    const axis = { x: 0, y: 0 };
    let joyPointer: number | null = null, lookPointer: number | null = null;
    let startX = 0, startY = 0, lookX = 0, lookY = 0;
    let altHeld = false, relockAfterAlt = false;
    function resetStick(): void { joyPointer = null; axis.x = axis.y = 0; stick.style.transform = ''; }
    function clear(): void { keys.clear(); resetStick(); lookPointer = null; }
    function capture(): void {
        if (altHeld || options.touch() || !options.active() || document.pointerLockElement === canvas) return;
        // Pointer lock can be denied in an iframe or by the browser; drag-look remains available.
        try { const result = canvas.requestPointerLock?.(); if (result) void result.catch(() => {}); } catch { /* use drag-look */ }
    }
    window.addEventListener('keydown', (e) => {
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            if (!options.active()) return;
            e.preventDefault();
            if (!altHeld) { relockAfterAlt = document.pointerLockElement === canvas; altHeld = true; clear(); if (relockAfterAlt) document.exitPointerLock(); }
            return;
        }
        if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); options.map(); return; }
        if (!options.active() || altHeld) return;
        if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) options.jump(); return; }
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); keys.add(e.code); }
        if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); options.interact(); }
    });
    window.addEventListener('keyup', (e) => {
        keys.delete(e.code);
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            if (!altHeld) return;
            e.preventDefault(); altHeld = false;
            if (relockAfterAlt && options.active()) capture();
            relockAfterAlt = false;
        }
    });
    const reset = (): void => { clear(); altHeld = false; relockAfterAlt = false; };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    document.addEventListener('pointerlockchange', () => { keys.clear(); });
    document.addEventListener('mousemove', (e) => { if (!altHeld && document.pointerLockElement === canvas && options.active()) options.look(e.movementX, e.movementY); });
    canvas.addEventListener('pointerdown', (e) => {
        if (!options.active() || altHeld || (e.pointerType === 'mouse' && e.button !== 0)) return;
        canvas.focus({ preventScroll: true }); capture();
        lookPointer = e.pointerId; lookX = e.clientX; lookY = e.clientY;
        if (e.pointerType !== 'mouse') canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookPointer || document.pointerLockElement === canvas || !options.active()) return;
        const d = landscapeDelta(e.clientX - lookX, e.clientY - lookY, options.rotated());
        options.look(d.x, d.y); lookX = e.clientX; lookY = e.clientY;
    });
    const stopLook = (e: PointerEvent): void => { if (e.pointerId === lookPointer) lookPointer = null; };
    window.addEventListener('pointerup', stopLook); window.addEventListener('pointercancel', stopLook);
    canvas.addEventListener('lostpointercapture', stopLook);
    joystick.addEventListener('pointerdown', (e) => {
        if (!options.active() || joyPointer !== null) return;
        e.preventDefault(); joyPointer = e.pointerId; startX = e.clientX; startY = e.clientY; joystick.setPointerCapture(e.pointerId);
    });
    joystick.addEventListener('pointermove', (e) => {
        if (e.pointerId !== joyPointer || !options.active()) return;
        const d = landscapeDelta(e.clientX - startX, e.clientY - startY, options.rotated());
        const len = Math.hypot(d.x, d.y), scale = len > 35 ? 35 / len : 1;
        axis.x = d.x * scale / 35; axis.y = -d.y * scale / 35;
        stick.style.transform = `translate(${d.x * scale}px,${d.y * scale}px)`;
    });
    const stopJoy = (e: PointerEvent): void => { if (e.pointerId === joyPointer) resetStick(); };
    joystick.addEventListener('pointerup', stopJoy); joystick.addEventListener('pointercancel', stopJoy); joystick.addEventListener('lostpointercapture', stopJoy);
    return { clear, capture, cursorVisible: () => altHeld, movement() {
        if (altHeld) return { x: 0, y: 0 };
        let x = axis.x + Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
        let y = axis.y + Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
        const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; } return { x, y };
    } };
}
