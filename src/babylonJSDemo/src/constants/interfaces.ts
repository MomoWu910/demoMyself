import { GameType, GameState, PlayerAction, ChipValue, CardSuit, CardRank, BetResult } from './enums';

/**
 * 可控制物件介面
 * 所有可被 InputManager 控制的元件（如相機、角色）都需實作這些方法
 */
export interface IControllable {
    name: string; // 物件名稱
    moveForward?(): void;
    moveBackward?(): void;
    moveLeft?(): void;
    moveRight?(): void;
    rotateBy?(dx: number, dy: number): void; // 滑鼠拖曳鏡頭
    // 可擴充更多動作，如 jump、interact 等
}

/**
 * 玩家資料
 * @param id 玩家唯一識別碼
 * @param name 玩家名稱
 * @param chips 玩家持有籌碼數
 * @param seatIndex 座位編號（可選）
 * @param currentAction 當前動作（可選）
 * @param handCards 手牌（可選）
 */
export interface Player {
    id: string;
    name: string;
    chips: number;
    seatIndex?: number;
    currentAction?: PlayerAction;
    handCards?: Card[];
}

/**
 * 荷官資料
 * @param id 荷官唯一識別碼
 * @param name 荷官名稱
 * @param handCards 荷官手牌（可選）
 */
export interface Dealer {
    id: string;
    name: string;
    handCards?: Card[];
}

/**
 * 賭桌資料
 * @param id 賭桌唯一識別碼
 * @param type 遊戲類型
 * @param seats 座位數
 * @param chipsOnTable 桌面上的籌碼
 * @param dealer 荷官
 * @param players 玩家列表
 */
export interface Table {
    id: string;
    type: GameType;
    seats: number;
    chipsOnTable: Chip[];
    dealer: Dealer;
    players: Player[];
}

/**
 * 籌碼資料
 * @param value 籌碼面額
 * @param ownerId 擁有者id（可選，未指定代表桌面）
 */
export interface Chip {
    value: ChipValue;
    ownerId?: string;
}

/**
 * 撲克牌資料
 * @param suit 花色
 * @param rank 點數
 * @param isFaceUp 是否翻開
 */
export interface Card {
    suit: CardSuit;
    rank: CardRank;
    isFaceUp: boolean;
}

/**
 * 下注資料
 * @param playerId 玩家id
 * @param amount 下注金額
 * @param odds 賠率
 * @param result 結果（可選）
 */
export interface Bet {
    playerId: string;
    amount: number;
    odds: number;
    result?: BetResult;
}

/**
 * 遊戲主資料
 * @param state 遊戲狀態
 * @param type 遊戲類型
 * @param table 賭桌資料
 * @param bets 下注列表
 * @param countdown 倒數計時（可選）
 */
export interface GameModel {
    state: GameState;
    type: GameType;
    table: Table;
    bets: Bet[];
    countdown?: number;
}
