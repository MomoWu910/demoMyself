import { pathCells, type PathRect } from './world';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Reusable model parts: real silhouettes and bevels, not decorations painted on flat boxes.
const palette = new Map<string, T.MeshStandardMaterial>();
export function finish(color: string, metal = false): T.MeshStandardMaterial {
    const key = `${color}/${metal}`;
    if (!palette.has(key)) palette.set(key, new T.MeshStandardMaterial({ color, roughness: metal ? .3 : .58, metalness: metal ? .55 : 0 }));
    return palette.get(key)!;
}
export function part(parent: T.Object3D, geometry: T.BufferGeometry, color: string, x = 0, y = 0, z = 0, metal = false): T.Mesh {
    const object = new T.Mesh(geometry, finish(color, metal)); object.position.set(x, y, z);
    object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
}
export function block(parent: T.Object3D, color: string, x: number, y: number, z: number, w: number, h: number, d: number, bevel = .04): T.Mesh {
    return part(parent, new RoundedBoxGeometry(w, h, d, 3, Math.min(bevel, w / 3, h / 3, d / 3)), color, x, y, z);
}
export function sweep(parent: T.Object3D, color: string, points: number[][], radius: number, metal = false): T.Mesh {
    const curve = new T.CatmullRomCurve3(points.map(([x, y, z]) => new T.Vector3(x, y, z)));
    return part(parent, new T.TubeGeometry(curve, Math.max(12, points.length * 6), radius, 7, false), color, 0, 0, 0, metal);
}
function archPath(width: number, height: number, bottom = 0): T.Shape {
    const p = new T.Shape(), r = width / 2, spring = height - r;
    p.moveTo(-r, bottom); p.lineTo(r, bottom); p.lineTo(r, spring);
    p.absarc(0, spring, r, 0, Math.PI, false); p.lineTo(-r, bottom); p.closePath(); return p;
}
export function archWindow(parent: T.Object3D, x: number, y: number, z: number, w: number, h: number, trim = '#fff1d2', glassOpacity = 1): T.Group {
    const group = new T.Group(); group.position.set(x, y, z); parent.add(group);
    const outline = archPath(w + .26, h + .18); outline.holes.push(archPath(w, h, .1));
    part(group, new T.ExtrudeGeometry(outline, { depth: .15, bevelEnabled: true, bevelThickness: .035, bevelSize: .035, bevelSegments: 2, steps: 1, curveSegments: 20 }), trim);
    const glass = part(group, new T.ShapeGeometry(archPath(w, h), 24), '#608b9d', 0, 0, .015);
    glass.material = glassOpacity === 1 ? finish('#7caebc') : new T.MeshStandardMaterial({
        color: '#7caebc', roughness: .25, transparent: true, opacity: glassOpacity, depthWrite: false,
    });
    block(group, '#e6c58a', 0, h / 2, .14, .055, h - .16, .07, .02);
    block(group, '#e6c58a', 0, h * .5, .14, w - .1, .07, .08, .02);
    block(group, trim, 0, .025, .19, w + .48, .16, .42, .04);
    // Two diagonal inlaid highlights give the glass a readable curved reflection.
    sweep(group, '#b7e0df', [[-w * .31, h * .25, .09], [-w * .18, h * .38, .09], [-w * .1, h * .47, .09]], .018);
    return group;
}
export function turnedRoof(parent: T.Object3D, x: number, y: number, z: number, radius: number, h: number, color: string): void {
    const profile = [new T.Vector2(radius * 1.07, 0), new T.Vector2(radius * 1.05, .13), new T.Vector2(radius * .85, h * .14), new T.Vector2(radius * .58, h * .4), new T.Vector2(radius * .32, h * .7), new T.Vector2(.04, h)];
    part(parent, new T.LatheGeometry(profile, 48), color, x, y, z);
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        sweep(parent, '#f4cc92', profile.map((p) => [x + Math.cos(a) * (p.x + .025), y + p.y, z + Math.sin(a) * (p.x + .025)]), .035, true);
    }
    const ring = part(parent, new T.TorusGeometry(radius * 1.045, .075, 8, 64), '#f3d99e', x, y + .12, z, true); ring.rotation.x = Math.PI / 2;
}
export function bench(parent: T.Object3D, x: number, z: number): T.Group {
    const g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
    // Individual curved-edge timber slats, visible spaces and brass fastening points.
    for (let i = 0; i < 4; i++) block(g, i % 2 ? '#d7af83' : '#e5c19a', 0, .72, -.28 + i * .19, 3.1, .12, .155, .035);
    for (let i = 0; i < 3; i++) {
        const slat = block(g, i % 2 ? '#80b6a2' : '#a1c8ad', 0, 1.1 + i * .23, -.4 - i * .035, 3.1, .18, .12, .035); slat.rotation.x = -.1;
        for (const s of [-1, 1]) part(g, new T.SphereGeometry(.027, 8, 6), '#edd294', s * 1.2, 1.1 + i * .23, -.322 - i * .035, true);
    }
    for (const s of [-1, 1]) {
        const x1 = s * 1.27;
        sweep(g, '#548e82', [[x1, .07, .46], [x1, .45, .27], [x1, .68, -.1], [x1, 1.3, -.46], [x1, 1.76, -.51]], .06, true);
        sweep(g, '#548e82', [[x1, .05, -.64], [x1, .4, -.45], [x1, .72, .04], [x1, .89, .35], [x1, 1.08, .35], [x1, 1.13, -.1], [x1, 1.25, -.45]], .065, true);
        block(g, '#d9b484', x1, 1.13, .03, .2, .1, .85, .04);
    }
    return g;
}
export function flower(parent: T.Object3D, x: number, y: number, z: number, color: string, size = 1): void {
    const g = new T.Group(); g.position.set(x, y, z); g.scale.setScalar(size); parent.add(g);
    part(g, new T.CylinderGeometry(.016, .024, .4, 5), '#658c55', 0, -.15, 0);
    for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * .4;
        const petal = part(g, new T.SphereGeometry(.12, 8, 6), color, Math.cos(a) * .12, .025, Math.sin(a) * .12);
        petal.scale.set(1, .35, 1);
    }
    part(g, new T.SphereGeometry(.065, 8, 6), '#e5b450', 0, .06, 0);
    const leaf = part(g, new T.SphereGeometry(.1, 8, 6), '#7fa16b', .08, -.23, 0); leaf.scale.set(1.7, .18, .55); leaf.rotation.z = .4;
}
export function fence(parent: T.Object3D, x: number, z: number, length: number, rotation = 0): void {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = rotation; parent.add(g);
    for (let i = 0; i <= length; i += .75) {
        block(g, '#fff0d3', i - length / 2, .6, 0, .13, 1.12, .13);
        part(g, new T.SphereGeometry(.105, 10, 8), '#e7bc71', i - length / 2, 1.22, 0, true);
    }
    for (const y of [.35, .9]) block(g, '#b5d3bb', 0, y, .04, length, .1, .12);
}
export function stoneSurface(parent: T.Object3D, rects: PathRect[]): void {
    // One reusable masonry texture, physically scaled per path. No image downloads.
    if (!stoneCanvas) {
        stoneCanvas = document.createElement('canvas'); stoneCanvas.width = stoneCanvas.height = 256;
        const c = stoneCanvas.getContext('2d')!; c.fillStyle = '#d6c4ab'; c.fillRect(0, 0, 256, 256);
        const colors = ['#eee0c9', '#ebdbc2', '#f3e6ce', '#e7d6bd'];
        for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) {
            c.fillStyle = colors[((row * 7 + col * 3) % 4 + 4) % 4];
            c.fillRect(col * 64 + row % 2 * 32 + 1, row * 32 + 1, 62, 30);
        }
    }
    const texture = new T.CanvasTexture(stoneCanvas); texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 4;
    const material = new T.MeshStandardMaterial({ map: texture, roughness: .95, color: '#fff7ed' });
    const vertices: number[] = [], uvs: number[] = [];
    for (const {x,z,w,d} of pathCells(rects)) {
        const l=x-w/2,r=x+w/2,t=z-d/2,b=z+d/2;
        for (const [px,pz] of [[l,t],[l,b],[r,t],[r,t],[l,b],[r,b]]) {
            vertices.push(px,.194,pz); uvs.push(px/5,-pz/5);
        }
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2)); geometry.computeVertexNormals();
    const pavement=new T.Mesh(geometry,material); pavement.receiveShadow=true; parent.add(pavement);
    // A separate, lower union is the border. No stacked coplanar road rectangles.
    const border: number[]=[];
    for (const {x,z,w,d} of pathCells(rects.map(r=>({...r,w:r.w+.6,d:r.d+.6})))) {
        for (const [px,pz] of [[x-w/2,z-d/2],[x-w/2,z+d/2],[x+w/2,z-d/2],[x+w/2,z-d/2],[x-w/2,z+d/2],[x+w/2,z+d/2]]) border.push(px,.095,pz);
    }
    const edging=new T.BufferGeometry(); edging.setAttribute('position',new T.Float32BufferAttribute(border,3)); edging.computeVertexNormals();
    const edge=new T.Mesh(edging,finish('#e5c6a7')); edge.receiveShadow=true; parent.add(edge);
}
let stoneCanvas: HTMLCanvasElement | undefined;

