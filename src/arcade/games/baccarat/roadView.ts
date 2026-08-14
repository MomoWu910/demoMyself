import type { RoadMark } from '../../common/roadmap/RoadGrid';
import {
    buildDerivedRoad,
    layoutBeadPlate,
    layoutColumns,
    packDerivedColumns,
    type BigRoad,
    type DerivedRoadKind,
    type RoadRound,
} from './roadmap';

/**
 * 把路圖的推算結果翻成「畫什麼形狀、什麼顏色」。
 *
 * 這一層是**慣例層**：莊是紅、閒是藍、大眼仔畫圈、曱甴路畫斜線——這些不是演算法，
 * 是賭場沿用幾十年的約定，換一家店也不會變。把它跟推算（roadmap.ts）與繪製
 * （common/roadmap/RoadGrid.ts）分開，三者才各自可以單獨改：改配色不必碰演算法，
 * 改演算法不必碰繪製。
 */

/** 莊紅閒藍是全世界百家樂桌的共同語言，跟這一頁的配色無關，不要為了好看改掉。 */
const BANKER = 0xff4d6d;
const PLAYER = 0x4cc9f0;
const TIE = 0x4fd18b;

/** 衍生路的紅藍。它們表示「齊整／雜亂」，跟莊閒無關，但沿用同一組顏色。 */
const DERIVED = { red: BANKER, blue: PLAYER };

export const ROAD_ROWS = 6;

/**
 * 只留最後 `cols` 欄並靠左對齊。
 *
 * 路圖是**往右無限長**的，畫面卻只有那麼寬。真實桌台的作法就是捲到最新——
 * 玩家在乎的是最近這幾十局，不是這一靴的開頭。
 */
function clampToLast<T extends { col: number }>(cells: T[], cols: number): T[] {
    if (cells.length === 0) return cells;
    const maxCol = cells.reduce((m, c) => Math.max(m, c.col), 0);
    const shift = Math.max(0, maxCol - cols + 1);
    return cells.filter((c) => c.col >= shift).map((c) => ({ ...c, col: c.col - shift }));
}

/**
 * 大路：空心圈，莊紅閒藍。和局畫成斜線疊在前一顆上，對子畫在角上。
 *
 * 空心而不是實心是有理由的——大路上要疊和局的斜線與對子的點，實心會把它們吃掉。
 */
export function bigRoadMarks(road: BigRoad, cols: number): RoadMark[] {
    const placed = layoutColumns(road.columns, ROAD_ROWS);
    return clampToLast(placed, cols).map((cell) => ({
        col: cell.col,
        row: cell.row,
        shape: 'circle' as const,
        color: cell.item.outcome === 'banker' ? BANKER : PLAYER,
        ties: cell.item.ties,
        cornerTL: cell.item.playerPair ? PLAYER : undefined,
        cornerBR: cell.item.bankerPair ? BANKER : undefined,
    }));
}

/**
 * 三張衍生路。形狀是各自的招牌：
 * 大眼仔空心圈、小路實心圓、曱甴路斜線——這三個形狀就是它們在桌上被認出來的方式。
 */
const SHAPE: Record<DerivedRoadKind, RoadMark['shape']> = {
    bigEye: 'circle',
    small: 'filled',
    cockroach: 'slash',
};

export function derivedMarks(road: BigRoad, kind: DerivedRoadKind, cols: number): RoadMark[] {
    const columns = packDerivedColumns(buildDerivedRoad(road, kind));
    const placed = layoutColumns(columns, ROAD_ROWS);
    return clampToLast(placed, cols).map((cell) => ({
        col: cell.col,
        row: cell.row,
        shape: SHAPE[kind],
        color: DERIVED[cell.item],
    }));
}

/**
 * 珠盤路：實心圓加一個字，**每一局都佔一格**（和局也是）。
 *
 * 字由呼叫端傳進來，因為「莊／閒／和」是要翻譯的，而這支檔案不該知道語言。
 */
export function beadMarks(rounds: RoadRound[], cols: number, labels: Record<'player' | 'banker' | 'tie', string>): RoadMark[] {
    const placed = layoutBeadPlate(rounds, ROAD_ROWS);
    return clampToLast(placed, cols).map((cell) => ({
        col: cell.col,
        row: cell.row,
        shape: 'filled' as const,
        color: cell.round.outcome === 'banker' ? BANKER : cell.round.outcome === 'player' ? PLAYER : TIE,
        text: labels[cell.round.outcome],
        cornerTL: cell.round.playerPair ? PLAYER : undefined,
        cornerBR: cell.round.bankerPair ? BANKER : undefined,
    }));
}
