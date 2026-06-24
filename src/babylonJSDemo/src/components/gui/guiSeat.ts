import * as GUI from '@babylonjs/gui';
import { ImagePack } from '../../constants/assets';
import { BET_TYPE, SEAT_INDEX } from '../../constants/config';
export class GuiSeat {
    private container: GUI.Rectangle;
    private seatIndex: number;

    private playerFrame: GUI.Image;
    private playerIcon: GUI.Image;
    private scoreLabelContainer: GUI.Rectangle;
    private scoreLabel: GUI.TextBlock;
    private scoreBg: GUI.Image;
    private playerNameLabel: GUI.TextBlock;
    private infoBg: GUI.Image;

    private betNumberContainer: GUI.Rectangle;
    private betNumberAlignLeft: boolean;

    private iconId: number;
    private frameId: number;

    constructor(seatRoot: GUI.Control, index: number) {
        // 創建座位容器
        this.container = seatRoot as GUI.Rectangle;
        this.seatIndex = index;
        this.betNumberAlignLeft = this.seatIndex === SEAT_INDEX.PLAYER_1;

        this.init();
        this.setEvents();
        this.setBetNumber(BET_TYPE.GRAB, 0);
    }

    private setEvents() {
        this.playerFrame.onPointerDownObservable.add(() => {
            this.playerFrame.scaleX = this.playerFrame.scaleY = 0.9;
            this.playerIcon.scaleX = this.playerIcon.scaleY = 0.9;
        });
        this.playerFrame.onPointerUpObservable.add(() => {
            this.playerFrame.scaleX = this.playerFrame.scaleY = 1;
            this.playerIcon.scaleX = this.playerIcon.scaleY = 1;
        });
        this.playerFrame.onPointerOutObservable.add(() => {
            this.playerFrame.scaleX = this.playerFrame.scaleY = 1;
            this.playerIcon.scaleX = this.playerIcon.scaleY = 1;
        });

        this.scoreLabel.onTextChangedObservable.add(() => {
            if (this.scoreLabel.widthInPixels > this.scoreLabelContainer.widthInPixels) this.scoreLabel.scaleX = Number(this.scoreLabelContainer.widthInPixels / this.scoreLabel.widthInPixels);
        });
        this.playerFrame.onIsVisibleChangedObservable.add(() => {
            const { width, height } = this.playerFrame._prevCurrentMeasureTransformedIntoGlobalSpace;
            this.playerFrame.width !== width + 'px' && (this.playerFrame.width = width + 'px');
            this.playerFrame.height !== height + 'px' && (this.playerFrame.height = height + 'px');
        });
    }

    private init() {
        this.playerFrame = this.container.children.find((control) => control.name === 'frame') as GUI.Image;
        this.frameId = Math.floor(Math.random() * 12);
        this.playerFrame.source = ImagePack[`frame_${this.frameId}` as keyof typeof ImagePack];
        this.playerFrame.hoverCursor = 'pointer';

        this.playerIcon = this.container.children.find((control) => control.name === 'icon') as GUI.Image;
        this.iconId = Math.floor(Math.random() * 12);
        this.playerIcon.source = ImagePack[`icon_${this.iconId}` as keyof typeof ImagePack];

        const scoreContainer = this.container.children.find((control) => control.name === 'scoreContainer') as GUI.Rectangle;
        this.scoreLabelContainer = scoreContainer.children.find((control) => control.name === 'scoreLabelContainer') as GUI.Rectangle;
        this.scoreLabel = this.scoreLabelContainer.children.find((control) => control.name === 'scoreLabel') as GUI.TextBlock;
        this.scoreLabel.forceResizeWidth = true;
        this.scoreLabel.resizeToFit = true;

        this.scoreBg = scoreContainer.children.find((control) => control.name === 'scoreBg') as GUI.Image;
        this.scoreBg.source = ImagePack.seat_gold_bar;

        const infoContainer = this.container.children.find((control) => control.name === 'infoContainer') as GUI.Rectangle;
        const nameLabelContainer = infoContainer.children.find((control) => control.name === 'nameLabelContainer') as GUI.Rectangle;
        this.playerNameLabel = nameLabelContainer.children.find((control) => control.name === 'nameLabel') as GUI.TextBlock;
        this.playerNameLabel.color = 'white';

        this.infoBg = infoContainer.children.find((control) => control.name === 'infoBg') as GUI.Image;
        this.infoBg.source = ImagePack.seat_play_bg;

        this.betNumberContainer = this.container.children.find((control) => control.name === 'betNumberContainer') as GUI.Rectangle;
        this.betNumberContainer.isVisible = false;
    }

