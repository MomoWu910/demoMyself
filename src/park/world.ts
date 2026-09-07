/** World coordinates are shared by geometry, collision, interaction and the map. */
export type Point = { x: number; z: number };
export type PlaceId = 'gate' | 'casino' | 'wheel' | 'carousel' | 'tea' | 'fountain';
export interface Place {
    id: PlaceId; name: string; en: string; icon: string; color: string;
    position: Point; arrival: Point; action: string; detail: string;
}
export const PLACES: Place[] = [
    { id: 'gate', name: '迎賓花園', en: 'WELCOME GARDEN', icon: '✿', color: '#63bca6', position: { x: 0, z: 36 }, arrival: { x: 0, z: 29 }, action: '和小雲打招呼', detail: '你的樂園旅程，從這裡開始。' },
    { id: 'casino', name: '星光賭場', en: 'STARLIGHT CASINO', icon: '♠', color: '#9574d1', position: { x: 0, z: -31 }, arrival: { x: 0, z: -19 }, action: '進入星光賭場', detail: '通往老虎機、百家樂與輪盤的遊戲大廳。' },
    { id: 'wheel', name: '晴空摩天輪', en: 'SKY WHEEL', icon: '☀', color: '#e893a9', position: { x: -28, z: -17 }, arrival: { x: -28, z: -8 }, action: '搭乘摩天輪', detail: '坐上雲朵車廂，從高處收藏整座樂園。' },
    { id: 'carousel', name: '夢幻旋轉木馬', en: 'DREAM CAROUSEL', icon: '★', color: '#c39a55', position: { x: 28, z: -14 }, arrival: { x: 28, z: -4 }, action: '搭乘旋轉木馬', detail: '跟著音樂盒般的節奏，轉一圈小小的夢。' },
    { id: 'tea', name: '棉花糖茶屋', en: 'CLOUD CAFÉ', icon: '☕', color: '#66aeca', position: { x: 28, z: 22 }, arrival: { x: 28, z: 28 }, action: '領取氣球', detail: '今天的限定禮物：一顆陪你散步的氣球。' },
    { id: 'fountain', name: '許願噴泉', en: 'WISHING PLAZA', icon: '✦', color: '#53b7bc', position: { x: 0, z: 0 }, arrival: { x: 0, z: 7 }, action: '許一個願望', detail: '讓噴泉換上新的顏色，替今天加一點魔法。' },
];
export const place = (id: PlaceId): Place => PLACES.find((p) => p.id === id)!;
export const LIMIT = 45;
export interface Seat { id: string; position: Point; arrival: Point; yaw: number }
/** Rest pockets sit outside the promenade; local +Z always faces the approach. */
export const SEATS: Seat[] = [-1, 1].flatMap((side) => [
    { x: side * 7.8, z: 15, yaw: -side * Math.PI / 2 },
    { x: side * 12, z: 7, yaw: Math.PI },
    { x: side * 11, z: 35, yaw: Math.PI },
].map(({ x, z, yaw }, i) => ({ id: `bench-${side}-${i}`, position: { x, z }, yaw,
    arrival: { x: x + Math.sin(yaw) * 1.5, z: z + Math.cos(yaw) * 1.5 } })));
