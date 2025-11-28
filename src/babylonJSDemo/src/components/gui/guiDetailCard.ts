import * as GUI from '@babylonjs/gui';
import { ImagePack } from '../../constants/assets';
import { GuiSeat } from './guiSeat';
import { Animation, Animatable } from '@babylonjs/core'; // 匯入 Animation 和 Animatable

export class GuiDetailCard {
    private container: GUI.Rectangle;
    private seat: GuiSeat;

    private bgSprite: GUI.Image;

    private playerIcon: GUI.Image;
    private playerFrame: GUI.Image;

    private playerNameContainer: GUI.Rectangle;
    private playerNameLabel: GUI.TextBlock;

    private locationIcon: GUI.Image;

    private locationLabelContainer: GUI.Rectangle;
    private locationLabel: GUI.TextBlock;

    private scoreLabelContainer: GUI.Rectangle;
    private scoreLabel: GUI.TextBlock;

    private currentAnimation: Animatable | null = null; // 用於追蹤當前動畫

    constructor(detailCardRoot: GUI.Control, seat: GuiSeat) {
        this.container = detailCardRoot as GUI.Rectangle;
        this.seat = seat;

        this.init();
        this.container.isVisible = false;
    }

    private init() {
        this.bgSprite = this.container.children.find((control) => control.name === 'bgSprite') as GUI.Image;
        this.bgSprite.source = ImagePack.seat_player_bg;
        this.bgSprite.autoScale = true;

        this.playerIcon = this.container.children.find((control) => control.name === 'icon') as GUI.Image;
        this.playerIcon.source = ImagePack[`icon_${this.seat.getIconId()}` as keyof typeof ImagePack];
        this.playerIcon.autoScale = true;

        this.playerFrame = this.container.children.find((control) => control.name === 'frame') as GUI.Image;
        this.playerFrame.autoScale = true;
        this.playerFrame.source = ImagePack[`frame_${this.seat.getFrameId()}` as keyof typeof ImagePack];

        this.playerNameContainer = this.container.children.find(
            (control) => control.name === 'playerNameLabelContainer'
        ) as GUI.Rectangle;
        this.playerNameLabel = this.playerNameContainer.children.find(
            (control) => control.name === 'playerNameLabel'
        ) as GUI.TextBlock;
        this.playerNameLabel.forceResizeWidth = true;
        this.playerNameLabel.resizeToFit = true;
        this.playerNameLabel.onTextChangedObservable.add(() => {
            if (this.playerNameLabel.widthInPixels > this.playerNameContainer.widthInPixels)
                this.playerNameLabel.scaleX = Number(
                    this.playerNameContainer.widthInPixels / this.playerNameLabel.widthInPixels
                );
        });

        this.locationIcon = this.container.children.find((control) => control.name === 'locationIcon') as GUI.Image;
        this.locationIcon.source = ImagePack.seat_location;
        this.locationIcon.autoScale = true;

        this.locationLabelContainer = this.container.children.find(
            (control) => control.name === 'locationLabelContainer'
        ) as GUI.Rectangle;
        this.locationLabel = this.locationLabelContainer.children.find(
            (control) => control.name === 'locationLabel'
        ) as GUI.TextBlock;
        this.locationLabel.forceResizeWidth = true;
        this.locationLabel.resizeToFit = true;
        this.locationLabel.onTextChangedObservable.add(() => {
            if (this.locationLabel.widthInPixels > this.locationLabelContainer.widthInPixels)
                this.locationLabel.scaleX = Number(
                    this.locationLabelContainer.widthInPixels / this.locationLabel.widthInPixels
                );
        });

        this.scoreLabelContainer = this.container.children.find(
            (control) => control.name === 'scoreLabelContainer'
        ) as GUI.Rectangle;
        this.scoreLabel = this.scoreLabelContainer.children.find(
            (control) => control.name === 'scoreLabel'
        ) as GUI.TextBlock;
        this.scoreLabel.forceResizeWidth = true;
        this.scoreLabel.resizeToFit = true;
        this.scoreLabel.onTextChangedObservable.add(() => {
            if (this.scoreLabel.widthInPixels > this.scoreLabelContainer.widthInPixels)
                this.scoreLabel.scaleX = Number(this.scoreLabelContainer.widthInPixels / this.scoreLabel.widthInPixels);
        });
    }

    public showAndFadeOutDetailCard() {
        this.container.isVisible = true;

        // 如果有正在進行的動畫，重新開始
        if (this.currentAnimation) {
            this.currentAnimation.pause();
            this.currentAnimation.goToFrame(0);
            this.currentAnimation.restart();
            return;
        }

        const fadeOutAnimation = new Animation(
            'fadeOut',
            'alpha',
            60, // 每秒 60 幀
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        const keys = [
            { frame: 0, value: 1 }, // 起始透明度
            { frame: 180, value: 1 }, // 維持 3 秒透明度為 1
            { frame: 200, value: 0 }, // 0.5 秒後透明度為 0
        ];

        fadeOutAnimation.setKeys(keys);

        // 將動畫應用到容器
        this.container.animations = [fadeOutAnimation];
        const scene = this.container._host.getScene(); // 獲取場景
        if (scene) {
            this.currentAnimation = scene.beginAnimation(this.container, 0, 200, false, 1, () => {
                this.container.isVisible = false; // 動畫結束後隱藏容器
                this.currentAnimation = null; // 清除當前動畫引用
            });
        }
    }

    public hideDetailCard() {
        // 如果有正在進行的動畫，先停止
        if (this.currentAnimation) {
            this.currentAnimation.stop();
            this.currentAnimation = null; // 清除當前動畫引用
        }
        this.container.isVisible = false;
    }

    /**
     * 銷毀 GUI
     */
    public dispose() {
        this.container.dispose();
    }
}
