/**
 * 取得唯一的動畫組名稱
 * @param type 模型類型: dealer, player, mahjong, dominoes, dice...
 * @param uid 物件id, 用來區分使用同模型的物件
 * @param modelName 模型名稱: angelwomon, canterella, iuno...
 * @param animationName 動畫名稱: idle, walk, run, attack01...
 * @returns
 */
export const getUniqueAnimationGroupName = (
    type: string,
    uid: number | string,
    modelName: string,
    animationName: string
) => {
    return `${type}_${uid}_${modelName}_${animationName}`;
};

export function waitUntil(conditionFunction: () => boolean, timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const poll = () => {
            if (conditionFunction()) {
                resolve();
            } else if (Date.now() - startTime < timeout) {
                setTimeout(poll, 100);
            } else {
                reject(new Error('Timeout exceeded'));
            }
        };
        poll();
    });
}
