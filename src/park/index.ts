import * as T from 'three';
import { createPark } from './scene';
import { createControls } from './input';
import { createMaps } from './map';
import { movePlayer, nearby, place, PLACES, STARS, type PlaceId, type Point } from './world';
import { mountReveal } from '../shell/reveal';
import './style.css';

mountReveal();
const el = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const root = el('park'), canvas = el<HTMLCanvasElement>('world');
const welcome = el<HTMLDialogElement>('welcome'), mapDialog = el<HTMLDialogElement>('map-dialog');
const isTouch = (): boolean => matchMedia('(pointer: coarse)').matches || innerWidth < 900 || (navigator.maxTouchPoints > 0 && innerWidth < 1100);
let rotated = false;
let renderer: T.WebGLRenderer;
try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    boot(renderer);
} catch (error) {
    console.error('Cloud Park could not start', error); el('error').hidden = false;
}

function boot(view: T.WebGLRenderer): void {
    view.setPixelRatio(Math.min(devicePixelRatio, isTouch() ? 1.5 : 2));
    view.shadowMap.enabled = true; view.shadowMap.type = T.PCFSoftShadowMap;
    view.shadowMap.autoUpdate = false; view.shadowMap.needsUpdate = true;
    view.outputColorSpace = T.SRGBColorSpace; view.toneMapping = T.ACESFilmicToneMapping; view.toneMappingExposure = 1.15;
    const park = createPark(), camera = new T.PerspectiveCamera(52, 1, .1, 240);
    let position: Point = { x: 0, z: 29 }, yaw = 0, pitch = .18;
    let started = false, travelling = false, ride: { id: 'wheel' | 'carousel'; start: number } | null = null;
    let worldTime = 0, last = performance.now(), toastTimer = 0, cameraReady = false;
    const collected = new Set<number>();
    // Only the park's return point is saved. Browser storage restrictions never prevent entry.
    try {
        if (sessionStorage.getItem('park:return') === 'casino') { position = { ...place('casino').arrival }; sessionStorage.removeItem('park:return'); }
    } catch { /* private browsing */ }
    const active = (): boolean => started && !welcome.open && !mapDialog.open && !travelling && !document.hidden;
    const controls = createControls(canvas, {
        active, rotated: () => rotated, touch: isTouch,
        look(dx, dy) { if (!ride) { yaw -= dx * .0035; pitch = T.MathUtils.clamp(pitch + dy * .0027, -.12, 1.05); } },
        interact, map: toggleMap,
    });
    function toast(message: string): void {
        clearTimeout(toastTimer); el('toast').textContent = message; el('toast').classList.add('visible');
        toastTimer = window.setTimeout(() => el('toast').classList.remove('visible'), 3600);
    }
    function resize(): void {
        controls.clear(); const touch = isTouch(); document.body.classList.toggle('touch', touch);
        rotated = touch && innerHeight > innerWidth; root.classList.toggle('rotated', rotated);
        const w = rotated ? innerHeight : innerWidth, h = rotated ? innerWidth : innerHeight;
        view.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();
    const maps = createMaps(travel);
    function release(): void { controls.clear(); if (document.pointerLockElement) document.exitPointerLock(); }
    function showMap(): void {
        if (welcome.open || travelling) return;
        release(); mapDialog.showModal(); maps.update(position, yaw, collected); el<HTMLButtonElement>('close-map').focus();
    }
    function closeMap(): void { mapDialog.close(); controls.clear(); canvas.focus({ preventScroll: true }); }
    function toggleMap(): void { if (!started) return; if (mapDialog.open) closeMap(); else showMap(); }
    el('minimap').addEventListener('click', showMap); el('close-map').addEventListener('click', closeMap);
    mapDialog.addEventListener('cancel', () => controls.clear());
    el('help').addEventListener('click', () => { release(); if (!welcome.open) welcome.showModal(); });
    el('start').addEventListener('click', () => { started = true; welcome.close(); canvas.focus({ preventScroll: true }); controls.capture(); });
    el('resume').addEventListener('click', () => { canvas.focus(); controls.capture(); });
    el('interact').addEventListener('click', interact); el('touch-action').addEventListener('click', interact);
    el('fullscreen').addEventListener('click', async () => {
        try {
            if (document.fullscreenElement) { await document.exitFullscreen(); return; }
            await document.documentElement.requestFullscreen();
            if (isTouch()) {
                const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
                try { await orientation.lock?.('landscape'); } catch { /* CSS landscape fallback */ }
            }
        } catch { toast('此瀏覽器不支援全螢幕，仍可直接探索樂園。'); }
    });
    // Do not let Escape close the first welcome without putting the game into a playable state.
    welcome.addEventListener('cancel', (e) => { if (!started) e.preventDefault(); controls.clear(); });
    function leaveRide(): void {
        if (!ride) return;
        position = { ...place(ride.id).arrival }; ride = null; park.avatar.root.visible = true; cameraReady = false;
        toast('旅程結束，繼續探索吧！');
    }
    function interact(): void {
        if (!active()) return;
        if (ride) { leaveRide(); return; }
        const p = nearby(position); if (!p) return;
        switch (p.id) {
            case 'casino':
                release();
                try { sessionStorage.setItem('park:return', 'casino'); } catch { /* private browsing */ }
                location.href = './arcade.html'; break;
            case 'wheel': case 'carousel':
                controls.clear(); ride = { id: p.id, start: worldTime }; park.avatar.root.visible = false; cameraReady = false;
                toast(`${p.name}出發！隨時按 F 或互動鍵下車。`); break;
            case 'fountain': park.wish(); toast('✦ 願望已送達。今天也會有好事發生！'); break;
            case 'tea': park.avatar.balloon.visible = !park.avatar.balloon.visible; toast(park.avatar.balloon.visible ? '送你一顆棉花糖氣球，帶著它去散步吧！' : '氣球先寄放在茶屋，隨時可以回來拿。'); break;
            case 'gate': toast('小雲：歡迎！找找散落的 5 顆星星，或打開地圖去星光賭場。'); break;
        }
    }
    function travel(id: PlaceId): void {
        if (travelling) return;
        release(); travelling = true; el('travel-fade').classList.add('active');
        window.setTimeout(() => {
            if (ride) leaveRide();
            position = { ...place(id).arrival }; yaw = id === 'gate' ? Math.PI : 0; pitch = .18;
            park.avatar.root.position.set(position.x, 0, position.z); park.avatar.root.rotation.y = yaw + Math.PI;
            cameraReady = false; if (mapDialog.open) closeMap(); maps.update(position, yaw, collected);
            window.setTimeout(() => { travelling = false; el('travel-fade').classList.remove('active'); toast(`已抵達${place(id).name} · ${place(id).action}`); }, 220);
        }, 220);
    }
    const cameraRay = new T.Raycaster(), target = new T.Vector3(), desired = new T.Vector3(), direction = new T.Vector3();
    function updateCamera(dt: number): void {
        if (ride) {
            if (ride.id === 'wheel') {
                desired.copy(park.wheelSeat(worldTime)); target.set(0, 2, 0);
            } else {
                const a = worldTime * .22; desired.set(28 + Math.cos(a) * 5.5, 3.5, -14 - Math.sin(a) * 5.5); target.set(28 + Math.cos(a + .9) * 14, 3, -14 - Math.sin(a + .9) * 14);
            }
        } else {
            target.set(position.x, 1.7, position.z);
            const distance = isTouch() ? 8.7 : 8;
            desired.set(position.x + Math.sin(yaw) * Math.cos(pitch) * distance, 1.7 + Math.sin(pitch) * distance, position.z + Math.cos(yaw) * Math.cos(pitch) * distance);
            // Raycast the opaque building shells, then keep the camera above the ground.
            direction.copy(desired).sub(target); const length = direction.length();
            cameraRay.set(target, direction.normalize()); cameraRay.far = length;
            const hits = cameraRay.intersectObjects(park.cameraBlockers, false);
            if (hits.length) desired.copy(target).addScaledVector(direction, Math.max(.7, hits[0].distance - .4));
            desired.y = Math.max(.7, desired.y);
        }
        if (!cameraReady) { camera.position.copy(desired); cameraReady = true; }
        else camera.position.lerp(desired, 1 - Math.exp(-12 * dt));
        camera.lookAt(target);
    }
    let mapTick = 0, previousPrompt = '';
    function frame(now: number): void {
        const dt = Math.min((now - last) / 1000, .05); last = now;
        if (document.hidden) return;
        worldTime += dt;
        let moving = 0;
        if (active() && !ride) {
            const input = controls.movement(); moving = Math.hypot(input.x, input.y);
            const dx = (Math.cos(yaw) * input.x - Math.sin(yaw) * input.y) * 7 * dt;
            const dz = (-Math.sin(yaw) * input.x - Math.cos(yaw) * input.y) * 7 * dt;
            position = movePlayer(position, dx, dz);
            park.avatar.root.position.set(position.x, 0, position.z);
            if (moving > .05) {
                const angle = Math.atan2(dx, dz), old = park.avatar.root.rotation.y;
                park.avatar.root.rotation.y += Math.atan2(Math.sin(angle - old), Math.cos(angle - old)) * Math.min(dt * 12, 1);
            }
            STARS.forEach((p, i) => {
                if (!collected.has(i) && Math.hypot(p.x - position.x, p.z - position.z) < 1.4) {
                    collected.add(i); park.collect(i); el('stars-count').textContent = String(collected.size);
                    toast(collected.size === 5 ? '✦ 收集完成！你是今天的星光探險家！' : `找到一顆星星！ ${collected.size} / 5`);
                    if (collected.size === 5) { park.avatar.balloon.visible = true; el('passport-note').textContent = '星光探險家 · 收集完成'; }
                }
            });
        }
        if (ride && worldTime - ride.start > 25) leaveRide();
        park.update(worldTime, moving); updateCamera(dt);
        const current = nearby(position), prompt = ride ? '結束搭乘' : current?.action ?? '';
        if (prompt !== previousPrompt) {
            el('interact').hidden = !prompt; el('interaction-label').textContent = prompt;
            el<HTMLButtonElement>('touch-action').disabled = !prompt; previousPrompt = prompt;
        }
        el('resume').hidden = !active() || !!document.pointerLockElement || isTouch() || !!ride;
        mapTick += dt;
        if (mapTick > .1) {
            mapTick = 0; maps.update(position, yaw, collected);
            const nearest = PLACES.reduce((a, b) => Math.hypot(position.x - a.arrival.x, position.z - a.arrival.z) < Math.hypot(position.x - b.arrival.x, position.z - b.arrival.z) ? a : b);
            el('location').textContent = ride ? `${place(ride.id).name} · 搭乘中` : nearest.name;
        }
        view.render(park.scene, camera);
    }
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); release(); el('error').hidden = false; view.setAnimationLoop(null); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    window.addEventListener('pagehide', (e) => { controls.clear(); view.setAnimationLoop(null); if (!e.persisted) { park.dispose(); view.dispose(); } });
    window.addEventListener('pageshow', (e) => { if (e.persisted) { last = performance.now(); view.setAnimationLoop(frame); } });
    document.addEventListener('visibilitychange', () => { last = performance.now(); view.setAnimationLoop(document.hidden ? null : frame); });
    park.avatar.root.position.set(position.x, 0, position.z);
    // Update world matrices before the first camera collision query.
    park.scene.updateMatrixWorld(true); maps.update(position, yaw, collected); updateCamera(1);
    view.setAnimationLoop(frame); welcome.showModal();
}
