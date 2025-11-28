import { GameView } from './views/gameView';

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const gameView = new GameView(canvas);
    gameView.init(canvas).then(() => {
        // 初始化完成後，開始渲染迴圈
        gameView.run();
    });
});
