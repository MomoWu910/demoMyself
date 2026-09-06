import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function load(entry) {
    const out = buildSync({ entryPoints: [new URL(entry, import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')], bundle: true, write: false, platform: 'node', format: 'cjs' });
    const mod = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require); return mod.exports;
}
const { PLACES, STARS, OBSTACLES, isWalkable, movePlayer, nearby } = load('./world.ts');
const { landscapeDelta } = load('./input.ts');

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
// Large timesteps must not jump through any building or the fountain.
for (const o of OBSTACLES) {
    const start = { x: o.x, z: o.z + o.halfZ + 3 };
    const end = movePlayer(start, 0, -50);
    assert.ok(end.z >= o.z + o.halfZ + .55, 'Player tunnelled through an obstacle');
    assert.ok(isWalkable(end));
}
assert.ok(movePlayer({ x: 44, z: 40 }, 100, 0).x <= 45);
const slide = movePlayer({ x: 0, z: -22 }, 4, -4);
assert.ok(slide.x > 3 && isWalkable(slide), 'Wall slide should preserve tangential movement');
assert.deepEqual(landscapeDelta(12, 30, false), { x: 12, y: 30 });
assert.deepEqual(landscapeDelta(12, 30, true), { x: 30, y: -12 });
for (let i = 0; i < 360; i++) {
    const dx = Math.cos(i) * 30, dy = Math.sin(i) * 30;
    const out = landscapeDelta(dx, dy, true);
    assert.ok(Math.abs(Math.hypot(out.x, out.y) - 30) < 1e-10);
}
console.log(`Cloud Park checks passed: ${PLACES.length} travel points, ${STARS.length} stars, ${visited.size} reachable cells, collisions and rotated input.`);
