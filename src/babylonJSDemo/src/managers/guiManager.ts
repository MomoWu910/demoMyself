import { Scene, Texture, Mesh, StandardMaterial, Color3, Vector3 } from '@babylonjs/core'; // Babylon.js 核心模組

import * as GUI from '@babylonjs/gui';
import * as seatInfoJSON from '../../res/gui/guiSeatTexture.json';
import * as seatInfoJSON_mesh from '../../res/gui/guiSeatTexture_mesh.json';
import * as seatInfoJSON_detailCard from '../../res/gui/guiSeat_detailCard.json';
import * as seatInfoJSON_mesh_1080 from '../../res/gui/guiSeatTexture_mesh_1080.json';
import * as seatInfoJSON_detailCard_1080 from '../../res/gui/guiSeat_detailCard_1080.json';
import * as grabBtns_1080 from '../../res/gui/guiSeat_grabBtns_1080.json';

import { GuiSeat } from '../components/gui/guiSeat';
import { GuiDetailCard } from '../components/gui/guiDetailCard';
import { GuiGrabBtns } from '../components/gui/guiGrabBtns';
import { RayManager } from './rayManager';
import { BET_TYPE, SEAT_INDEX, GRAB_MULTIS } from '../constants/config';

export class GuiManager {
    private scene: Scene;
    private rayManager: RayManager;

    private guiSeatPlane: Mesh;
    private guiDetailCardPlane: Mesh;
    private guiGrabBtnsPlane: Mesh;
    private allGuiPlanes: Mesh[] = [];

    private adtSeats: GUI.AdvancedDynamicTexture;
    private guiSeats: GuiSeat[] = [];

    private adtDetailCard: GUI.AdvancedDynamicTexture;
    private guiDetailCards: GuiDetailCard[] = [];

    private adtGrabBtns: GUI.AdvancedDynamicTexture;
    private guiGrabBtns: GuiGrabBtns;

    constructor(scene: Scene, rayManager: RayManager) {
        this.scene = scene;
        this.rayManager = rayManager;
    }

    public registerPlanesToRayManager() {
        if (!this.guiSeatPlane || !this.guiDetailCardPlane || !this.guiGrabBtnsPlane) {
            console.error('GUI平面未初始化，無法註冊到RayManager');
            return;
        }

        this.allGuiPlanes = [this.guiSeatPlane, this.guiDetailCardPlane, this.guiGrabBtnsPlane];
        // 註冊座位平面到 RayManager
        this.allGuiPlanes.forEach((plane: Mesh) => {
            this.rayManager.registerPlanes(plane, (event) => {
                this.onPlaneHover.bind(this)(plane, event);
            });
        });
    }

    private onPlaneHover(plane: Mesh, event: any): void {
        const { type } = event;

        if (type === 'noHover') plane.isPickable = true;
        else if (type === 'hover') {
            // console.log(`Hovered over plane: ${plane.name}`, event);
            this.allGuiPlanes.forEach((p) => {
                p.isPickable = p === plane;
            });
        }
    }

    public initGuiSeats() {
        if (!this.guiSeatPlane || !this.guiDetailCardPlane) {
            console.error('GUI座位平面或細節卡片平面未初始化');
            return;
        }

        this.adtSeats = GUI.AdvancedDynamicTexture.CreateForMesh(this.guiSeatPlane, 1920, 1080, true);
        this.adtSeats.name = 'ADT_root_four_seats';
        this.adtSeats.parseSerializedObject(seatInfoJSON_mesh_1080);

        (this.guiSeatPlane.material as StandardMaterial).diffuseTexture = (this.guiSeatPlane.material as StandardMaterial).emissiveTexture;
        (this.guiSeatPlane.material as StandardMaterial).emissiveTexture = null;
        (this.guiSeatPlane.material as StandardMaterial).diffuseColor = Color3.White();

        this.guiSeatPlane.rotation = new Vector3(-Math.PI / 2, 0, 0); // 調整平面方向，對應右手定則
        (this.guiSeatPlane.material as StandardMaterial).disableLighting = true; // 不受光照影響
        (this.guiSeatPlane.material as StandardMaterial).backFaceCulling = false; // 雙面渲染
        (this.guiSeatPlane.material as StandardMaterial).emissiveColor = Color3.White(); // 避免變黑

        this.adtDetailCard = GUI.AdvancedDynamicTexture.CreateForMesh(this.guiDetailCardPlane, 1920, 1080, true);
        this.adtDetailCard.name = `ADT_root_detailCard`;
        this.adtDetailCard.parseSerializedObject(seatInfoJSON_detailCard_1080);

        (this.guiDetailCardPlane.material as StandardMaterial).diffuseTexture = (this.guiDetailCardPlane.material as StandardMaterial).emissiveTexture;
        (this.guiDetailCardPlane.material as StandardMaterial).emissiveTexture = null;
        (this.guiDetailCardPlane.material as StandardMaterial).diffuseColor = Color3.White();

        this.guiDetailCardPlane.rotation = new Vector3(-Math.PI / 2, 0, 0); // 調整平面方向，對應右手定則
        (this.guiDetailCardPlane.material as StandardMaterial).disableLighting = true; // 不受光照影響
        (this.guiDetailCardPlane.material as StandardMaterial).backFaceCulling = false; // 雙面渲染
        (this.guiDetailCardPlane.material as StandardMaterial).emissiveColor = Color3.White(); // 避免變黑

        this.adtSeats.getDescendants(true).forEach((control: GUI.Control, index: number) => {
            if (control) {
                const guiSeat = new GuiSeat(control, index);
                this.guiSeats.push(guiSeat);

                this.initGuiDetailCards(guiSeat, index);
            } else {
                console.warn('detailCardContainer control not found in AdvancedDynamicTexture.');
            }
        });
        this.hideAllGuiSeats();
    }

