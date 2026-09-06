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
export interface Obstacle { x: number; z: number; halfX: number; halfZ: number }
export const OBSTACLES: Obstacle[] = [
    { x: 0, z: -31, halfX: 10, halfZ: 8 },
    { x: -28, z: -17, halfX: 8.5, halfZ: 4 },
    { x: 28, z: -14, halfX: 8, halfZ: 8 },
    { x: 28, z: 22, halfX: 6, halfZ: 4 },
    { x: 0, z: 0, halfX: 4.5, halfZ: 4.5 },
];
export const STARS: Point[] = [{ x: -13, z: 22 }, { x: -30, z: 9 }, { x: -14, z: -28 }, { x: 16, z: -12 }, { x: 24, z: 8 }];
export function isWalkable(p: Point): boolean {
    return Math.abs(p.x) <= LIMIT && Math.abs(p.z) <= LIMIT && !OBSTACLES.some((o) =>
        Math.abs(p.x - o.x) < o.halfX + 0.55 && Math.abs(p.z - o.z) < o.halfZ + 0.55);
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