/** Collapse stationary model details by material. Animation roots remain independent. */
export function batchScenery(scene: T.Object3D, dynamicRoots: T.Object3D[]): () => void {
    const excluded = new Set<T.Object3D>(); dynamicRoots.forEach((r) => r.traverse((o) => excluded.add(o)));
    const batches = new Map<string, T.Mesh[]>();
    scene.updateMatrixWorld(true);
    const toLocal = scene.matrixWorld.clone().invert();
    scene.traverse((o) => {
        if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || excluded.has(o) || Array.isArray(o.material)) return;
        const key = `${o.material.uuid}/${o.castShadow}/${o.receiveShadow}/${!!o.geometry.index}/${Object.keys(o.geometry.attributes).sort().join(',')}`;
        const group = batches.get(key) ?? []; group.push(o); batches.set(key, group);
    });
    const retired = new Set<T.BufferGeometry>();
    for (const objects of batches.values()) {
        if (objects.length < 2) continue;
        const pieces = objects.map((o) => o.geometry.clone().applyMatrix4(toLocal.clone().multiply(o.matrixWorld)));
        const merged = mergeGeometries(pieces); pieces.forEach((g) => g.dispose());
        if (!merged) continue;
        const result = new T.Mesh(merged, objects[0].material); result.castShadow = objects[0].castShadow; result.receiveShadow = objects[0].receiveShadow; scene.add(result);
        objects.forEach((o) => { retired.add(o.geometry); o.removeFromParent(); });
    }
    return () => { retired.forEach((g) => g.dispose()); palette.clear(); };
}
