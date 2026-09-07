import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PLACES, SEATS, STARS, TREES, PATHS } from './world';
import { archWindow, turnedRoof, block, sweep, bench, flower, fence, stoneSurface, batchScenery, finish } from './craft';

const C = { cream: '#fff4db', pink: '#ee9bb2', rose: '#d97999', mint: '#82cdb7', teal: '#519fa7', blue: '#9dd5e8', purple: '#ad99cf', gold: '#eec56c', grass: '#a5ce9c' };
const materials = new Map<string, T.MeshStandardMaterial>();
function mat(color: string): T.MeshStandardMaterial {
    if (!materials.has(color)) materials.set(color, new T.MeshStandardMaterial({ color, roughness: .63 }));
    return materials.get(color)!;
}
const sphereGeo = new T.SphereGeometry(1, 24, 16);
const boxGeo = new RoundedBoxGeometry(1, 1, 1, 2, .12);
function mesh(parent: T.Object3D, geo: T.BufferGeometry, color: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): T.Mesh {
    const m = new T.Mesh(geo, mat(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const ball = (p: T.Object3D, c: string, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx): T.Mesh => mesh(p, sphereGeo, c, x, y, z, sx, sy, sz);
const box = (p: T.Object3D, c: string, x: number, y: number, z: number, w: number, h: number, d: number): T.Mesh => mesh(p, boxGeo, c, x, y, z, w, h, d);
function cylinder(p: T.Object3D, color: string, x: number, y: number, z: number, r: number, h: number, top = r, segments = 24): T.Mesh {
    return mesh(p, new T.CylinderGeometry(top, r, h, segments), color, x, y, z);
}
function rod(p: T.Object3D, a: T.Vector3, b: T.Vector3, r: number, color: string): T.Mesh {
    const d = b.clone().sub(a); const m = cylinder(p, color, 0, 0, 0, r, d.length(), r, 8);
    m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); return m;
}
function ring(p: T.Object3D, color: string, x: number, y: number, z: number, radius: number, tube: number): T.Mesh {
    return mesh(p, new T.TorusGeometry(radius, tube, 8, 64), color, x, y, z);
}
function label(p: T.Object3D, text: string, x: number, y: number, z: number, w: number, h: number, bg = '#fff7e1', ink = '#586e72'): T.Mesh {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 160;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, 768, 160);
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.strokeRect(12, 12, 744, 136);
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 54px system-ui'; ctx.fillText(text, 384, 82, 700);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }));
    m.position.set(x, y, z); p.add(m); return m;
}
function starGeo(): T.ExtrudeGeometry {
    const shape = new T.Shape();
    for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .45 : 1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (!i) shape.moveTo(x, y); else shape.lineTo(x, y); }
    shape.closePath(); return new T.ExtrudeGeometry(shape, { depth: .2, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .08, bevelThickness: .06 });
}
const starGeometry = starGeo();
function star(p: T.Object3D, color: string, x: number, y: number, z: number, size: number): T.Mesh { return mesh(p, starGeometry, color, x, y, z, size, size, size); }
export interface Bunny { root: T.Group; legs: T.Group[]; arms: T.Group[]; balloon: T.Group; ears: T.Group[]; eyes: T.Mesh[]; shadow: T.Mesh }
function bunny(parent: T.Object3D, x: number, z: number, color: string): Bunny {
    const root = new T.Group(); root.position.set(x, 0, z); parent.add(root);
    ball(root, color, 0, .82, 0, .38, .46, .29);
    ball(root, '#fff9ee', 0, 1.44, .025, .47, .42, .39);
    const ears: T.Group[] = [], eyes: T.Mesh[] = [];
    for (const s of [-1, 1]) {
        const ear = new T.Group(); ear.position.set(s * .23, 1.72, 0); root.add(ear); ears.push(ear);
        ball(ear, '#fff9ee', 0, .25, 0, .13, .43, .12); ear.rotation.z = -s * .12;
        ball(ear, '#edb4bd', 0, .28, .1, .066, .27, .035);
        const eye = ball(root, '#424b57', s * .16, 1.47, .382, .047, .064, .028); eyes.push(eye);
        ball(root, '#ffffff', s * .16 - .014, 1.493, .406, .014, .018, .009);
        ball(root, '#f0b4b5', s * .28, 1.33, .35, .086, .046, .015);
    }
    ball(root, '#d38e9e', 0, 1.36, .421, .043, .032, .025);
    ball(root, C.cream, 0, .75, .255, .22, .21, .065);
    box(root, C.rose, 0, .87, -.3, .43, .5, .2);
    // Sewn backpack: piping, flap, pocket, shoulder straps and a little enamel star.
    block(root, '#b9708c', 0, .83, -.43, .43, .46, .075, .08);
    block(root, '#efb6c4', 0, 1.04, -.46, .46, .2, .075, .065);
    block(root, '#e9a8ba', 0, .73, -.49, .28, .19, .075, .045);
    for (const s of [-1, 1]) {
        sweep(root, '#eec7b1', [[s * .22, .64, -.25], [s * .29, 1.04, -.1], [s * .2, 1.14, .16], [s * .19, .77, .29]], .029);
        ball(root, C.gold, s * .19, .87, .282, .035);
    }
    sweep(root, '#fae1c7', [[-.12, 1.13, -.31], [-.1, 1.26, -.3], [.1, 1.26, -.3], [.12, 1.13, -.31]], .025);
    const charm = star(root, C.gold, .15, .8, -.53, .075); charm.rotation.y = Math.PI;
    ball(root, '#fff9ee', 0, .52, -.29, .13);
    const collar = ring(root, '#efce83', 0, 1.12, .01, .23, .065); collar.rotation.x = Math.PI / 2; collar.scale.z = .65;
    const scarf = block(root, '#edc16e', .12, .96, .3, .12, .3, .06); scarf.rotation.z = .2;
    sweep(root, '#a88180', [[-.07, 1.31, .414], [-.035, 1.28, .42], [0, 1.3, .425], [.035, 1.28, .42], [.07, 1.31, .414]], .008);
    for (let i = -1; i <= 1; i++) { const tuft = ball(root, '#fff9ee', i * .085, 1.83, .14, .075, .12, .07); tuft.rotation.z = i * -.3; }
    const legs: T.Group[] = [], arms: T.Group[] = [];
    for (const s of [-1, 1]) {
        const leg = new T.Group(); leg.position.set(s * .18, .45, 0); root.add(leg);
        ball(leg, '#fff9ee', 0, -.18, .065, .15, .23, .21); legs.push(leg);
        ball(leg, '#d5b08e', 0, -.32, .095, .158, .085, .22);
        const arm = new T.Group(); arm.position.set(s * .35, 1.0, 0); root.add(arm);
        ball(arm, '#fff9ee', s * .055, -.16, 0, .115, .24, .12); arms.push(arm);
    }
    const balloon = new T.Group(); root.add(balloon); balloon.visible = false;
    rod(balloon, new T.Vector3(.45, .85, 0), new T.Vector3(.7, 3.1, -.1), .008, '#b7a486');
    ball(balloon, C.pink, .7, 3.45, -.1, .38, .48, .36);
    // An inexpensive contact shadow stays with the player; static world shadows are baked once.
    const shadow = new T.Mesh(new T.CircleGeometry(.48, 24), new T.MeshBasicMaterial({ color: '#5f8264', transparent: true, opacity: .2, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .06; root.add(shadow);
    root.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = false; });
    return { root, legs, arms, balloon, ears, eyes, shadow };
}
export interface ParkScene {
    scene: T.Scene; avatar: Bunny; cameraBlockers: T.Mesh[];
    update: (time: number, moving: number, seated: boolean, jumpHeight: number) => void; collect: (i: number) => void;
    wish: () => void; rideSeat: (id: 'wheel' | 'carousel', time: number) => { position: T.Vector3; yaw: number }; dispose: () => void;
}
export function rideSeatPose(id: 'wheel' | 'carousel', time: number): { position: T.Vector3; yaw: number } {
    if (id === 'wheel') {
        const angle = time * .1;
        // Cabin zero stays upright. The left seat is behind the front window at bench height.
        return { position: new T.Vector3(-28 + Math.cos(angle) * 9 - .38, 11.25 + Math.sin(angle) * 9, -16.35), yaw: 0 };
    }
    const angle = -time * .22;
    // Match pony zero, its reversed turn and its vertical bob.
    return {
        position: new T.Vector3(28 + Math.cos(angle) * 5.5 - Math.sin(angle) * .1,
            2.66 + Math.sin(time * 1.7) * .3,
            -14 - Math.sin(angle) * 5.5 - Math.cos(angle) * .1),
        yaw: angle,
    };
}
export function createPark(): ParkScene {
    const scene = new T.Scene(); scene.background = new T.Color('#c6e6ed'); scene.fog = new T.Fog('#c6e6ed', 65, 150);
    scene.add(new T.HemisphereLight('#e9f5ff', '#91aa83', 1.7));
    const sun = new T.DirectionalLight('#fff0d4', 2.7); sun.position.set(-35, 60, 30); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .08; scene.add(sun);
    const cameraBlockers: T.Mesh[] = [];
    // A soft, floating island with sea and a distant ring of pastel hills.
    const sea = mesh(scene, new T.PlaneGeometry(1600, 1600), '#a9dce4', 0, -1.1, 0); sea.rotation.x = -Math.PI / 2; sea.castShadow = false;
    cylinder(scene, '#e8d6ae', 0, -1, 0, 70, 2, 66, 64);
    cylinder(scene, C.grass, 0, -.07, 0, 66, .25, 66, 64);
    for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        ball(scene, i % 2 ? '#b3d2ba' : '#acd2c2', Math.sin(a) * 110, 0, Math.cos(a) * 110, 16 + i % 3 * 4, 13 + i % 4 * 4, 16);
    }
    // Broad promenade, crosswalks and destination spurs: same coordinate plan as the map.
    stoneSurface(scene, PATHS);
    cylinder(scene, '#e9c7ac', 0, .18, 0, 10, .2, 10, 64); cylinder(scene, '#f7e5c4', 0, .3, 0, 9.6, .15, 9.6, 64);
    for (let z = -18; z < 37; z += 3) for (const x of [-4.5, 4.5]) box(scene, '#dac3a6', x, .2, z, .18, .015, 1.4).castShadow = false;

    // Fountain: scalloped basin, water tiers, droplets and a golden wishing star.
    cylinder(scene, '#eee2cf', 0, .5, 0, 4.4, .8); cylinder(scene, '#79c9d3', 0, .94, 0, 3.9, .12);
    const rim = ring(scene, C.cream, 0, .95, 0, 4.1, .24); rim.rotation.x = Math.PI / 2;
    cylinder(scene, C.cream, 0, 1.8, 0, .65, 2.1); cylinder(scene, C.cream, 0, 2.45, 0, 2.0, .35, 1.65);
    const water = cylinder(scene, '#87d8dd', 0, 2.65, 0, 1.65, .12);
    cylinder(scene, C.cream, 0, 3.15, 0, .27, 1.1); star(scene, C.gold, 0, 4.05, 0, .8);
    for (let i = 0; i < 48; i++) {
        const a = i / 48 * Math.PI * 2;
        const tile = block(scene, i % 2 ? '#b2c9bd' : '#efd7b5', Math.cos(a) * 8.7, .397, Math.sin(a) * 8.7, .74, .035, .54); tile.rotation.y = -a;
    }
    for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        const motif = ball(scene, '#e6c28d', Math.cos(a) * 4.37, .53, Math.sin(a) * 4.37, .13, .18, .13);
        motif.material = finish('#e6c28d', true);
    }
    const streams: T.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const stream = sweep(scene, '#9fdde1', [[Math.cos(a) * 1.6, 2.61, Math.sin(a) * 1.6], [Math.cos(a) * 2.1, 2.6, Math.sin(a) * 2.1], [Math.cos(a) * 2.65, 2.1, Math.sin(a) * 2.65], [Math.cos(a) * 2.9, 1.0, Math.sin(a) * 2.9]], .032);
        stream.castShadow = false; streams.push(stream);
    }
    const drops: T.Mesh[] = [];
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; drops.push(ball(scene, '#c3f1ee', Math.cos(a) * 1.7, 1.5, Math.sin(a) * 1.7, .075, .2, .075)); }

    // Casino: a toy castle with an unmistakable central entrance, marquee and twin towers.
    const casino = new T.Group(); casino.position.set(0, 0, -31); scene.add(casino);
    cameraBlockers.push(box(casino, '#c2b4df', 0, 3.8, 0, 18, 7.6, 13));
    box(casino, C.cream, 0, .55, 0, 20, 1.1, 15);
    box(casino, '#edb4c4', 0, 7.4, 0, 19.5, .6, 14);
    box(casino, '#aa8dbe', 0, 8, -.5, 17, 1, 11);
    for (const x of [-7.7, 7.7]) {
        cylinder(casino, '#fff0db', x, 5, 4, 2.4, 10);
        turnedRoof(casino, x, 9.75, 4, 2.85, 3.65, '#cc86a6');
        ball(casino, C.gold, x, 13.5, 4, .23);
        archWindow(casino, x, 4.05, 6.39, 1.3, 2.5);
        for (const y of [1.05, 3.25, 7.6, 9.25]) { const band = ring(casino, y === 7.6 ? '#f0d19a' : '#ead6b8', x, y, 4, 2.43, .09); band.rotation.x = Math.PI / 2; }
        for (let j = 0; j < 9; j++) {
            const a = j / 8 * Math.PI;
            block(casino, '#e8d9c6', x + Math.cos(a) * 2.37, 2 + j % 2 * .38, 4 + Math.sin(a) * 2.37, .33, .2, .13).rotation.y = Math.PI / 2 - a;
        }
    }
    box(casino, C.cream, 0, 4.2, 6.65, 7.6, 7, .8);
    box(casino, '#4e647d', 0, 2.45, 7.14, 3.9, 4.4, .2);
    for (const x of [-1, 1]) { box(casino, '#7594b3', x, 2.45, 7.27, 1.7, 3.9, .08); box(casino, C.gold, x * .23, 2.3, 7.4, .08, .6, .1); }
    box(casino, C.gold, 0, 4.85, 7.25, 4.6, .25, .35);
    // Recessed door panels, transom arch, sculpted cornices and wall pilasters.
    archWindow(casino, 0, .55, 7.4, 3.6, 4.65, '#f4d795');
    for (const x of [-.9, .9]) {
        block(casino, '#3f647a', x, 1.65, 7.55, 1.45, 1.9, .04);
        for (const y of [.78, 2.56]) block(casino, '#d3b47f', x, y, 7.6, 1.55, .06, .06);
        ball(casino, '#edce8b', x * .25, 2.55, 7.68, .09);
    }
    for (const x of [-3.65, 3.65]) {
        for (const y of [.5, .8, 5.8, 6.1]) block(casino, '#f1dfc1', x, y, 7.05, .9, .19, .8);
        block(casino, '#ffeed2', x, 3.3, 6.98, .48, 5.2, .48);
        for (const offset of [-.13, 0, .13]) block(casino, '#e8d3b3', x + offset, 3.3, 7.24, .045, 4.6, .035);
    }
    for (const y of [1.0, 5.75, 7.6, 7.95]) block(casino, y > 7 ? '#f6d5af' : '#d7c2bb', 0, y, 6.62, 17.5, .12, .18);
    // A layered art-deco crown silhouettes the facade from the entrance promenade.
    const pediment = new T.Shape(); pediment.moveTo(-5, 0); pediment.lineTo(-5, .4); pediment.quadraticCurveTo(-2, .3, 0, 3.2); pediment.quadraticCurveTo(2, .3, 5, .4); pediment.lineTo(5, 0); pediment.closePath();
    mesh(casino, new T.ExtrudeGeometry(pediment, { depth: .45, bevelEnabled: true, bevelSize: .1, bevelThickness: .08, bevelSegments: 3, steps: 1 }), '#efd1bb', 0, 8.0, 5.7);
    const clockRim = ring(casino, C.gold, 0, 8.85, 6.3, .68, .1); clockRim.material = finish(C.gold, true);
    const crest = cylinder(casino, '#fff2d2', 0, 8.85, 6.3, .65, .05); crest.rotation.x = Math.PI / 2;
    star(casino, C.gold, 0, 8.85, 6.39, .4);
    label(casino, 'STARLIGHT CASINO', 0, 6.75, 7.13, 11.5, 1.65, '#77658c', '#fff1ca');
    star(casino, C.gold, 0, 9.85, 5.8, 1.4);
    for (let i = -7; i <= 7; i++) ball(casino, '#fff0ad', i * .75, 5.8, 7.15, .1);
    for (const x of [-4.9, 4.9]) for (const y of [1.1, 3.7]) archWindow(casino, x, y, 6.72, 1.35, 2.0);
    for (const side of [-1, 1]) for (const z of [-3, 1]) { const window = archWindow(casino, side * 9.05, 2.3, z, 2.1, 3.2); window.rotation.y = side * Math.PI / 2; }
    box(scene, '#d99aaa', 0, .22, -20.5, 4, .08, 5);
    for (const x of [-3.3, 3.3]) { cylinder(scene, C.gold, x, .75, -19.5, .1, 1.5); ball(scene, C.gold, x, 1.55, -19.5, .17); }
    for (const x of [-3.3, 3.3]) {
        cylinder(scene, C.gold, x, .75, -22, .1, 1.5); ball(scene, C.gold, x, 1.55, -22, .17);
        sweep(scene, '#b36f88', [[x, 1.45, -22], [x, 1.06, -20.7], [x, 1.45, -19.5]], .055);
    }

    // Ferris wheel. Cabin pivots counter-rotate so passengers stay upright.
    const wheelBase = new T.Group(); wheelBase.position.set(-28, 0, -17); scene.add(wheelBase);
    cylinder(wheelBase, '#ece0d0', 0, .4, 0, 8.6, .8);
    for (const z of [-1.9, 1.9]) for (const x of [-5, 5]) rod(wheelBase, new T.Vector3(x, .5, z), new T.Vector3(0, 12, z), .3, C.cream);
    const wheel = new T.Group(); wheel.position.set(0, 12, 0); wheelBase.add(wheel);
    for (const z of [-.55, .55]) { ring(wheel, C.pink, 0, 0, z, 9, .23); ring(wheel, C.cream, 0, 0, z, 8.5, .1); }
    ball(wheelBase, C.gold, 0, 12, 1, .7);
    ring(wheelBase, '#f1d898', 0, 12, 1.45, .95, .13); star(wheelBase, C.cream, 0, 12, 1.7, .48);
    for (let i = 0; i < 40; i++) {
        const a = i / 40 * Math.PI * 2;
        ball(wheel, '#fff0be', Math.cos(a) * 8.95, Math.sin(a) * 8.95, .81, .1);
        if (i % 2 === 0) rod(wheel, new T.Vector3(Math.cos(a) * 7, Math.sin(a) * 7, .2), new T.Vector3(Math.cos(a + Math.PI / 10) * 9, Math.sin(a + Math.PI / 10) * 9, .2), .045, '#e4c5b2');
    }
    const cabins: T.Group[] = [];
    for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2, x = Math.cos(a) * 9, y = Math.sin(a) * 9;
        rod(wheel, new T.Vector3(0, 0, 0), new T.Vector3(x, y, 0), .07, C.cream);
        const cabin = new T.Group(); cabin.position.set(x, y, 0); wheel.add(cabin); cabins.push(cabin);
        const colors = [C.pink, C.blue, C.mint, C.gold, C.purple];
        // A real open cabin: lower skirt, rear wall and side panels instead of a solid box.
        box(cabin, colors[i % 5], 0, -1.05, 0, 1.7, .6, 1.5);
        box(cabin, colors[i % 5], 0, -.65, -.69, 1.7, 1.4, .12);
        for (const side of [-1, 1]) box(cabin, colors[i % 5], side * .79, -.65, 0, .12, 1.4, 1.5);
        box(cabin, '#cbeaf0', 0, -.22, .77, 1.28, .63, .05);
        box(cabin, C.cream, 0, .22, 0, 1.9, .22, 1.7);
        box(cabin, C.cream, 0, -.22, .82, .08, .7, .06);
        for (const s of [-1, 1]) {
            archWindow(cabin, s * .42, -.55, .83, .55, .9, '#fff1d2', .28);
            const sideWindow = archWindow(cabin, s * .88, -.55, 0, .85, .9, '#fff1d2', .28); sideWindow.rotation.y = s * Math.PI / 2;
        }
        box(cabin, '#e5cba5', 0, -1.37, 0, 1.8, .12, 1.55);
        turnedRoof(cabin, 0, .25, 0, 1.03, .65, colors[i % 5]);
        rod(cabin, new T.Vector3(0, .85, 0), new T.Vector3(0, 1.13, 0), .055, C.gold);
        const hinge = ring(cabin, C.gold, 0, 1.18, 0, .13, .035); hinge.castShadow = false;
    }
    label(wheelBase, 'SKY WHEEL', 0, 2.2, 4.2, 5, 1.05);
    for (const s of [-1, 1]) fence(scene, -28 + s * 5.8, -10.9, 4.3);

    // Carousel: striped tent, gold poles and little cloud ponies.
    const carousel = new T.Group(); carousel.position.set(28, 0, -14); scene.add(carousel);
    cylinder(carousel, '#e6c5a8', 0, .4, 0, 8.2, .8); cylinder(carousel, C.cream, 0, .88, 0, 7.8, .2);
    const turntable = new T.Group(); carousel.add(turntable);
    cylinder(turntable, C.pink, 0, 1.02, 0, 7.3, .15); cylinder(carousel, C.gold, 0, 3.8, 0, .6, 6);
    for (let i = 0; i < 12; i++) {
        mesh(carousel, new T.ConeGeometry(8.5, 3.3, 4, 1, false, i * Math.PI / 6, Math.PI / 6), i % 2 ? C.cream : C.pink, 0, 7.2, 0);
    }
    const canopyRim = ring(carousel, C.gold, 0, 5.57, 0, 8.4, .17); canopyRim.rotation.x = Math.PI / 2;
    for (let i = 0; i < 36; i++) {
        const a = i / 36 * Math.PI * 2;
        const scallop = ball(carousel, i % 3 === 0 ? '#e5ba7e' : '#fff0d2', Math.cos(a) * 8.24, 5.45, Math.sin(a) * 8.24, .4, .38, .2); scallop.rotation.y = -a + Math.PI / 2;
        ball(carousel, '#ffdf90', Math.cos(a) * 8.1, 5.3, Math.sin(a) * 8.1, .08);
    }
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        cylinder(carousel, '#fff0d2', Math.cos(a) * 7.4, 3.4, Math.sin(a) * 7.4, .16, 4.9);
        for (const y of [1.15, 1.5, 5.0, 5.4]) cylinder(carousel, C.gold, Math.cos(a) * 7.4, y, Math.sin(a) * 7.4, .23, .13);
        sweep(carousel, '#f1c889', [[Math.cos(a) * .5, 8.7, Math.sin(a) * .5], [Math.cos(a) * 4.5, 7.15, Math.sin(a) * 4.5], [Math.cos(a) * 8.5, 5.57, Math.sin(a) * 8.5]], .04);
    }
    star(carousel, C.gold, 0, 9.7, 0, .8);
    const ponies: T.Group[] = [];
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, x = Math.cos(a) * 5.5, z = Math.sin(a) * 5.5;
        cylinder(turntable, C.gold, x, 3.3, z, .08, 4.5);
        const pony = new T.Group(); pony.position.set(x, 2, z); pony.rotation.y = -a; turntable.add(pony); ponies.push(pony);
        ball(pony, C.cream, 0, 0, 0, .45, .48, .8); ball(pony, C.cream, 0, .65, .6, .31, .52, .32);
        ball(pony, C.purple, 0, .75, .34, .32, .42, .16); box(pony, C.mint, 0, .39, -.12, .7, .14, .62);
        for (const s of [-1, 1]) { ball(pony, '#465861', s * .26, .78, .8, .045); ball(pony, C.cream, s * .26, -.46, .37, .13, .34, .14); ball(pony, C.cream, s * .26, -.46, -.46, .13, .34, .14); }
        cylinder(pony, C.gold, 0, 1.3, .7, .13, .55, 0, 8);
        for (const s of [-1, 1]) {
            const ear = ball(pony, C.cream, s * .2, 1.02, .5, .1, .22, .09); ear.rotation.z = -s * .35;
            ball(pony, '#cbaccf', s * .205, 1.04, .575, .055, .14, .015);
            sweep(pony, '#ba8d63', [[s * .27, .84, .75], [s * .3, .5, .85], [s * .24, .36, .85]], .035);
            sweep(pony, '#d0ab69', [[s * .3, .44, .73], [s * .46, .3, .24], [s * .45, .3, -.1]], .02);
            const stirrup = ring(pony, C.gold, s * .49, -.05, -.1, .15, .025); stirrup.rotation.y = Math.PI / 2;
            for (const z of [.37, -.46]) ball(pony, '#d5ae70', s * .26, -.71, z, .15, .08, .17);
        }
        for (let j = 0; j < 5; j++) sweep(pony, j % 2 ? '#c5a7d4' : '#e0c5e4', [[0, 1.01 - j * .07, .35 - j * .06], [.07, .83 - j * .08, .24 - j * .065], [.14, .53 - j * .04, .25 - j * .06]], .07);
        sweep(pony, '#c3a4d1', [[0, .2, -.72], [0, .27, -1.01], [.16, -.15, -1.13], [.28, -.38, -.95]], .13);
        block(pony, '#d9b274', 0, .34, -.11, .78, .055, .7);
        block(pony, '#8bb8b5', 0, .39, -.1, .7, .09, .58);
        star(pony, C.gold, -.37, .23, -.14, .11).rotation.y = -Math.PI / 2;
    }
    label(carousel, 'DREAM CAROUSEL', 0, 5.1, 8, 6, 1);

    // Café with scalloped awning, ice-cream roof and terrace furniture.
    const cafe = new T.Group(); cafe.position.set(28, 0, 22); scene.add(cafe);
    cameraBlockers.push(box(cafe, '#f7e3c5', 0, 2.3, 0, 11, 4.6, 7));
    box(cafe, C.teal, 0, 4.6, 0, 12, .5, 8);
    for (let i = -5; i <= 5; i++) { box(cafe, i % 2 ? C.cream : C.mint, i, 3.25, 4, .99, .22, 2); ball(cafe, i % 2 ? C.cream : C.mint, i, 3.15, 4.95, .5, .22, .17); }
    box(cafe, '#7b9f9e', 0, 1.95, 3.55, 7.8, 1.7, .1); box(cafe, C.cream, 0, 1.05, 3.9, 9, .25, 1);
    label(cafe, 'CLOUD CAFÉ', 0, 4.17, 3.8, 6.5, .9);
    cylinder(cafe, '#e6b77d', 0, 6.2, 0, .45, 2.7, 1.05, 12);
    const swirl: number[][] = [];
    for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * Math.PI * 7, r = 1.04 * (1 - t) + .05; swirl.push([Math.cos(a) * r, 7.5 + t * 2.3, Math.sin(a) * r]); }
    sweep(cafe, '#f6bdcd', swirl, .27);
    for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        sweep(cafe, '#f3d1a2', [[Math.cos(a) * .47, 4.92, Math.sin(a) * .47], [Math.cos(a + .4) * .75, 6.2, Math.sin(a + .4) * .75], [Math.cos(a + .8), 7.5, Math.sin(a + .8)]], .025);
    }
    for (const side of [-1, 1]) {
        for (let y = .5; y < 4; y += .37) block(cafe, '#e7cdac', side * 5.52, y, 0, .05, .035, 6.8, .01);
        const window = archWindow(cafe, side * 5.58, 1.05, 0, 2.3, 2.7, '#fff5d8'); window.rotation.y = side * Math.PI / 2;
        for (const z of [-3.42, 3.42]) block(cafe, '#72afa5', side * 5.46, 2.25, z, .17, 4.4, .17);
        cylinder(cafe, '#b3d3b5', side * 5.2, 1.7, 4.65, .085, 3.4);
        const basket = cylinder(cafe, '#bda17c', side * 4.45, 2.8, 4.65, .32, .4, .48);
        basket.material = finish('#bda17c');
        sweep(cafe, '#d5bd94', [[side * 4.75, 3, 4.65], [side * 4.45, 3.65, 4.65], [side * 4.15, 3, 4.65]], .019);
        for (let j = 0; j < 5; j++) flower(cafe, side * 4.45 + Math.cos(j * 2) * .25, 3.08, 4.65 + Math.sin(j * 2) * .25, j % 2 ? '#f4aebe' : '#fff1d8', .8);
    }
    // Counter cakes, ceramic cups and the handwritten menu are visible at walking distance.
    for (let i = -2; i <= 2; i++) {
        cylinder(cafe, C.cream, i * 1.3, 1.29, 4.0, .29, .09);
        cylinder(cafe, i % 2 ? '#b2d0c0' : '#e8b0bc', i * 1.3, 1.48, 4.0, .16, .3, .2);
        const handle = ring(cafe, C.cream, i * 1.3 + .2, 1.49, 4.0, .105, .027); handle.rotation.y = Math.PI / 2;
    }
    block(cafe, '#be9c72', 3.7, 1.0, 4.3, 1.45, 1.8, .12);
    label(cafe, 'TODAY’S SPECIAL', 3.7, 1.25, 4.38, 1.26, .38, '#536e63', '#ffefcf');
    label(cafe, 'CLOUD LATTE  ♡', 3.7, .8, 4.39, 1.24, .35, '#536e63', '#ffefcf');
    fence(scene, 22, 29, 4); fence(scene, 35, 29, 4);
    for (const x of [19, 37]) { cylinder(scene, C.cream, x, 1.1, 27, 1.3, .18); cylinder(scene, C.teal, x, .55, 27, .12, 1); for (const z of [25, 29]) { cylinder(scene, C.pink, x, .6, z, .5, .15); cylinder(scene, C.cream, x, .3, z, .08, .6); } }

    // Entry arch and a friendly park keeper.
    for (const x of [-6.5, 6.5]) {
        box(scene, C.cream, x, 3, 37, .8, 6, .8); ball(scene, C.pink, x, 6.3, 37, .8);
        for (const y of [.2, .5, 4.5, 5.9]) block(scene, '#edd3aa', x, y, 37, 1.05, .17, 1.05);
        for (const z of [36.55, 37.45]) block(scene, '#b6d3b6', x, 2.5, z, .38, 3.1, .055);
    }
    box(scene, C.mint, 0, 5.4, 37, 14.7, 1.4, .6); label(scene, 'CLOUD PARK', 0, 5.45, 37.32, 10, 1.1); label(scene, 'SEE YOU AGAIN', 0, 5.45, 36.68, 10, 1.1).rotation.y = Math.PI;
    for (const z of [36.6, 37.4]) sweep(scene, '#f2d292', [[-7.1, 6, z], [-4, 6.7, z], [0, 7.1, z], [4, 6.7, z], [7.1, 6, z]], .09);
    star(scene, C.gold, 0, 7.45, 37, .48);
    const keeper = bunny(scene, -3, 29, C.pink); keeper.root.rotation.y = .5;

    // Trees are instanced: a dense garden without a draw call for every leaf.
    const treePoints = TREES;
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(.22, .34, 2.8, 7), mat('#b69374'), treePoints.length);
    const crowns = new T.InstancedMesh(new T.IcosahedronGeometry(1, 3), mat('#76b894'), treePoints.length * 7);
    const dummy = new T.Object3D();
    treePoints.forEach((p, i) => { dummy.position.set(p.x, 1.4, p.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        for (let j = 0; j < 7; j++) {
            const a = j * Math.PI / 3, top = j === 6;
            dummy.position.set(p.x + (top ? 0 : Math.cos(a) * 1.07), top ? 5 : 3.7 + Math.sin(j * 4) * .35, p.z + (top ? 0 : Math.sin(a) * .92));
            dummy.scale.set(top ? 1.45 : 1.32, top ? 1.6 : 1.5, 1.25); dummy.updateMatrix(); crowns.setMatrixAt(i * 7 + j, dummy.matrix);
            crowns.setColorAt(i * 7 + j, new T.Color(i % 7 === 0 ? (j % 2 ? '#e2a0b9' : '#eec1cb') : j % 3 ? '#8cbca0' : '#b0cb95'));
        }
    });
    trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);
    // Flower beds, lamps, benches and bunting make the paths feel inhabited.
    for (const x of [-8, 8]) for (const z of [12, 22, -13]) {
        cylinder(scene, '#d4b495', x, .35, z, 1.35, .6); ball(scene, '#7aaa83', x, .75, z, 1.3, .5, 1.3);
        for (let j = 0; j < 12; j++) { const a = j / 12 * Math.PI * 2; flower(scene, x + Math.cos(a) * .85, 1.17 + j % 2 * .08, z + Math.sin(a) * .85, j % 3 ? '#ed9cb0' : '#fff3cd', 1.1); }
        const trim = ring(scene, '#e9d0a6', x, .62, z, 1.35, .07); trim.rotation.x = Math.PI / 2;
    }
    for (const x of [-7.5, 7.5]) for (const z of [27, 6, -17]) {
        cylinder(scene, '#6b9890', x, 1.7, z, .09, 3.4); cylinder(scene, '#67968f', x, .3, z, .24, .6);
        ball(scene, '#fff1bf', x, 3.65, z, .42); cylinder(scene, C.teal, x, 4.02, z, .57, .3, .12);
    }
    for (const seat of SEATS) bench(scene, seat.position.x, seat.position.z).rotation.y = seat.yaw;
    // Curated borders, not random clutter: flowers sit beside the promenades.
    for (const side of [-1, 1]) for (let i = 0; i < 28; i++) {
        const z = -17 + i * 1.8;
        if (Math.abs(z) < 11 || Math.abs(z - 26) < 2) continue;
        if (Math.abs(z - 15) < 2.3) continue;
        flower(scene, side * (6.4 + i % 3 * .24), .52, z, i % 2 ? '#eab2c3' : '#f5e1a6', .95);
    }
    for (let side = -1; side <= 1; side += 2) {
        rod(scene, new T.Vector3(side * 8, 5, 18), new T.Vector3(side * 23, 5, 18), .025, '#aa9c82');
        for (let i = 0; i < 10; i++) { const flag = mesh(scene, new T.ConeGeometry(.35, .7, 3), i % 2 ? C.pink : C.gold, side * (8.8 + i * 1.4), 4.65, 18); flag.rotation.z = Math.PI; }
        cylinder(scene, C.cream, side * 8, 2.5, 18, .065, 5); cylinder(scene, C.cream, side * 23, 2.5, 18, .065, 5);
    }
    // Decorative picnic garden in the southwest.
    for (let i = 0; i < 5; i++) { const x = -21 - i % 2 * 12, z = 17 + i * 3;
        cylinder(scene, C.cream, x, .8, z, 1.3, .17); cylinder(scene, '#bca386', x, .4, z, .12, .8);
        cylinder(scene, i % 2 ? C.pink : C.blue, x, 3.3, z, 2.1, .8, .1); cylinder(scene, C.cream, x, 1.9, z, .05, 3.8);
    }
    const clouds: T.Group[] = [];
    for (let i = 0; i < 12; i++) { const g = new T.Group(); g.position.set(Math.sin(i * 7) * 90, 30 + i % 3 * 7, Math.cos(i * 7) * 90); scene.add(g); clouds.push(g); for (let j = 0; j < 4; j++) { const c = ball(g, '#fff9ed', j * 2.3, Math.sin(j) * .8, 0, 3.2, 1.3, 1.9); c.castShadow = false; } }
    const tokens = STARS.map((p) => star(scene, C.gold, p.x, 1.65, p.z, .58));
    const markers = PLACES.map((p) => { const m = ring(scene, p.color, p.arrival.x, .25, p.arrival.z, 1.05, .04); m.rotation.x = Math.PI / 2; m.castShadow = false; return m; });
    const avatar = bunny(scene, 0, 29, C.teal); avatar.root.rotation.y = Math.PI;
    for (const dynamic of [wheel, turntable, ...tokens, ...drops]) dynamic.traverse((o) => { if (o instanceof T.Mesh) o.castShadow = false; });
    // Consolidate detailed static models; keep each moving cabin / pony independently animated.
    const retire = [
        ...cabins.map((c) => batchScenery(c, [])), ...ponies.map((p) => batchScenery(p, [])),
        batchScenery(wheel, cabins), batchScenery(turntable, ponies),
        batchScenery(scene, [wheel, turntable, water, ...tokens, ...drops, ...streams, ...markers, ...clouds, avatar.root, keeper.root, ...cameraBlockers]),
    ];
    let wishIndex = 0;
    const waterColors = ['#87d8dd', '#e7a9d7', '#e8d57f', '#a6b9e5'];
    return {
        scene, avatar, cameraBlockers,
        update(time, moving, seated, jumpHeight) {
            wheel.rotation.z = time * .1; cabins.forEach((c) => { c.rotation.z = -wheel.rotation.z; });
            turntable.rotation.y = -time * .22; ponies.forEach((p, i) => { p.position.y = 2.2 + Math.sin(time * 1.7 + i) * .3; });
            drops.forEach((d, i) => { d.position.y = .95 + (1 - (time * .7 + i / 24) % 1) * 1.7; });
            tokens.forEach((t, i) => { t.rotation.y = time * 1.2 + i; t.position.y = 1.6 + Math.sin(time * 2 + i) * .15; });
            markers.forEach((m, i) => { m.scale.setScalar(1 + Math.sin(time * 2 + i) * .05); });
            avatar.legs.forEach((leg, i) => { leg.rotation.x = seated ? -1.35 + Math.sin(time * 1.7 + i) * .045 : jumpHeight > .1 ? -.32 : Math.sin(time * 11 + i * Math.PI) * moving * .65; });
            avatar.arms.forEach((arm, i) => { arm.rotation.x = seated ? -.6 : jumpHeight > .1 ? -.85 : -Math.sin(time * 11 + i * Math.PI) * moving * .5; });
            avatar.ears.forEach((ear, i) => { ear.rotation.x = Math.sin(time * (moving ? 11 : 2) + i * .4) * (moving ? .12 : .035) + (jumpHeight > 0 ? .16 : 0); });
            const blink = time % 5 > 4.82 ? .2 : 1;
            avatar.eyes.forEach((eye) => { eye.scale.y = .064 * blink; });
            avatar.shadow.position.y = .06 - (seated ? .32 : jumpHeight);
            avatar.shadow.scale.setScalar(1 + jumpHeight * .2);
            (avatar.shadow.material as T.MeshBasicMaterial).opacity = .2 / (1 + jumpHeight);
            avatar.balloon.rotation.z = Math.sin(time * 2) * .08;
            keeper.arms[0].rotation.z = -1.9 + Math.sin(time * 3) * .25;
            clouds.forEach((c, i) => { c.position.x += Math.sin(time * .01 + i) * .002; });
        },
        collect(i) { tokens[i].visible = false; },
        wish() { wishIndex = (wishIndex + 1) % waterColors.length; water.material = mat(waterColors[wishIndex]); [...drops, ...streams].forEach((d) => { d.material = mat(waterColors[wishIndex]); }); },
        rideSeat: rideSeatPose,
        dispose() {
            const geometries = new Set<T.BufferGeometry>(), mats = new Set<T.Material>(), textures = new Set<T.Texture>();
            scene.traverse((o) => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { mats.add(m); const map = (m as T.MeshBasicMaterial).map; if (map) textures.add(map); } } });
            geometries.forEach((g) => g.dispose()); textures.forEach((t) => t.dispose()); mats.forEach((m) => m.dispose()); retire.forEach((dispose) => dispose()); sun.shadow.dispose(); materials.clear();
        },
    };
}
