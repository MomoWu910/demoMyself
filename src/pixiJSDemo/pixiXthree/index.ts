import { Application, Container, Graphics, Text, TextStyle, Assets, Sprite, WebGLRenderer } from 'pixi.js';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import gsap from 'gsap';
import shibaPng from './res/shiba.png';
import { showGameInfosPannel } from '../../tools';

(async () => {
    // Root setup
    const root = document.createElement('div');
    Object.assign(root.style, { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' });
    document.body.appendChild(root);

    const threeCanvas = document.createElement('canvas');
    Object.assign(threeCanvas.style, { position: 'absolute', top: '0', left: '0', zIndex: '0', pointerEvents: 'auto' });
    root.appendChild(threeCanvas);

    // ==========================================
    // 1. 初始化物理世界
    // ==========================================
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0); 
    world.broadphase = new CANNON.SAPBroadphase(world); 
    
    // 調整材質屬性：增加摩擦力，減少彈力 (避免球亂噴)
    const defaultMaterial = new CANNON.Material('default');
    const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
        friction: 0.9,     // 摩擦力低一點，讓球容易滾動
        restitution: 0.2,  // 彈力低一點，避免球越彈越高飛出去
    });
    world.addContactMaterial(defaultContactMaterial);

    // ==========================================
    // 2. Three.js 初始化
    // ==========================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 8; // 視角拉遠
    
    const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, stencil: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0, 10, 10);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x606060));

    // ==========================================
    // 3. 建立密封滾輪 (Sealed Reel)
    // ==========================================
    
    // 參數設定
    const reelRadius = 3;
    const reelDepth = 3;
    const segments = 16; // 增加分段數，讓圓更圓

    // --- A. 視覺 (Three.js) ---
    const reelGroup = new THREE.Group();
    scene.add(reelGroup);

    // 1. 圓柱本體
    const cylinderGeo = new THREE.CylinderGeometry(reelRadius, reelRadius, reelDepth, 32, 1, true);
    const reelMat = new THREE.MeshBasicMaterial({ color: 0xffd700, wireframe: true, transparent: true, opacity: 0.2 });
    const cylinderMesh = new THREE.Mesh(cylinderGeo, reelMat);
    cylinderMesh.rotation.z = Math.PI / 2; // 讓圓柱躺在 X 軸上
    reelGroup.add(cylinderMesh);

    // 2. 兩側蓋子 (視覺)
    const capGeo = new THREE.CircleGeometry(reelRadius, 32);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.1, side: THREE.DoubleSide });
    
    const leftCap = new THREE.Mesh(capGeo, capMat);
    leftCap.position.x = -reelDepth / 2;
    leftCap.rotation.y = Math.PI / 2;
    
    const rightCap = new THREE.Mesh(capGeo, capMat);
    rightCap.position.x = reelDepth / 2;
    rightCap.rotation.y = Math.PI / 2;

    reelGroup.add(leftCap);
    reelGroup.add(rightCap);

    // --- B. 物理 (Cannon.js) ---
    // 我們要手動拼出一個「躺在 X 軸上」的八角籠
    const reelBody = new CANNON.Body({
        mass: 0, // Kinematic
        type: CANNON.Body.KINEMATIC,
        material: defaultMaterial
    });

    // 1. 計算牆壁寬度 (關鍵數學)
    // 為了保證無縫隙，板子寬度必須大於弦長
    // 弦長公式 = 2 * r * sin(PI / segments)
    // 我們乘上 1.1 做為安全係數，讓板子互相穿插重疊，防止漏球
    const plankWidth = (2 * reelRadius * Math.sin(Math.PI / segments)) * 1.1;
    const plankThickness = 0.5; // ★ 加厚牆壁防止穿模

    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        
        // 建立牆壁 (板子)
        const wallShape = new CANNON.Box(new CANNON.Vec3(reelDepth / 2, plankThickness, plankWidth / 2));
        
        // 計算位置 (在 Y-Z 平面上圍成一圈)
        // 注意：我們要讓板子中心點向外擴一點 (radius + thickness/2)，這樣球才會在 radius 內部滾
        const y = Math.cos(angle) * (reelRadius + plankThickness / 2);
        const z = Math.sin(angle) * (reelRadius + plankThickness / 2);
        
        // 計算旋轉 (繞 X 軸轉，讓板子面向圓心)
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), angle);

        // 加到 Body (注意這裡 x=0，因為圓柱中心在 x=0)
        reelBody.addShape(wallShape, new CANNON.Vec3(0, y, z), q);

        // 加入內部肋條 (Lifters/Ribs)
        // 每隔 4 個面 (90度) 加一個向內突出的板子，負責把球鏟起來
        if (i % 4 === 0) {
            const ribHeight = 0.3; // 肋條突出高度
            const ribShape = new CANNON.Box(new CANNON.Vec3(reelDepth / 2, ribHeight, 0.1)); // 薄板
            
            // 位置：在牆壁內側
            const ribY = Math.cos(angle) * (reelRadius - ribHeight); 
            const ribZ = Math.sin(angle) * (reelRadius - ribHeight);
            
            reelBody.addShape(ribShape, new CANNON.Vec3(0, ribY, ribZ), q);
            
            // (選用) 如果你想在視覺上也看到這個肋條，可以在這裡加 Three.js Mesh 到 reelGroup
            // 但為了簡化，我們讓它保持隱形，讓球看起來像是被摩擦力帶起來的
        }
    }

    // 2. 物理封蓋 (Physics Caps)
    // 在左右兩側加上超級大的牆壁
    const capThickness = 0.5;
    const capShape = new CANNON.Box(new CANNON.Vec3(capThickness, reelRadius * 1.5, reelRadius * 1.5));
    
    // 左蓋
    reelBody.addShape(capShape, new CANNON.Vec3(-(reelDepth / 2 + capThickness / 2), 0, 0));
    // 右蓋
    reelBody.addShape(capShape, new CANNON.Vec3((reelDepth / 2 + capThickness / 2), 0, 0));

    world.addBody(reelBody);


    // ==========================================
    // 4. 建立球體
    // ==========================================
    const balls: { mesh: THREE.Mesh, body: CANNON.Body }[] = [];
    const ballGeo = new THREE.SphereGeometry(0.3, 16, 16);
    
    // 增加球的數量，測試穩定性
    for (let i = 0; i < 20; i++) {
        const color = new THREE.Color().setHSL(Math.random(), 1, 0.5);
        const ballMesh = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color }));
        scene.add(ballMesh);

        const ballBody = new CANNON.Body({
            mass: 1,
            shape: new CANNON.Sphere(0.3), // 碰撞半徑
            material: defaultMaterial,
            // 讓球從圓心稍微散開的地方生成
            position: new CANNON.Vec3(
                (Math.random() - 0.5) * (reelDepth - 1), 
                (Math.random() - 0.5) * 2-1, 
                (Math.random() - 0.5) * 1
            )
        });
        
        // 增加阻尼，讓球滾動稍微黏一點，不會像彈力球亂飛
        ballBody.linearDamping = 0.01;
        ballBody.angularDamping = 0.01;

        world.addBody(ballBody);
        balls.push({ mesh: ballMesh, body: ballBody });
    }

    // ==========================================
    // 5. PixiJS UI (介面層)
    // ==========================================
    const pixiApp = new Application();
    const pixiRenderer = new WebGLRenderer();
    await pixiRenderer.init({
        context: renderer.getContext() as WebGL2RenderingContext,
        canvas: threeCanvas,
        width: window.innerWidth,
        height: window.innerHeight,
        clearBeforeRender: false,
    })
    pixiApp.renderer = pixiRenderer;

    await pixiApp.init({ canvas: threeCanvas, backgroundAlpha: 0, preference: 'webgl', antialias: true });
    
    (globalThis as any).__PIXI_APP__ = pixiApp;
    // showGameInfosPannel(pixiApp, ['fps', 'drawcalls']);

    const uiContainer = new Container();
    uiContainer.sortableChildren = true;
    pixiApp.stage.addChild(uiContainer);

    // Avatar
    const avatarContainer = new Container();
    avatarContainer.zIndex = 10;
    avatarContainer.position.set(150, 50);
    try {
        const shibaTex = await Assets.load(shibaPng);
        const shiba = new Sprite(shibaTex);
        shiba.width = 80;
        shiba.height = 80;
        const mask = new Graphics().circle(40, 40, 40).fill(0xffffff);
        shiba.mask = mask;
        shiba.addChild(mask);
        avatarContainer.addChild(shiba);
    } catch (e) {
        const circle = new Graphics().circle(40, 40, 40).fill(0x555555);
        avatarContainer.addChild(circle);
    }
    const border = new Graphics().circle(40, 40, 42).stroke({ width: 4, color: 0xffd700 });
    avatarContainer.addChild(border);
    uiContainer.addChild(avatarContainer);

    // Balance
    const balanceStyle = new TextStyle({
        fontFamily: 'Arial',
        fontSize: 36,
        fontWeight: 'bold',
        fill: 0xffd700, 
        stroke: { color: '#000000', width: 4 },
        dropShadow: { color: '#000000', blur: 4, angle: Math.PI / 6, distance: 6 },
    });
    const balanceText = new Text({ text: '$ 10,000', style: balanceStyle });
    balanceText.zIndex = 10;
    balanceText.position.set(250, 65);
    uiContainer.addChild(balanceText);
    
    // Spin Button
    const btnContainer = new Container();
    btnContainer.interactive = true;
    btnContainer.cursor = 'pointer';
    btnContainer.zIndex = 9;
    btnContainer.position.set(window.innerWidth / 2, window.innerHeight - 100);
    const btnBg = new Graphics().roundRect(-100, -40, 200, 80, 40).fill(0x28a745).stroke({ width: 4, color: 0xffffff });
    const btnText = new Text({ text: 'SPIN', style: { fontFamily: 'Arial', fontSize: 30, fontWeight: 'bold', fill: 'white' } });
    btnText.anchor.set(0.5);
    btnBg.addChild(btnText);
    btnContainer.addChild(btnBg);
    uiContainer.addChild(btnContainer);


    // ==========================================
    // 6. 旋轉與物理邏輯
    // ==========================================
    let isSpinning = false;
    let balance = 10000;
    const reelState = { angle: 0 }; 

    btnContainer.on('pointerdown', () => {
        if (isSpinning) return;
        isSpinning = true;
        
        balance -= 100;
        balanceText.text = `$ ${balance.toLocaleString()}`;
        
        gsap.to(btnContainer.scale, { x: 0.9, y: 0.9, duration: 0.1, yoyo: true, repeat: 1 });

        // 轉 3 圈 (6 PI)
        const targetAngle = reelState.angle + Math.PI * 6; 

        gsap.to(reelState, {
            angle: targetAngle,
            duration: 5,
            ease: "power1.inOut", // 慢進慢出，讓球有時間滾動
            onUpdate: () => {
                // ★ 核心：控制物理 Body 旋轉 (繞 X 軸)
                reelBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), reelState.angle);
            },
            onComplete: () => {
                isSpinning = false;
                if (Math.random() > 0.5) {
                    const targetBalance = balance + 200;
                    const temp = { val: balance };
                    gsap.to(temp, {
                        val: targetBalance,
                        duration: 0.5,
                        onUpdate: () => {
                            balanceText.text = `$ ${Math.floor(temp.val).toLocaleString()}`;
                        },
                        onComplete: () => { balance = targetBalance; }
                    });
                }
            }
        });
    });

    // ==========================================
    // 7. Render Loop
    // ==========================================
    const clock = new THREE.Clock();
    let oldTime = 0;

    pixiApp.ticker.stop(); 

    function animate() {
        // // Render the Three.js scene
        renderer.resetState();
        renderer.render(scene, camera);

        // // Render the PixiJS stage
        // Reset PixiJS internal state because Three.js has modified the WebGL state
        const gl = renderer.getContext() as WebGL2RenderingContext;
        
        // Essential State Resets for Shared Context
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.clear(gl.STENCIL_BUFFER_BIT); // ★ 必須清空 Stencil，否則 Mask (頭像) 會因為髒資料而消失
        gl.bindVertexArray(null);

        if ((pixiRenderer as any).reset) {
            (pixiRenderer as any).reset();
        }
        pixiRenderer.render({ container: pixiApp.stage });


        const elapsedTime = clock.getElapsedTime();
        const deltaTime = elapsedTime - oldTime;
        oldTime = elapsedTime;

        // 物理更新 (增加 substeps 讓球不會穿牆)
        // 1/60 是理想幀率，deltaTime 是實際時間，10 是最大子步數
        world.step(1 / 60, deltaTime, 10);

        // 同步視覺位置
        reelGroup.position.copy(reelBody.position as any);
        reelGroup.quaternion.copy(reelBody.quaternion as any);

        balls.forEach(item => {
            item.mesh.position.copy(item.body.position as any);
            item.mesh.quaternion.copy(item.body.quaternion as any);
        });

        requestAnimationFrame(animate);
    }

    animate();

    window.addEventListener('resize', () => {
        const w = window.innerWidth;
        const h = window.innerHeight;

        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        
        renderer.setSize(w, h);
        pixiRenderer.resize(w, h); // Sync PixiJS size
        
        btnContainer.position.set(w / 2, h - 100);
    });

    // Back Button
    const backBtn = document.createElement('a');
    backBtn.innerText = '← Back';
    backBtn.href = './pixi_hub.html';
    Object.assign(backBtn.style, { 
        position: 'absolute',
        top: '55px',
        left: '20px',
        color: 'white',
        textDecoration: 'none',
        background: 'rgba(0,0,0,0.3)',
        padding: '10px 15px',
        borderRadius: '8px',
        fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        backdropFilter: 'blur(5px)',
        transition: 'background 0.3s',
        zIndex: '100'
    });
    document.body.appendChild(backBtn);

})();