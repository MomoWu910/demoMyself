import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PLACES, STARS, type Point } from './world';

const C = { cream: '#fff4db', pink: '#ee9bb2', rose: '#d97999', mint: '#82cdb7', teal: '#519fa7', blue: '#9dd5e8', purple: '#ad99cf', gold: '#eec56c', grass: '#a5ce9c' };
const materials = new Map<string, T.MeshStandardMaterial>();
function mat(color: string): T.MeshStandardMaterial {
    if (!materials.has(color)) materials.set(color, new T.MeshStandardMaterial({ color, roughness: .82 }));
    return materials.get(color)!;
}
const sphereGeo = new T.SphereGeometry(1, 16, 12);
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
export interface Bunny { root: T.Group; legs: T.Group[]; arms: T.Group[]; balloon: T.Group }
function bunny(parent: T.Object3D, x: number, z: number, color: string): Bunny {
    const root = new T.Group(); root.position.set(x, 0, z); parent.add(root);
    ball(root, color, 0, .82, 0, .38, .46, .29);
    ball(root, '#fff9ee', 0, 1.44, .025, .47, .42, .39);
    for (const s of [-1, 1]) {
        const ear = ball(root, '#fff9ee', s * .23, 1.97, 0, .13, .43, .12); ear.rotation.z = -s * .12;
        ball(root, '#edb4bd', s * .23, 2.0, .1, .066, .27, .035);
        ball(root, '#424b57', s * .16, 1.47, .382, .043, .058, .025);
        ball(root, '#f0b4b5', s * .28, 1.33, .35, .086, .046, .015);
    }
    ball(root, '#d38e9e', 0, 1.36, .421, .043, .032, .025);
    ball(root, C.cream, 0, .75, .255, .22, .21, .065);
    box(root, C.rose, 0, .87, -.3, .43, .5, .2);
    const legs: T.Group[] = [], arms: T.Group[] = [];
    for (const s of [-1, 1]) {
        const leg = new T.Group(); leg.position.set(s * .18, .45, 0); root.add(leg);
        ball(leg, '#fff9ee', 0, -.18, .065, .15, .23, .21); legs.push(leg);
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
    return { root, legs, arms, balloon };
}
export interface ParkScene {
    scene: T.Scene; avatar: Bunny; cameraBlockers: T.Mesh[];
    update: (time: number, moving: number) => void; collect: (i: number) => void;
    wish: () => void; wheelSeat: (time: number) => T.Vector3; dispose: () => void;
}
export function createPark(): ParkScene {
    const scene = new T.Scene(); scene.background = new T.Color('#c6e6ed'); scene.fog = new T.Fog('#c6e6ed', 65, 150);
    scene.add(new T.HemisphereLight('#fff6e8', '#8daf9f', 2.5));
    const sun = new T.DirectionalLight('#fff0d4', 3.1); sun.position.set(-35, 60, 30); sun.castShadow = true;
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
    const path = (x: number, z: number, w: number, d: number): void => { box(scene, '#e5c6a7', x, .015, z, w + .6, .16, d + .6).castShadow = false; box(scene, '#f5e5cb', x, .11, z, w, .14, d).castShadow = false; };
    path(0, 9, 11, 76); path(0, 0, 76, 9); path(-28, 11, 7, 40); path(28, 11, 7, 44); path(0, 29, 60, 7); path(0, -10, 60, 7);
    cylinder(scene, '#e9c7ac', 0, .18, 0, 10, .2, 10, 64); cylinder(scene, '#f7e5c4', 0, .3, 0, 9.6, .15, 9.6, 64);
    for (let z = -18; z < 37; z += 3) for (const x of [-4.5, 4.5]) box(scene, '#dac3a6', x, .2, z, .18, .015, 1.4).castShadow = false;

    // Fountain: scalloped basin, water tiers, droplets and a golden wishing star.
    cylinder(scene, '#eee2cf', 0, .5, 0, 4.4, .8); cylinder(scene, '#79c9d3', 0, .94, 0, 3.9, .12);
    const rim = ring(scene, C.cream, 0, .95, 0, 4.1, .24); rim.rotation.x = Math.PI / 2;
    cylinder(scene, C.cream, 0, 1.8, 0, .65, 2.1); cylinder(scene, C.cream, 0, 2.45, 0, 2.0, .35, 1.65);
    const water = cylinder(scene, '#87d8dd', 0, 2.65, 0, 1.65, .12);
    cylinder(scene, C.cream, 0, 3.15, 0, .27, 1.1); star(scene, C.gold, 0, 4.05, 0, .8);
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
        cylinder(casino, '#e6a2b9', x, 10.7, 4, 3.0, 3.3, .2);
        ball(casino, C.gold, x, 12.5, 4, .4);
        box(casino, '#83b9cb', x, 5.2, 6.39, 1.1, 2.1, .08);
        box(casino, C.gold, x, 6.45, 6.45, 1.4, .18, .15);
    }
    box(casino, C.cream, 0, 4.2, 6.65, 7.6, 7, .8);
    box(casino, '#4e647d', 0, 2.45, 7.14, 3.9, 4.4, .2);
    for (const x of [-1, 1]) { box(casino, '#7594b3', x, 2.45, 7.27, 1.7, 3.9, .08); box(casino, C.gold, x * .23, 2.3, 7.4, .08, .6, .1); }
    box(casino, C.gold, 0, 4.85, 7.25, 4.6, .25, .35);
    label(casino, 'STARLIGHT CASINO', 0, 6.75, 7.13, 11.5, 1.65, '#77658c', '#fff1ca');
    star(casino, C.gold, 0, 9.85, 5.8, 1.4);
    for (let i = -7; i <= 7; i++) ball(casino, '#fff0ad', i * .75, 5.8, 7.15, .1);
    for (const x of [-4.8, 4.8]) for (let y = 2.5; y < 5.5; y += 2) { box(casino, C.cream, x, y, 6.7, 1.7, 1.6, .2); box(casino, '#839cba', x, y, 6.85, 1.3, 1.2, .1); }
    box(scene, '#d99aaa', 0, .22, -20.5, 4, .08, 5);
    for (const x of [-3.3, 3.3]) { cylinder(scene, C.gold, x, .75, -19.5, .1, 1.5); ball(scene, C.gold, x, 1.55, -19.5, .17); }

    // Ferris wheel. Cabin pivots counter-rotate so passengers stay upright.
    const wheelBase = new T.Group(); wheelBase.position.set(-28, 0, -17); scene.add(wheelBase);
    cylinder(wheelBase, '#ece0d0', 0, .4, 0, 8.6, .8);
    for (const z of [-1.9, 1.9]) for (const x of [-5, 5]) rod(wheelBase, new T.Vector3(x, .5, z), new T.Vector3(0, 12, z), .3, C.cream);
    const wheel = new T.Group(); wheel.position.set(0, 12, 0); wheelBase.add(wheel);
    for (const z of [-.55, .55]) { ring(wheel, C.pink, 0, 0, z, 9, .23); ring(wheel, C.cream, 0, 0, z, 8.5, .1); }
    ball(wheelBase, C.gold, 0, 12, 1, .7);
    const cabins: T.Group[] = [];
    for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2, x = Math.cos(a) * 9, y = Math.sin(a) * 9;
        rod(wheel, new T.Vector3(0, 0, 0), new T.Vector3(x, y, 0), .07, C.cream);
        const cabin = new T.Group(); cabin.position.set(x, y, 0); wheel.add(cabin); cabins.push(cabin);
        const colors = [C.pink, C.blue, C.mint, C.gold, C.purple];
        box(cabin, colors[i % 5], 0, -.65, 0, 1.7, 1.4, 1.5); box(cabin, '#cbeaf0', 0, -.22, .77, 1.28, .63, .05);
        box(cabin, C.cream, 0, .22, 0, 1.9, .22, 1.7);
        box(cabin, C.cream, 0, -.22, .82, .08, .7, .06);
    }
    label(wheelBase, 'SKY WHEEL', 0, 2.2, 4.2, 5, 1.05);

    // Carousel: striped tent, gold poles and little cloud ponies.
    const carousel = new T.Group(); carousel.position.set(28, 0, -14); scene.add(carousel);
    cylinder(carousel, '#e6c5a8', 0, .4, 0, 8.2, .8); cylinder(carousel, C.cream, 0, .88, 0, 7.8, .2);
    const turntable = new T.Group(); carousel.add(turntable);
    cylinder(turntable, C.pink, 0, 1.02, 0, 7.3, .15); cylinder(carousel, C.gold, 0, 3.8, 0, .6, 6);
    for (let i = 0; i < 12; i++) {
        mesh(carousel, new T.ConeGeometry(8.5, 3.3, 4, 1, false, i * Math.PI / 6, Math.PI / 6), i % 2 ? C.cream : C.pink, 0, 7.2, 0);
    }
    const canopyRim = ring(carousel, C.gold, 0, 5.57, 0, 8.4, .17); canopyRim.rotation.x = Math.PI / 2;
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
    ball(cafe, '#f7c2d1', 0, 7.8, 0, 1.4); ball(cafe, C.cream, .4, 8.5, 0, .6);
    for (const x of [19, 37]) { cylinder(scene, C.cream, x, 1.1, 27, 1.3, .18); cylinder(scene, C.teal, x, .55, 27, .12, 1); for (const z of [25, 29]) { cylinder(scene, C.pink, x, .6, z, .5, .15); cylinder(scene, C.cream, x, .3, z, .08, .6); } }

    // Entry arch and a friendly park keeper.
    for (const x of [-6.5, 6.5]) { box(scene, C.cream, x, 3, 37, .8, 6, .8); ball(scene, C.pink, x, 6.3, 37, .8); }
    box(scene, C.mint, 0, 5.4, 37, 14.7, 1.4, .6); label(scene, 'CLOUD PARK', 0, 5.45, 37.32, 10, 1.1); label(scene, 'SEE YOU AGAIN', 0, 5.45, 36.68, 10, 1.1).rotation.y = Math.PI;
    const keeper = bunny(scene, -3, 29, C.pink); keeper.root.rotation.y = .5;

    // Trees are instanced: a dense garden without a draw call for every leaf.
    const treePoints: Point[] = [];
    for (let i = 0; i < 62; i++) { const a = i / 62 * Math.PI * 2, r = 50 + Math.sin(i * 7.8) * 4; treePoints.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
    for (const x of [-17, 16]) for (const z of [-19, 11, 20, 37]) treePoints.push({ x, z });
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(.22, .34, 2.8, 7), mat('#b69374'), treePoints.length);
    const crowns = new T.InstancedMesh(new T.IcosahedronGeometry(1, 2), mat('#76b894'), treePoints.length * 3);
    const dummy = new T.Object3D();
    treePoints.forEach((p, i) => { dummy.position.set(p.x, 1.4, p.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        for (let j = 0; j < 3; j++) { dummy.position.set(p.x + (j - 1) * .8, 3.5 + (j === 1 ? 1 : 0), p.z); dummy.scale.set(1.8, 2.0, 1.7); dummy.updateMatrix(); crowns.setMatrixAt(i * 3 + j, dummy.matrix); crowns.setColorAt(i * 3 + j, new T.Color(i % 7 === 0 ? '#efb9c6' : i % 3 ? '#83bd9d' : '#a0ca95')); }
    });
    trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);
    // Flower beds, lamps, benches and bunting make the paths feel inhabited.
    for (const x of [-8, 8]) for (const z of [12, 22, -13]) {
        cylinder(scene, '#d4b495', x, .35, z, 1.35, .6); ball(scene, '#7aaa83', x, .75, z, 1.3, .5, 1.3);
        for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2; ball(scene, j % 2 ? C.pink : C.cream, x + Math.cos(a) * .8, 1.1, z + Math.sin(a) * .8, .22); }
    }
    for (const x of [-7.5, 7.5]) for (const z of [27, 6, -17]) {
        cylinder(scene, '#6b9890', x, 1.7, z, .09, 3.4); cylinder(scene, '#67968f', x, .3, z, .24, .6);
        ball(scene, '#fff1bf', x, 3.65, z, .42); cylinder(scene, C.teal, x, 4.02, z, .57, .3, .12);
    }
    for (const x of [-12, 12]) for (const z of [4, 32]) { box(scene, C.cream, x, .7, z, 2.9, .2, .8); box(scene, C.mint, x, 1.2, z - .35, 2.9, .85, .14); for (const dx of [-1, 1]) box(scene, '#7d9d8c', x + dx, .35, z, .14, .7, .6); }
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
    let wishIndex = 0;
    const waterColors = ['#87d8dd', '#e7a9d7', '#e8d57f', '#a6b9e5'];
    return {
        scene, avatar, cameraBlockers,
        update(time, moving) {
            wheel.rotation.z = time * .1; cabins.forEach((c) => { c.rotation.z = -wheel.rotation.z; });
            turntable.rotation.y = time * .22; ponies.forEach((p, i) => { p.position.y = 2.2 + Math.sin(time * 1.7 + i) * .3; });
            drops.forEach((d, i) => { d.position.y = .95 + (1 - (time * .7 + i / 24) % 1) * 1.7; });
            tokens.forEach((t, i) => { t.rotation.y = time * 1.2 + i; t.position.y = 1.6 + Math.sin(time * 2 + i) * .15; });
            markers.forEach((m, i) => { m.scale.setScalar(1 + Math.sin(time * 2 + i) * .05); });
            avatar.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(time * 11 + i * Math.PI) * moving * .65; });
            avatar.arms.forEach((arm, i) => { arm.rotation.x = -Math.sin(time * 11 + i * Math.PI) * moving * .5; });
            avatar.balloon.rotation.z = Math.sin(time * 2) * .08;
            keeper.arms[0].rotation.z = -1.9 + Math.sin(time * 3) * .25;
            clouds.forEach((c, i) => { c.position.x += Math.sin(time * .01 + i) * .002; });
        },
        collect(i) { tokens[i].visible = false; },
        wish() { wishIndex = (wishIndex + 1) % waterColors.length; water.material = mat(waterColors[wishIndex]); drops.forEach((d) => { d.material = mat(waterColors[wishIndex]); }); },
        wheelSeat(time) { return new T.Vector3(-28 + Math.cos(time * .1) * 9, 12 + Math.sin(time * .1) * 9, -14); },
        dispose() {
            const geometries = new Set<T.BufferGeometry>(), mats = new Set<T.Material>(), textures = new Set<T.Texture>();
            scene.traverse((o) => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { mats.add(m); const map = (m as T.MeshBasicMaterial).map; if (map) textures.add(map); } } });
            geometries.forEach((g) => g.dispose()); textures.forEach((t) => t.dispose()); mats.forEach((m) => m.dispose()); sun.shadow.dispose(); materials.clear();
        },
    };
}