export interface PathRect { x: number; z: number; w: number; d: number }
export const PATHS: PathRect[] = [
    { x: 0, z: 9, w: 11, d: 76 }, { x: 0, z: 0, w: 76, d: 9 },
    { x: -28, z: 11, w: 7, d: 40 }, { x: 28, z: 11, w: 7, d: 44 },
    { x: 0, z: 29, w: 60, d: 7 }, { x: 0, z: -10, w: 60, d: 7 },
    ...[-1, 1].flatMap((s) => [
        { x: s * 6.8, z: 15, w: 4, d: 4.2 },
        { x: s * 12, z: 5.8, w: 4.2, d: 4.4 },
        { x: s * 11, z: 33.5, w: 4.2, d: 4.8 },
    ]),
];
/** Split a rectangle union into disjoint cells: intersections have exactly one surface. */
export function pathCells(rects: PathRect[]): PathRect[] {
    const xs = [...new Set(rects.flatMap(r => [r.x - r.w / 2, r.x + r.w / 2]))].sort((a,b) => a-b);
    const zs = [...new Set(rects.flatMap(r => [r.z - r.d / 2, r.z + r.d / 2]))].sort((a,b) => a-b);
    const cells: PathRect[] = [];
    for (let i=1; i<xs.length; i++) for (let j=1; j<zs.length; j++) {
        const x=(xs[i-1]+xs[i])/2, z=(zs[j-1]+zs[j])/2;
        if (rects.some(r => Math.abs(x-r.x)<r.w/2 && Math.abs(z-r.z)<r.d/2))
            cells.push({x,z,w:xs[i]-xs[i-1],d:zs[j]-zs[j-1]});
    }
    return cells;
}
export const TREES: Point[] = [
    ...Array.from({length:62}, (_,i) => { const a=i/62*Math.PI*2, r=50+Math.sin(i*7.8)*4; return {x:Math.cos(a)*r,z:Math.sin(a)*r}; }),
    ...[-17,16].flatMap(x => [-19,11,20,37].map(z => ({x,z}))),
];
export function nearbySeat(p: Point): Seat | undefined {
    return SEATS.find((s) => Math.hypot(p.x - s.arrival.x, p.z - s.arrival.z) < 2.1);
}
export interface JumpMotion { height: number; velocity: number }
export const JUMP_SPEED = 8;
const GRAVITY = 20;
/** Analytic ballistic step is independent of rendering FPS; grounded state is exact. */
export function stepJump(motion: JumpMotion, dt: number): JumpMotion {
    if (motion.height === 0 && motion.velocity === 0) return motion;
    const height = motion.height + motion.velocity * dt - .5 * GRAVITY * dt * dt;
    return height <= 0 ? { height: 0, velocity: 0 } : { height, velocity: motion.velocity - GRAVITY * dt };
}
export type Obstacle = Point & ({ kind: 'circle'; radius: number } | { kind: 'box'; halfX: number; halfZ: number; yaw: number });
const circle = (x: number,z: number,radius: number): Obstacle => ({kind:'circle',x,z,radius});
const rect = (x: number,z: number,halfX: number,halfZ: number,yaw=0): Obstacle => ({kind:'box',x,z,halfX,halfZ,yaw});
export const PLAYER_RADIUS = .4;
/** Solid silhouettes at walking height; overhead canopies and flowers stay passable. */
export const OBSTACLES: Obstacle[] = [
    rect(0,-31,10,7.5), ...[-7.7,7.7].map(x => circle(x,-27,2.52)),
    circle(-28,-17,8.6), circle(28,-14,8.2), circle(0,0,4.5),
    rect(28,22,5.5,3.5), rect(28,25.9,4.5,.5),
    ...[-5.2,5.2].map(x => circle(28+x,26.65,.085)),
    ...SEATS.map(s => rect(s.position.x-Math.sin(s.yaw)*.09,s.position.z-Math.cos(s.yaw)*.09,1.55,.62,s.yaw)),
    ...TREES.map(p => circle(p.x,p.z,.34)),
    ...[-8,8].flatMap(x => [12,22,-13].map(z => circle(x,z,1.42))),
    ...[-7.5,7.5].flatMap(x => [27,6,-17].map(z => circle(x,z,.24))),
    ...[-6.5,6.5].map(x => rect(x,37,.525,.525)), circle(-3,29,.47),
    ...[-3.3,3.3].flatMap(x => [circle(x,-19.5,.17),circle(x,-22,.17),rect(x,-20.75,.035,1.25)]),
    ...[-1,1].map(s => rect(-28+s*5.8,-10.9,2.255,.105)),
    rect(22,29,2.105,.105),rect(35,29,2.105,.105),
    ...[19,37].flatMap(x => [circle(x,27,1.3),circle(x,25,.5),circle(x,29,.5)]),
    ...[-23,-8,8,23].map(x => circle(x,18,.065)),
    ...Array.from({length:5},(_,i) => circle(-21-i%2*12,17+i*3,1.3)),
];
/** Circle versus oriented rectangle uses the closest point, preserving rounded corners. */
export function overlaps(p: Point, o: Obstacle, radius = PLAYER_RADIUS): boolean {
    if (o.kind === 'circle') return Math.hypot(p.x-o.x,p.z-o.z) < o.radius+radius-1e-8;
    const c=Math.cos(o.yaw),s=Math.sin(o.yaw),dx=p.x-o.x,dz=p.z-o.z;
    const x=c*dx-s*dz,z=s*dx+c*dz;
    return Math.hypot(Math.max(Math.abs(x)-o.halfX,0),Math.max(Math.abs(z)-o.halfZ,0)) < radius-1e-8;
}
export const STARS: Point[] = [{ x: -13, z: 22 }, { x: -30, z: 9 }, { x: -14, z: -28 }, { x: 16, z: -12 }, { x: 24, z: 8 }];
export function isWalkable(p: Point): boolean {
    return Math.abs(p.x) <= LIMIT && Math.abs(p.z) <= LIMIT && !OBSTACLES.some(o => overlaps(p,o));
}
/** Substeps prevent tunnelling at low FPS; independent axes slide along walls. */
export function movePlayer(p: Point, dx: number, dz: number): Point {
    const result = { ...p };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.25));
    for (let i = 0; i < steps; i++) {
        const x = { x: result.x + dx / steps, z: result.z };
        if (isWalkable(x)) result.x = x.x;
        const z = { x: result.x, z: result.z + dz / steps };
        if (isWalkable(z)) result.z = z.z;
    }
    return result;
}
export function nearby(p: Point): Place | undefined {
    return PLACES.find((v) => Math.hypot(p.x - v.arrival.x, p.z - v.arrival.z) < 3.5);
}
