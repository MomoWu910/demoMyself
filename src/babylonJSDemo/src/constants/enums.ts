/**
 * 遊戲流程狀態
 * @enum GameState
 * @description 控制玩家在場景中的主要階段
 */
export enum GameState {
	Free,           // 自由行走
	TableSelect,    // 賭桌互動選單
	Playing,        // 遊戲進行中
	Betting,        // 下注階段
	Drawing,        // 抽牌/擲骰階段
	Settling,       // 結算階段
	Result,         // 顯示結果
}

/**
 * 遊戲類型
 * @enum GameType
 * @description 賭桌可選擇的遊戲種類
 */
export enum GameType {
	None,
	Poker,          // 撲克牌比大小
	Dice,           // 擲骰子比大小
}

/**
 * 玩家動作
 * @enum PlayerAction
 * @description 玩家在場景或遊戲中的操作
 */
export enum PlayerAction {
	None,
	Move,
	Interact,
	Sit,
	Bet,
	Draw,
	Reveal,
	Continue,
	Leave,
}

/**
 * 籌碼面額
 * @enum ChipValue
 * @description 遊戲中可用的籌碼金額
 */
export enum ChipValue {
	Chip1 = 1,
	Chip5 = 5,
	Chip10 = 10,
	Chip50 = 50,
	Chip100 = 100,
}

/**
 * 撲克牌花色
 * @enum CardSuit
 * @description 四種撲克牌花色
 */
export enum CardSuit {
	Spades = 'Spades',
	Hearts = 'Hearts',
	Diamonds = 'Diamonds',
	Clubs = 'Clubs',
}

/**
 * 撲克牌點數
 * @enum CardRank
 * @description 撲克牌的 1~13 點數
 */
export enum CardRank {
	Ace = 1,
	Two,
	Three,
	Four,
	Five,
	Six,
	Seven,
	Eight,
	Nine,
	Ten,
	Jack,
	Queen,
	King,
}

/**
 * 下注結果
 * @enum BetResult
 * @description 玩家下注後的結果
 */
export enum BetResult {
	Win,
	Lose,
	Draw,
}