    /**
     * 綁定玩家小卡顯示 function
     */
    public setDetailCardShowEvent(showFunction: () => void) {
        this.playerFrame.onPointerClickObservable.add(() => {
            showFunction();
        });
    }

    /**
     * get playerFrame
     */
    public getPlayerFrame(): GUI.Image {
        return this.playerFrame;
    }

    /**
     * 顯示座位
     */
    public showGuiSeat() {
        if (this.container) {
            this.container.isVisible = true;
        }
    }

    /**
     * 隱藏座位
     */
    public hideGuiSeat() {
        if (this.container) {
            this.container.isVisible = false;
        }
    }

    /**
     * 更新玩家名稱
     */
    public updateName(name: string) {
        if (this.playerNameLabel) {
            this.playerNameLabel.text = name;
        }
    }

    /**
     * 更新玩家金額
     */
    public updateScore(score: number) {
        if (this.scoreLabel) {
            this.scoreLabel.text = score.toString();
        }
    }

    /**
     * 設置下注數字
     */
    public setBetNumber(type: BET_TYPE, multi: number) {
        if (this.betNumberContainer) {
            const numArr = multi.toString().split('');
            this.betNumberContainer.children.forEach((control) => {
                this.betNumberContainer.removeControl(control);
            });

            this.betNumberContainer.isVisible = true;
            let totalWidth = 0;

            if (multi > 0) {
                const xLabel = new GUI.Image('xLabel', type === BET_TYPE.GRAB ? ImagePack.qz_grab_number_x : ImagePack.qz_bet_number_x);
                this.betNumberContainer.addControl(xLabel);
                xLabel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
                xLabel.left = '0px';
                xLabel.autoScale = true;
                console.log('xLabel.widthInPixels:', xLabel.imageWidth, xLabel.widthInPixels);
                totalWidth += xLabel.widthInPixels;

                numArr.forEach((num, index) => {
                    const betNumber = new GUI.Image(`betNumber_${index}`, type === BET_TYPE.GRAB ? ImagePack[`qz_grab_number_${num}` as keyof typeof ImagePack] : ImagePack[`qz_bet_number_${num}` as keyof typeof ImagePack]);
                    betNumber.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
                    betNumber.left = `${totalWidth}px`;
                    betNumber.autoScale = true;
                    this.betNumberContainer.addControl(betNumber);
                    totalWidth += betNumber.widthInPixels;
                });
            } else {
                const noBetLabel = new GUI.Image('noBetLabel', type === BET_TYPE.GRAB ? ImagePack.qz_grab_0 : ImagePack.qz_bet_number_x);
                noBetLabel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
                noBetLabel.left = '0px';
                noBetLabel.autoScale = true;
                this.betNumberContainer.addControl(noBetLabel);
                totalWidth += noBetLabel.widthInPixels;

                if (type === BET_TYPE.BET) {
                    const betZeroLabel = new GUI.Image('betZeroLabel', ImagePack.qz_bet_number_0);
                    betZeroLabel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
                    betZeroLabel.left = `${totalWidth}px`;
                    betZeroLabel.autoScale = true;
                    this.betNumberContainer.addControl(betZeroLabel);
                    totalWidth += betZeroLabel.widthInPixels;
                }
            }
        }
    }

    /**
     * 顯示玩家圖標
     */
    public showPlayerIcon() {
        if (this.playerIcon) {
            this.playerIcon.isVisible = true;
        }
    }

    /**
     * 隱藏玩家圖標
     */
    public hidePlayerIcon() {
        if (this.playerIcon) {
            this.playerIcon.isVisible = false;
        }
    }

    /**
     * get 玩家頭像id
     */
    public getIconId(): number {
        return this.iconId;
    }

    /**
     * get 玩家頭像編筐id
     */
    public getFrameId(): number {
        return this.frameId;
    }

    /**
     * 銷毀 GUI
     */
    public dispose() {
        this.container.dispose();
    }
}
