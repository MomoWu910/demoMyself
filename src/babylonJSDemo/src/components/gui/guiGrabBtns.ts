import * as GUI from '@babylonjs/gui';
import { ImagePack } from '../../constants/assets';
import { GRAB_MULTIS } from '../../constants/config';

const grab_multi = GRAB_MULTIS;

export class GuiGrabBtns {
    private container: GUI.Rectangle;
    private noGrabContainer: GUI.Rectangle;
    private grab1Container: GUI.Rectangle;
    private grab2Container: GUI.Rectangle;
    private grab3Container: GUI.Rectangle;
    private grab4Container: GUI.Rectangle;
    private noGrabBtn: GUI.Image;
    private grab1Btn: GUI.Image;
    private grab2Btn: GUI.Image;
    private grab3Btn: GUI.Image;
    private grab4Btn: GUI.Image;

    constructor(grabBtnsRoot: GUI.Control) {
        this.container = grabBtnsRoot as GUI.Rectangle;

        this.init();
        this.setEvents();

        this.container.isVisible = false;
    }

    private setEvents() {
        const btnList = [this.noGrabContainer, this.grab1Container, this.grab2Container, this.grab3Container, this.grab4Container];
        btnList.forEach((btn, index) => {
            btn.hoverCursor = 'pointer';
            btn.onPointerDownObservable.add(() => {
                btn.scaleX = btn.scaleY = 0.9;
                btn.scaleX = btn.scaleY = 0.9;
            });

            btn.onPointerUpObservable.add(() => {
                btn.scaleX = btn.scaleY = 1;
                btn.scaleX = btn.scaleY = 1;
            });

            btn.onPointerOutObservable.add(() => {
                btn.scaleX = btn.scaleY = 1;
                btn.scaleX = btn.scaleY = 1;
            });
        });
    }

    private init() {
        this.noGrabContainer = this.container.children.find((control) => control.name === 'noGrabContainer') as GUI.Rectangle;
        this.noGrabBtn = this.noGrabContainer.children.find((control) => control.name === 'noGrabBtn') as GUI.Image;
        this.noGrabBtn.isPointerBlocker = false; // 加這行才可以觸發 Observable 事件
        this.noGrabBtn.source = ImagePack.qz28g_btn_nograb;

        this.grab1Container = this.container.children.find((control) => control.name === 'grab1Container') as GUI.Rectangle;
        this.grab1Btn = this.grab1Container.children.find((control) => control.name === 'grab1Btn') as GUI.Image;
        this.grab1Btn.isPointerBlocker = false; // 加這行才可以觸發 Observable 事件
        this.grab1Btn.source = ImagePack.qz28g_btn_multi;
        this.addGrabMultiNum(this.grab1Container, grab_multi[1]);

        this.grab2Container = this.container.children.find((control) => control.name === 'grab2Container') as GUI.Rectangle;
        this.grab2Btn = this.grab2Container.children.find((control) => control.name === 'grab2Btn') as GUI.Image;
        this.grab2Btn.isPointerBlocker = false; // 加這行才可以觸發 Observable 事件
        this.grab2Btn.source = ImagePack.qz28g_btn_multi;
        this.addGrabMultiNum(this.grab2Container, grab_multi[2]);

        this.grab3Container = this.container.children.find((control) => control.name === 'grab3Container') as GUI.Rectangle;
        this.grab3Btn = this.grab3Container.children.find((control) => control.name === 'grab3Btn') as GUI.Image;
        this.grab3Btn.isPointerBlocker = false; // 加這行才可以觸發 Observable 事件
        this.grab3Btn.source = ImagePack.qz28g_btn_multi;
        this.addGrabMultiNum(this.grab3Container, grab_multi[3]);

        this.grab4Container = this.container.children.find((control) => control.name === 'grab4Container') as GUI.Rectangle;
        this.grab4Btn = this.grab4Container.children.find((control) => control.name === 'grab4Btn') as GUI.Image;
        this.grab4Btn.isPointerBlocker = false; // 加這行才可以觸發 Observable 事件
        this.grab4Btn.source = ImagePack.qz28g_btn_multi;
        this.addGrabMultiNum(this.grab4Container, grab_multi[4]);
    }

    /**
     * 新增搶莊倍率數字圖在按鈕上
     */
    private addGrabMultiNum(btnContainer: GUI.Rectangle, multiNumber: number) {
        // 拆解multiNumber成個位數字陣列
        const digits = multiNumber
            .toString()
            .split('')
            .map((digit) => parseInt(digit));
        const digitCount = digits.length;

        // 清除現有的數字圖
        btnContainer.children.forEach((child) => {
            if (child.name && child.name.startsWith('grabNum_')) {
                btnContainer.removeControl(child);
                child.dispose();
            }
        });

        // 新增數字圖
        digits.forEach((digit, index) => {
            const digitImage = new GUI.Image(`grabNum_${index}`, ImagePack[`qz28g_btn_multi_number_${digit}` as keyof typeof ImagePack]);
            digitImage.isPointerBlocker = false;
            digitImage.width = '27px';
            digitImage.height = '35px';
            btnContainer.addControl(digitImage);
        });

        // 新增倍字圖
        const baImage = new GUI.Image('grabBa', ImagePack.qz28g_btn_multi_ba);
        baImage.isPointerBlocker = false;
        baImage.width = '34px';
        baImage.height = '35px';
        btnContainer.addControl(baImage);

        // 調整數字圖與倍字圖的座標，使其置中
        const width = (btnContainer.getChildByName('grabNum_0') as GUI.Image).widthInPixels;
        const grabNumOffsetX = -3; // 數字圖間隔微調
        const baImageOffsetX = 3; // 倍字圖與最後一個數字圖間隔微調
        const grabNumTotalWidth = digitCount * width + (digitCount - 1) * grabNumOffsetX;
        const startX = -(grabNumTotalWidth + baImageOffsetX + baImage.widthInPixels) / 2;

        digits.forEach((digit, index) => {
            const digitImage = btnContainer.getChildByName(`grabNum_${index}`) as GUI.Image;
            if (digitImage) {
                digitImage.left = `${startX + index * (width + grabNumOffsetX) + 0.5 * width}px`;
                digitImage.top = `-9px`;
            }
        });

        baImage.left = `${startX + grabNumTotalWidth + baImageOffsetX + baImage.widthInPixels / 2}px`;
        baImage.top = `-9px`;
    }

    /**
     * get 所有搶莊按鈕
     */
    public getGrabButtons(): GUI.Rectangle[] {
        return [this.noGrabContainer, this.grab1Container, this.grab2Container, this.grab3Container, this.grab4Container];
    }

    /**
     * 設定搶莊按鈕回調函數
     * @param callback
     */
    public setGrabBtnCallback(callback: (btnIndex: number) => void) {
        const btnList = [this.noGrabContainer, this.grab1Container, this.grab2Container, this.grab3Container, this.grab4Container];
        btnList.forEach((btn, index) => {
            btn.onPointerUpObservable.add(() => {
                callback(index);
            });
        });
    }

    /**
     * 顯示搶莊按鈕
     */
    public showGuiGrabBtns() {
        if (this.container) {
            this.container.isVisible = true;
        }
    }

    /**
     * 隱藏搶莊按鈕
     */
    public hideGuiGrabBtns() {
        if (this.container) {
            this.container.isVisible = false;
        }
    }

    /**
     * 銷毀 GUI
     */
    public dispose() {
        this.container.dispose();
    }
}
