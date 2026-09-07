import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
function load(entry) {
    const out = buildSync({ entryPoints: [new URL(entry, import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')], bundle: true, write: false, platform: 'node', format: 'cjs' });
    const mod = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require); return mod.exports;
}
const { PLACES, STARS, SEATS, OBSTACLES, isWalkable, movePlayer, nearby, nearbySeat, stepJump, JUMP_SPEED, overlaps, PLAYER_RADIUS, PATHS, pathCells } = load('./world.ts');
const { landscapeDelta, createControls } = load('./input.ts');

// Every travel point must be collision-free and in its own interaction zone.
for (const p of PLACES) {
    assert.ok(isWalkable(p.arrival), `${p.id} arrival is obstructed`);
    assert.equal(nearby(p.arrival)?.id, p.id, `${p.id} fast travel cannot interact`);
}
// Explore the actual walkable grid, so an isolated but valid arrival doesn't pass.
const key = (p) => `${p.x},${p.z}`;
const visited = new Set(['0,29']), queue = [{ x: 0, z: 29 }];
for (let i = 0; i < queue.length; i++) {
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = { x: queue[i].x + x, z: queue[i].z + z };
        if (isWalkable(p) && !visited.has(key(p))) { visited.add(key(p)); queue.push(p); }
    }
}
for (const p of [...PLACES.map((p) => p.arrival), ...STARS]) assert.ok(visited.has(key(p)), `Unreachable destination ${key(p)}`);
for (const s of SEATS) {
    assert.ok(isWalkable(s.arrival), `${s.id}: standing up must not put the player inside furniture`);
    assert.equal(nearbySeat(s.arrival)?.id, s.id);
    assert.ok(queue.some(p => Math.hypot(p.x-s.arrival.x,p.z-s.arrival.z)<.75), `${s.id}: seat cannot be reached`);
    assert.ok(!isWalkable(s.position), `${s.id}: furniture needs a collision footprint`);
}
// Exact tangencies, rounded rectangle corners and rotation, independent of nearby objects.
for (const o of OBSTACLES) {
    assert.ok(overlaps(o,o), 'Every solid must block its center');
    const reach=o.kind==='circle'?o.radius:o.halfZ;
    const yaw=o.kind==='circle'?0:o.yaw;
    const point=d=>({x:o.x+Math.sin(yaw)*d,z:o.z+Math.cos(yaw)*d});
    assert.ok(overlaps(point(reach+PLAYER_RADIUS-.01),o));
    assert.ok(!overlaps(point(reach+PLAYER_RADIUS+.01),o));
    const start=point(reach+PLAYER_RADIUS+1);
    if (isWalkable(start)) {
        const end=movePlayer(start,-Math.sin(yaw)*30,-Math.cos(yaw)*30);
        assert.ok(isWalkable(end),'Large step ended inside a solid');
        const progress=(end.x-o.x)*Math.sin(yaw)+(end.z-o.z)*Math.cos(yaw);
        assert.ok(progress>reach,'Large step tunnelled through a solid');
    }
}
assert.ok(!overlaps({x:1.3,z:1.3},{kind:'box',x:0,z:0,halfX:1,halfZ:1,yaw:0}),'Box corner must not use square inflation');
assert.ok(isWalkable({x:3.7,z:3.7}),'Fountain diagonal should follow the circular basin');
assert.ok(movePlayer({ x: 44, z: 40 }, 100, 0).x <= 45);
const slide = movePlayer({ x: 0, z: -22.9 }, 2, -4);
assert.ok(slide.x > 1.8 && isWalkable(slide), 'Wall slide should preserve tangential movement');
const cells=pathCells(PATHS);
for(let i=0;i<cells.length;i++) for(let j=i+1;j<cells.length;j++) {
    const a=cells[i],b=cells[j];
    assert.ok(Math.abs(a.x-b.x)>=(a.w+b.w)/2-1e-8 || Math.abs(a.z-b.z)>=(a.d+b.d)/2-1e-8,'Coplanar pavement cells overlap');
}
for(let x=-38.13;x<38;x+=.7) for(let z=-28.17;z<47;z+=.7) {
    const contains=r=>Math.abs(x-r.x)<r.w/2 && Math.abs(z-r.z)<r.d/2;
    assert.equal(cells.filter(contains).length,PATHS.some(contains)?1:0,'Pavement union has holes or duplicate surfaces');
}
for(const s of SEATS) {
    assert.ok(PATHS.some(r=>Math.abs(s.position.x-r.x)<r.w/2 && Math.abs(s.position.z-r.z)<r.d/2),'Bench must sit on a rest pad');
    assert.ok(Math.abs(s.position.x)>5.5,'Bench blocks the central promenade');
    const approach={x:s.arrival.x+Math.sin(s.yaw),z:s.arrival.z+Math.cos(s.yaw)};
    assert.ok(isWalkable(approach),'Bench approach is blocked');
    const end=movePlayer(approach,s.arrival.x-approach.x,s.arrival.z-approach.z);
    assert.ok(Math.hypot(end.x-s.arrival.x,end.z-s.arrival.z)<1e-6,'Cannot walk up to bench');
}
assert.deepEqual(landscapeDelta(12, 30, false), { x: 12, y: 30 });
assert.deepEqual(landscapeDelta(12, 30, true), { x: 30, y: -12 });
for (let i = 0; i < 360; i++) {
    const dx = Math.cos(i) * 30, dy = Math.sin(i) * 30;
    const out = landscapeDelta(dx, dy, true);
    assert.ok(Math.abs(Math.hypot(out.x, out.y) - 30) < 1e-10);
}
for (const fps of [20, 30, 60, 144]) {
    let motion = { height: 0, velocity: JUMP_SPEED, overlaps, PLAYER_RADIUS, PATHS, pathCells }, peak = 0, landingTime = 0;
    for (let i = 1; i <= fps * 2; i++) {
        motion = stepJump(motion, 1 / fps); peak = Math.max(peak, motion.height);
        assert.ok(motion.height >= 0, 'Never fall below the walking surface');
        if (!motion.height) { landingTime = i / fps; break; }
    }
    assert.ok(Math.abs(peak - 1.6) < .02, `${fps} FPS jump height changed`);
    assert.ok(Math.abs(landingTime - .8) <= 1 / fps + 1e-8, `${fps} FPS jump timing changed`);
    assert.deepEqual(stepJump(motion, .05), { height: 0, velocity: 0 }, 'Landing must remain grounded');
}
// Input lifecycle regression: Alt must release an existing lock, suppress look/movement,
// restore it on release, and never steal focus back from an open map or another window.
class Surface {
    listeners = new Map(); style = {};
    addEventListener(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); }
    emit(name, props = {}) { const event = { preventDefault() {}, ...props }; for (const fn of this.listeners.get(name) ?? []) fn(event); }
    focus() {}
    setPointerCapture() {}
}
const win = new Surface(), doc = new Surface(), canvas = new Surface();
const elements = new Map([['joystick', new Surface()], ['stick', new Surface()]]);
doc.getElementById = (id) => elements.get(id);
let locks = 0, jumps = 0, looks = 0, active = true;
canvas.requestPointerLock = () => { locks++; doc.pointerLockElement = canvas; return Promise.resolve(); };
doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.emit('pointerlockchange'); };
globalThis.window = win; globalThis.document = doc;
const controls = createControls(canvas, { active: () => active, rotated: () => false, touch: () => false, look: () => looks++, interact() {}, map() {}, jump: () => jumps++ });
controls.capture(); assert.equal(locks, 1);
win.emit('keydown', { code: 'KeyW' }); assert.equal(controls.movement().y, 1);
win.emit('keydown', { code: 'AltLeft' }); assert.equal(doc.pointerLockElement, null); assert.equal(controls.cursorVisible(), true);
assert.deepEqual(controls.movement(), { x: 0, y: 0 });
doc.emit('mousemove', { movementX: 100, movementY: 100 }); assert.equal(looks, 0);
win.emit('keyup', { code: 'AltLeft' }); assert.equal(doc.pointerLockElement, canvas); assert.equal(locks, 2);
win.emit('keydown', { code: 'AltLeft' }); active = false; win.emit('keyup', { code: 'AltLeft' }); assert.equal(locks, 2);
active = true; controls.capture(); win.emit('keydown', { code: 'AltLeft' }); win.emit('blur'); win.emit('keyup', { code: 'AltLeft' }); assert.equal(locks, 3);
assert.equal(controls.cursorVisible(), false);
win.emit('keydown', { code: 'Space', repeat: false }); win.emit('keydown', { code: 'Space', repeat: true }); assert.equal(jumps, 1);
delete globalThis.window; delete globalThis.document;
// Indexed sphere/box meshes and non-indexed bevel meshes must never enter the same batch.
// The nested root check also guards against applying world transforms twice to ride cabins.
const { part, batchScenery } = load('./craft.ts');
const { rideSeatPose } = load('./scene.ts');
const wheelStart = rideSeatPose('wheel', 0), wheelQuarter = rideSeatPose('wheel', Math.PI * 5);
assert.ok(wheelQuarter.position.y > wheelStart.position.y + 8.9, 'Ferris wheel rider must follow the selected cabin');
assert.equal(wheelStart.yaw, 0, 'Ferris wheel cabin and rider must remain upright');
const carouselStart = rideSeatPose('carousel', 0), carouselLater = rideSeatPose('carousel', 1);
assert.ok(carouselLater.position.z > carouselStart.position.z, 'Carousel must rotate in the reversed direction');
assert.ok(carouselLater.yaw < carouselStart.yaw, 'Carousel rider must turn with the reversed platform');
const scene = new THREE.Scene(), parent = new THREE.Group(), cabin = new THREE.Group();
scene.add(parent); parent.position.set(17, 12, -9); parent.rotation.z = .4;
parent.add(cabin); cabin.position.set(3, 1, 2); cabin.rotation.y = .6;
for (let i = 0; i < 4; i++) part(cabin, i % 2 ? new THREE.BoxGeometry(1, 2, 1).toNonIndexed() : new THREE.BoxGeometry(1, 2, 1), '#fff4db', i * 2, i, 0);
scene.updateMatrixWorld(true);
const before = new THREE.Box3().setFromObject(cabin, true);
const retire = batchScenery(cabin, []);
scene.updateMatrixWorld(true); const after = new THREE.Box3().setFromObject(cabin, true);
assert.equal(cabin.children.length, 2, 'Different indexing must produce two valid batches');
assert.ok(before.min.distanceTo(after.min) < 1e-5 && before.max.distanceTo(after.max) < 1e-5, 'Batching changed the ride cabin geometry placement');
retire();
console.log(`Cloud Park checks passed: ${PLACES.length} travel points, ${SEATS.length} seats, ${STARS.length} stars, ${visited.size} reachable cells, collision, rotated input, 4 jump frame rates and Alt/focus lifecycle.`);