    public initGuiDetailCards(seat: GuiSeat, index: number) {
        const control = this.adtDetailCard.getDescendants(true)[index];

        if (control) {
            const detailCard = new GuiDetailCard(control, seat);
            seat.setDetailCardShowEvent(() => {
                detailCard.showAndFadeOutDetailCard();
            });
            this.guiDetailCards.push(detailCard);
        } else {
            console.warn('detailCardContainer control not found in AdvancedDynamicTexture.');
        }
    }

    public initGrabBtns() {
        if (!this.guiGrabBtnsPlane) {
            console.error('GUI搶莊按鈕平面未初始化');
            return;
        }
        this.adtGrabBtns = GUI.AdvancedDynamicTexture.CreateForMesh(this.guiGrabBtnsPlane, 1920, 1080, true);
        this.adtGrabBtns.hasAlpha = true;
        this.adtGrabBtns.name = `ADT_root_grabBtns`;
        this.adtGrabBtns.parseSerializedObject(grabBtns_1080);
        console.log('this.adtGrabBtns: ', this.adtGrabBtns);

        (this.guiGrabBtnsPlane.material as StandardMaterial).diffuseTexture = (this.guiGrabBtnsPlane.material as StandardMaterial).emissiveTexture;
        (this.guiGrabBtnsPlane.material as StandardMaterial).emissiveTexture = null;
        (this.guiGrabBtnsPlane.material as StandardMaterial).diffuseColor = Color3.White();

        this.guiGrabBtnsPlane.rotation = new Vector3(-Math.PI / 2, 0, 0); // 調整平面方向，對應右手定則
        (this.guiGrabBtnsPlane.material as StandardMaterial).disableLighting = true; // 不受光照影響
        (this.guiGrabBtnsPlane.material as StandardMaterial).backFaceCulling = false; // 雙面渲染
        (this.guiGrabBtnsPlane.material as StandardMaterial).emissiveColor = Color3.White(); // 避免變黑

        this.adtGrabBtns.getDescendants(true).forEach((control: GUI.Control, index: number) => {
            if (control) {
                const guiGrabBtns = new GuiGrabBtns(control);
                this.guiGrabBtns = guiGrabBtns;
            } else {
                console.warn(' control not found in AdvancedDynamicTexture.');
            }
        });

        this.guiGrabBtns.setGrabBtnCallback((btnIndex: number) => {
            console.log('Clicked button:', btnIndex);
            // 在這裡處理按鈕點擊事件
            this.guiSeats[SEAT_INDEX.SELF].setBetNumber(BET_TYPE.GRAB, GRAB_MULTIS[btnIndex]);
        });
    }

    /**
     * 顯示所有座位
     */
    public showAllGuiSeats() {
        this.guiSeats.forEach((seat) => seat.showGuiSeat());
    }

    /**
     * 隱藏所有座位
     */
    public hideAllGuiSeats() {
        this.guiSeats.forEach((seat) => seat.hideGuiSeat());
    }

    /**
     * 取得所有座位物件
     */
    public getAllGuiSeats(): GuiSeat[] {
        return this.guiSeats;
    }

    /**
     * 取得指定索引的座位物件
     */
    public getGuiSeat(index: number): GuiSeat | null {
        if (index >= 0 && index < this.guiSeats.length) {
            return this.guiSeats[index];
        }
        return null;
    }

    /**
     * set GUI座位平面
     */
    public setGuiSeatPlane(plane: Mesh) {
        this.guiSeatPlane = plane;
    }

    /**
     * set GUI玩家小卡平面
     */
    public setGuiDetailCardPlane(plane: Mesh) {
        this.guiDetailCardPlane = plane;
    }

    /**
     * set GUI搶莊按鈕平面
     */
    public setGuiGrabBtnsPlane(plane: Mesh) {
        this.guiGrabBtnsPlane = plane;
    }

    /**
     * 顯示搶莊按鈕
     */
    public showGuiGrabBtns() {
        if (this.guiGrabBtns) {
            this.guiGrabBtns.showGuiGrabBtns();
        }
    }

    /**
     * 隱藏搶莊按鈕
     */
    public hideGuiGrabBtns() {
        if (this.guiGrabBtns) {
            this.guiGrabBtns.hideGuiGrabBtns();
        }
    }

    /**
     * 銷毀 GUI
     */
    public dispose() {
        this.adtSeats.dispose();
        this.guiSeats.forEach((seat) => seat.dispose());
    }

    // 暫時沒用，丟這裡
    // private _initGuiSeats() {
    //     this.adtSeats = GUI.AdvancedDynamicTexture.CreateFullscreenUI('Seats', true, this.scene, Texture.BILINEAR_SAMPLINGMODE, true);
    //     this.adtSeats.parseSerializedObject(seatInfoJSON);
    //     this.adtSeats.idealWidth = 1000;
    //     this.adtSeats.idealHeight = 750;

    //     this.adtSeats.getDescendants(true).forEach((control: GUI.Control) => {
    //         if (control) {
    //             const guiSeat = new GuiSeat(control);
    //             this.guiSeats.push(guiSeat);
    //         } else {
    //             console.warn('detailCardContainer control not found in AdvancedDynamicTexture.');
    //         }
    //     });
    //     this.hideAllGuiSeats();
    // }
}
