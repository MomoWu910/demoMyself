import { Application, Container, Graphics, Text, TextStyle, WebGLRenderer } from 'pixi.js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import gsap from 'gsap';
import { t, onLangChange, mountLangToggle } from '../../i18n';

/**
 * Cross-Engine Sandbox — PixiJS (2D HUD) + Three.js (3D scene) + cannon-es (physics)
 * 全部畫進「同一個 WebGL2 context」。重點展示：
 *   1. 兩個渲染引擎共用同一張 canvas / 同一個 GL context。
 *   2. 每幀手動隔離 GL 狀態（depth / cull / stencil / VAO），避免 Three 污染 Pixi。
 *   3. Three 渲染的 3D 物理場景，疊上 Pixi 渲染的即時 2D HUD。
 */
(async () => {
    // ==========================================
    // 0. Root / Canvas
    // ==========================================
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#0d0f14' });
    document.body.appendChild(root);

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', zIndex: '0', touchAction: 'none' });
    root.appendChild(canvas);

    const PALETTE = [0xe63946, 0xf4a261, 0xe9c46a, 0x2a9d8f, 0x4895ef, 0x9b5de5, 0xf15bb5];

    // ==========================================
    // 1. 物理世界 (cannon-es)
    // ==========================================
    const GRAVITY_NORMAL = -18;
    const GRAVITY_LOW = -3;
    const world = new CANNON.World();
    world.gravity.set(0, GRAVITY_NORMAL, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    (world.solver as CANNON.GSSolver).iterations = 18; // 多疊代 → 牆角不漏球

    const objMat = new CANNON.Material('obj');
    world.addContactMaterial(new CANNON.ContactMaterial(objMat, objMat, { friction: 0.4, restitution: 0.3 }));

    // ==========================================
    // 2. Three.js 場景
    // ==========================================
    const scene = new THREE.Scene();
    scene.background = makeGradientTexture('#1b2030', '#0a0c11');

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 8.5, 11);
    camera.lookAt(0, 1, 0);

    // 兩個 renderer 共用一張 canvas，必須用「同一個」解析度，否則 retina 下會各自縮放 → 畫面爆掉。
    const DPR = Math.min(window.devicePixelRatio, 2);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
    renderer.setPixelRatio(DPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // --- 燈光：克制的 studio 三點 ---
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x202833, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(6, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.camera.left = key.shadow.camera.bottom = -12;
    key.shadow.camera.right = key.shadow.camera.top = 12;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-8, 5, -4);
    scene.add(fill);

    // --- 接影地板 ---
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    // ==========================================
    // 3. 托盤 (Tray) —— 視覺(Three) + 物理(Kinematic cannon)
    // ==========================================
    const INNER = 3.4;     // 內部半徑 (x/z)
    const WALL_H = 2.2;     // 牆高
    const T = 0.25;         // 厚度

    const trayGroup = new THREE.Group();
    scene.add(trayGroup);

    const glassMat = new THREE.MeshStandardMaterial({
        color: 0x9fb4d4, metalness: 0.1, roughness: 0.15, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide,
    });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a3142, metalness: 0.2, roughness: 0.6 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x6fb7ff, transparent: true, opacity: 0.9 });

    const addPanel = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.receiveShadow = true;
        trayGroup.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
        edges.position.set(x, y, z);
        trayGroup.add(edges);
    };
    // 地板 + 四面牆 (視覺)
    addPanel(INNER * 2 + T * 2, T, INNER * 2 + T * 2, 0, -T / 2, 0, floorMat);
    addPanel(T, WALL_H, INNER * 2, INNER + T / 2, WALL_H / 2, 0, glassMat);
    addPanel(T, WALL_H, INNER * 2, -(INNER + T / 2), WALL_H / 2, 0, glassMat);
    addPanel(INNER * 2 + T * 2, WALL_H, T, 0, WALL_H / 2, INNER + T / 2, glassMat);
    addPanel(INNER * 2 + T * 2, WALL_H, T, 0, WALL_H / 2, -(INNER + T / 2), glassMat);

    // 托盤物理 (Kinematic：可由互動旋轉，推動內部 dynamic body)
    const trayBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: objMat });
    const box = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
        trayBody.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(x, y, z));
    // 物理碰撞體刻意加厚（內面位置與視覺玻璃對齊，往外/往下加厚），傾斜時才不會被薄牆掃穿。
    const WT = 0.6;          // 牆/地板物理半厚
    const WH = WALL_H * 0.9; // 物理牆半高（比視覺略高，Shake 時不易翻出）
    box(INNER + WT, WT, INNER + WT, 0, -WT, 0);              // floor：頂面對齊 y=0
    box(WT, WH, INNER + WT, INNER + WT, WH, 0);              // +x：內面對齊 x=INNER
    box(WT, WH, INNER + WT, -(INNER + WT), WH, 0);           // -x
    box(INNER + WT, WH, WT, 0, WH, INNER + WT);              // +z：內面對齊 z=INNER
    box(INNER + WT, WH, WT, 0, WH, -(INNER + WT));           // -z
    world.addBody(trayBody);

    // ==========================================
    // 4. 物理物件 (球 + 方塊)
    // ==========================================
    type Obj = { mesh: THREE.Mesh; body: CANNON.Body };
    const objects: Obj[] = [];
    const sphereGeo = new THREE.SphereGeometry(0.38, 24, 18);
    const boxGeo = new THREE.BoxGeometry(0.66, 0.66, 0.66);

    const spawn = (n: number) => {
        for (let i = 0; i < n && objects.length < 140; i++) {
            const color = PALETTE[(Math.random() * PALETTE.length) | 0];
            const isBox = Math.random() > 0.5;
            const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.45 });
            const mesh = new THREE.Mesh(isBox ? boxGeo : sphereGeo, mat);
            mesh.castShadow = true;
            scene.add(mesh);

            const pos = new CANNON.Vec3((Math.random() - 0.5) * INNER * 1.4, WALL_H + 0.6 + Math.random() * 2, (Math.random() - 0.5) * INNER * 1.4);
            const body = new CANNON.Body({
                mass: 1, material: objMat, position: pos,
                shape: isBox ? new CANNON.Box(new CANNON.Vec3(0.33, 0.33, 0.33)) : new CANNON.Sphere(0.38),
            });
            body.linearDamping = 0.05;
            body.angularDamping = 0.05;
            world.addBody(body);
            objects.push({ mesh, body });
        }
    };
    const clearObjects = () => {
        objects.forEach((o) => { scene.remove(o.mesh); world.removeBody(o.body); });
        objects.length = 0;
    };
    spawn(28);

    // ==========================================
    // 5. PixiJS —— 共用 Three 的 GL context
    // ==========================================
    const pixiRenderer = new WebGLRenderer();
    await pixiRenderer.init({
        context: renderer.getContext() as WebGL2RenderingContext,
        canvas,
        width: window.innerWidth,
        height: window.innerHeight,
        resolution: DPR,        // 對齊 Three 的 pixelRatio
        autoDensity: false,     // 不讓 Pixi 去動 canvas.style（交給 Three 管尺寸）
        clearBeforeRender: false,
        antialias: true,
    });
    const pixiApp = new Application();
    pixiApp.renderer = pixiRenderer;
    await pixiApp.init({ canvas, backgroundAlpha: 0, preference: 'webgl', resolution: DPR, autoDensity: false, antialias: true });
    pixiApp.ticker.stop();
    (globalThis as any).__PIXI_APP__ = pixiApp;

    const ui = new Container();
    ui.sortableChildren = true;
    pixiApp.stage.addChild(ui);

    // --- 玻璃面板小工具 ---
    const glassPanel = (w: number, h: number) =>
        new Graphics().roundRect(0, 0, w, h, 14).fill({ color: 0x0e1320, alpha: 0.55 }).stroke({ width: 1, color: 0x5b7fb0, alpha: 0.5 });

    const label = (text: string, size: number, fill: number, weight: '400' | '700' = '400') =>
        new Text({ text, style: new TextStyle({ fontFamily: 'Segoe UI, Roboto, sans-serif', fontSize: size, fontWeight: weight, fill }) });

    // --- 標題（無框，置於 Back 按鈕下方）---
    const titleBox = new Container();
    titleBox.position.set(26, 78);
    const titleMain = label('PixiJS  ×  Three.js', 26, 0xffffff, '700'); titleMain.position.set(0, 0);
    const titleSub = label(t('px3.subtitle'), 13, 0x8fb6e8); titleSub.position.set(0, 36);
    titleBox.addChild(titleMain, titleSub);
    ui.addChild(titleBox);

    // --- 即時數據面板 ---
    const statsBox = new Container();
    statsBox.addChild(glassPanel(176, 108));
    const statStyle = new TextStyle({ fontFamily: 'SF Mono, Menlo, monospace', fontSize: 15, fill: 0xd7e6ff });
    const fpsText = new Text({ text: '', style: statStyle }); fpsText.position.set(16, 14);
    const bodyText = new Text({ text: '', style: statStyle }); bodyText.position.set(16, 42);
    const drawText = new Text({ text: '', style: statStyle }); drawText.position.set(16, 70);
    statsBox.addChild(fpsText, bodyText, drawText);
    ui.addChild(statsBox);

    // --- 提示 ---
    const hint = new Text({
        text: t('px3.hint'),
        style: new TextStyle({ fontFamily: 'Segoe UI, Roboto, sans-serif', fontSize: 15, fill: 0x8fb6e8 }),
    });
    hint.anchor.set(0.5, 0);
    ui.addChild(hint);

    // --- 按鈕列 ---
    const makeButton = (label: string, color: number, onTap: () => void, w = 116) => {
        const c = new Container();
        c.interactive = true; c.cursor = 'pointer';
        const h = 48;
        const bg = new Graphics().roundRect(0, 0, w, h, 12).fill({ color, alpha: 0.92 }).stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
        const txt = new Text({ text: label, style: new TextStyle({ fontFamily: 'Segoe UI, Roboto, sans-serif', fontSize: 16, fontWeight: '700', fill: 0xffffff }) });
        txt.anchor.set(0.5); txt.position.set(w / 2, h / 2);
        c.addChild(bg, txt);
        (c as any)._w = w; (c as any)._h = h;
        c.on('pointerover', () => gsap.to(c.scale, { x: 1.06, y: 1.06, duration: 0.15 }));
        c.on('pointerout', () => gsap.to(c.scale, { x: 1, y: 1, duration: 0.15 }));
        c.on('pointerdown', (e) => { e.stopPropagation(); gsap.fromTo(c.scale, { x: 0.92, y: 0.92 }, { x: 1.06, y: 1.06, duration: 0.18 }); onTap(); });
        return c;
    };

    let lowGravity = false;
    const gravityBtn = makeButton(t('px3.gravity.normal'), 0x6c5ce7, () => {
        lowGravity = !lowGravity;
        world.gravity.set(0, lowGravity ? GRAVITY_LOW : GRAVITY_NORMAL, 0);
        objects.forEach((o) => o.body.wakeUp());
        (gravityBtn.children[1] as Text).text = lowGravity ? t('px3.gravity.low') : t('px3.gravity.normal');
    }, 168);
    const addBtn = makeButton(t('px3.btn.add'), 0x2a9d8f, () => spawn(8));
    const shakeBtn = makeButton(t('px3.btn.shake'), 0xf4a261, () => objects.forEach((o) => {
        o.body.wakeUp();
        o.body.applyImpulse(new CANNON.Vec3((Math.random() - 0.5) * 8, 5 + Math.random() * 3, (Math.random() - 0.5) * 8));
    }));
    const resetBtn = makeButton(t('px3.btn.reset'), 0xe63946, () => { clearObjects(); spawn(28); resetTilt(); });
    const buttons = [addBtn, shakeBtn, resetBtn, gravityBtn];
    const btnRow = new Container();
    buttons.forEach((b) => btnRow.addChild(b));
    ui.addChild(btnRow);

    // 語言切換時更新 HUD 文字
    onLangChange(() => {
        titleSub.text = t('px3.subtitle');
        hint.text = t('px3.hint');
        (addBtn.children[1] as Text).text = t('px3.btn.add');
        (shakeBtn.children[1] as Text).text = t('px3.btn.shake');
        (resetBtn.children[1] as Text).text = t('px3.btn.reset');
        (gravityBtn.children[1] as Text).text = lowGravity ? t('px3.gravity.low') : t('px3.gravity.normal');
    });

    // 依視窗寬度排版（Pixi 端）
    const layoutHud = () => {
        const W = window.innerWidth, H = window.innerHeight;
        statsBox.position.set(W - 176 - 24, 24);
        const gap = 14;
        let x = 0;
        buttons.forEach((b) => { b.position.set(x, 0); x += (b as any)._w + gap; });
        btnRow.position.set((W - (x - gap)) / 2, H - 48 - 28);
        hint.position.set(W / 2, H - 48 - 28 - 34);
    };
    layoutHud();

    // ==========================================
    // 6. 互動：拖曳傾斜托盤
    // ==========================================
    const tilt = { x: 0, z: 0 };        // 實際套用的傾斜
    const targetTilt = { x: 0, z: 0 };  // 拖曳設定的目標
    const MAX_TILT = 0.5;
    const TILT_STEP = 0.03;             // 每幀最大角度變化（限速 → 牆不會「掃」過物件）
    let dragging = false;
    let lastX = 0, lastY = 0;

    const applyTilt = () => {
        const qx = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt.x);
        const qz = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), tilt.z);
        trayBody.quaternion.copy(qz.mult(qx));
    };
    const resetTilt = () => { targetTilt.x = 0; targetTilt.z = 0; };

    // 每幀限速趨近目標，並把角速度餵給 cannon（接觸求解才知道牆在動、用速度推開物件）
    const updateTilt = (dt: number) => {
        const px = tilt.x, pz = tilt.z;
        tilt.x += THREE.MathUtils.clamp(targetTilt.x - tilt.x, -TILT_STEP, TILT_STEP);
        tilt.z += THREE.MathUtils.clamp(targetTilt.z - tilt.z, -TILT_STEP, TILT_STEP);
        applyTilt();
        const inv = dt > 0 ? 1 / dt : 0;
        trayBody.angularVelocity.set((tilt.x - px) * inv, 0, (tilt.z - pz) * inv);
        if (tilt.x !== px || tilt.z !== pz) objects.forEach((o) => o.body.wakeUp());
    };

    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('pointerup', () => { if (dragging) { dragging = false; resetTilt(); } });
    window.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        targetTilt.x = THREE.MathUtils.clamp(targetTilt.x + (e.clientY - lastY) * 0.004, -MAX_TILT, MAX_TILT);
        targetTilt.z = THREE.MathUtils.clamp(targetTilt.z - (e.clientX - lastX) * 0.004, -MAX_TILT, MAX_TILT);
        lastX = e.clientX; lastY = e.clientY;
    });

    // ==========================================
    // 7. GL Draw Call 計數器（兩引擎合計，誠實的單幀總量）
    // ==========================================
    const gl = renderer.getContext() as WebGL2RenderingContext;
    let glDraws = 0;
    (['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const).forEach((name) => {
        const orig = (gl as any)[name].bind(gl);
        (gl as any)[name] = (...args: any[]) => { glDraws++; return orig(...args); };
    });

    // FPS
    let fps = 0, frames = 0, fpsLast = performance.now();

    // ==========================================
    // 8. Render Loop
    // ==========================================
    const clock = new THREE.Clock();
    function animate() {
        const dt = Math.min(clock.getDelta(), 1 / 30);
        glDraws = 0;

        // --- 物理 ---
        updateTilt(dt);
        world.step(1 / 60, dt, 6);
        trayGroup.position.copy(trayBody.position as any);
        trayGroup.quaternion.copy(trayBody.quaternion as any);
        objects.forEach((o) => {
            o.mesh.position.copy(o.body.position as any);
            o.mesh.quaternion.copy(o.body.quaternion as any);
        });

        // --- Three (3D) ---
        renderer.resetState();
        renderer.render(scene, camera);

        // --- 交棒給 Pixi：隔離 GL 狀態 ---
        // Three 的 shadow pass 會動到 framebuffer / viewport / scissor。先手動還原成預設，
        // 再呼叫 pixiRenderer.resetState() 讓 Pixi 重新同步它自己的 GL 狀態快取，
        // 否則 Pixi 會沿用過期狀態繪製 → HUD 整層消失。(Pixi v8 是 resetState()，不是 reset())
        const dpr = renderer.getPixelRatio();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, window.innerWidth * dpr, window.innerHeight * dpr);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        pixiRenderer.resetState();
        pixiRenderer.render({ container: pixiApp.stage });

        // --- HUD 數據 ---
        frames++;
        const now = performance.now();
        if (now - fpsLast >= 500) {
            fps = Math.round((frames * 1000) / (now - fpsLast));
            frames = 0; fpsLast = now;
            fpsText.text = `FPS     ${fps}`;
            bodyText.text = `Bodies  ${objects.length}`;
            drawText.text = `Draws   ${glDraws}`;
        }

        requestAnimationFrame(animate);
    }
    animate();

    // ==========================================
    // 9. Resize
    // ==========================================
    window.addEventListener('resize', () => {
        const w = window.innerWidth, h = window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        pixiRenderer.resize(w, h);
        layoutHud();
    });

    // --- Back ---
    const backBtn = document.createElement('a');
    backBtn.innerText = '← Back';
    backBtn.href = './index.html'; // pixiXthree 是首頁的獨立大分類，back 直接回首頁
    Object.assign(backBtn.style, {
        position: 'absolute', top: '24px', left: '24px', color: '#cfe0ff', textDecoration: 'none',
        background: 'rgba(14,19,32,0.55)', padding: '10px 16px', borderRadius: '10px',
        fontFamily: 'Segoe UI, Roboto, sans-serif', fontSize: '14px',
        border: '1px solid rgba(91,127,176,0.5)', backdropFilter: 'blur(6px)', zIndex: '100',
    });
    root.appendChild(backBtn);

    // 語言切換鈕：放在 back 右側（右上角已被數據面板佔用）
    mountLangToggle({ style: { top: '24px', left: '120px' } });
})();

// ------------------------------------------------
// helpers
// ------------------------------------------------
function makeGradientTexture(top: string, bottom: string): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
