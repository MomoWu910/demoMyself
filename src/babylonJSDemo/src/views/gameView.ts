import {
    Engine,
    Scene,
    Vector3,
    PassPostProcess,
    NodeRenderGraph,
    NodeMaterial,
    Quaternion,
    Mesh,
    MeshBuilder,
} from '@babylonjs/core'; // Babylon.js 核心模組
import '@babylonjs/inspector'; // Babylon.js 場景偵測器
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2';
import { registerBuiltInLoaders } from '@babylonjs/loaders/dynamic';
import { HLight } from '../components/lights/hemisphericLight'; // 半球光元件
import { DLight } from '../components/lights/directionalLight'; // 定向光元件
import { PLight } from '../components/lights/pointLight'; // 點光源元件
import { Ceiling } from '../components/scene/ceiling'; // 天花板元件
import { Floor } from '../components/scene/floor'; // 地板元件
import { Wall } from '../components/scene/wall'; // 牆壁元件
import { HalfCylinderTable } from '../components/scene/halfCTable'; // 半圓賭桌元件
import { CylinderTable } from '../components/scene/cTable'; // 橢圓賭桌元件
import { Chair } from '../components/scene/chair'; // 椅子元件
import { DiceCup } from '../components/dices/diceCup'; // 骰盅元件
import { Dice } from '../components/dices/dice'; // 骰子元件
import { Mahjong } from '../components/cards/mahjong'; // 麻將元件
import { Dominoes } from '../components/cards/dominoes'; // 多米諾骨牌元件
import { SelfPlayer } from '../components/players/self';
import { Dealer } from '../components/dealer/dealer'; // 荷官元件
import { Dealer_MultiMeshes } from '../components/dealer/dealer_multiMeshes'; // 荷官元件(多網格版本)
import { PlayerCamera } from '../components/cameras/playerCamera'; // 玩家相機元件
import { DevCamera } from '../components/cameras/devCamera'; // 開發用上帝視角相機元件
import { Game28gAngelCamera } from '../components/cameras/game_28gAngle_Camera'; // 28度角相機元件

import { InputManager } from '../managers/inputManager'; // 輸入管理器
import { PhysicsManager } from '../managers/physicsManager';
import { RayManager } from '../managers/rayManager';
import { GuiManager } from '../managers/guiManager';
import { SceneBuilder } from '../scene/sceneBuilder';
import { FurnitureModule } from '../scene/modules/furnitureModule';
import { RoomModule } from '../scene/modules/roomModule';
import { DefaultRoomConfig } from '../config/scene/roomConfig';

import { ImagePack, ModelPack, ResourcesKey } from '../constants/assets';
import { Z_INDEX } from '../constants/config';
import { AssetManager } from '../managers/assetManager';

const DICE_SCALE = 0.1;

// // gui json: 1000, 750
// const GUI_28G_PLANE_WIDTH = 10;
// const GUI_28G_PLANE_HEIGHT = 7.5;
// const GUI_28G_PLANE_SCALE = 0.45;

// gui json: 1920, 1080
const GUI_28G_PLANE_WIDTH = 16;
const GUI_28G_PLANE_HEIGHT = 9;
const GUI_28G_PLANE_SCALE = 0.3;

const GUI_START_POS_Y = 6;
const GUI_PLANE_GAP = 0.01;

/**
 * 遊戲場景管理類別
 * @description 管理 Babylon.js 場景初始化、物件建立與渲染迴圈
 */
export class GameView {
    private canvas: HTMLCanvasElement;
    public engine: Engine; // Babylon.js 引擎
    public scene: Scene; // Babylon.js 場景
    public playerCamera: PlayerCamera; // 玩家相機
    public devCamera: DevCamera; // 開發用相機
    public game28gAngelCamera: Game28gAngelCamera; // 28度角相機

    public guiSeatPlane: Mesh; // 用來貼上seat ui的平面
    public guiDetailCardPlane: Mesh; // 用來貼上detail card ui的平面
    public guiGrabBtnsPlane: Mesh; // 用來貼上grab buttons ui的平面

    public ceiling: Ceiling; // 天花板物件
    public walls: Wall[] = []; // 牆壁物件列表
    public floor: Floor; // 地板物件
    public halfCylinderTable: HalfCylinderTable; // 半圓賭桌物件
    public cylinderTable: CylinderTable; // 橢圓賭桌物件
    public currentTable: HalfCylinderTable | CylinderTable; // 當前賭桌物件
    public chair: Chair; // 椅子物件
    public selfPlayer: SelfPlayer; // 玩家物件（SelfPlayer）
    public diceCup: DiceCup; // 骰盅物件
    public dice1: Dice; // 骰子物件
    public dice2: Dice; // 骰子物件
    public mahjong: Mahjong; // 麻將物件
    public dominoes: Dominoes; // 多米諾骨牌物件
    public dealer: Dealer | Dealer_MultiMeshes; // 荷官物件
    public dealer_2: Dealer | Dealer_MultiMeshes; // 荷官物件
    public otherPlayer_1: Dealer | Dealer_MultiMeshes;
    public otherPlayer_2: Dealer | Dealer_MultiMeshes;

    public physicsManager: PhysicsManager;
    public inputManager: InputManager; // 輸入管理器
    private a8gCameraRayManager: RayManager;
    private guiManager: GuiManager;
    private inputDisposers: Array<() => void> = [];
    private sceneBuilder: SceneBuilder; // 統一管理靜態場景模組
    private roomModule?: RoomModule; // 房間模組引用，提供地板/牆/天花板
    private furnitureModule?: FurnitureModule; // 家具模組引用，提供桌椅資訊

    /**
     * 建構子：初始化引擎與場景，並建立主要場景物件
     * @param canvas HTMLCanvasElement - 用於渲染的畫布
     */
    constructor(canvas: HTMLCanvasElement) {
        this.engine = new Engine(canvas, true); // 建立 Babylon.js 引擎
        this.scene = new Scene(this.engine); // 建立場景
        this.scene.useRightHandedSystem = true; // 使用右手座標系
        this.canvas = canvas;

        // 監聽視窗大小變化事件
        window.addEventListener('resize', () => {
            this.engine.resize(); // 調整引擎大小
            // this.guiManager.resizeGui();
        });

        this.physicsManager = new PhysicsManager(this.scene);
        this.sceneBuilder = new SceneBuilder({ scene: this.scene, physics: this.physicsManager }); // 建立靜態場景組裝器
        registerBuiltInLoaders();
    }

    /**
     * 切換相機
     */
    public switchCamera() {
        if (this.scene.activeCamera === this.playerCamera.camera) {
            this.scene.activeCamera = this.devCamera.camera;
            this.devCamera.enableControl(true, this.canvas);
            this.guiManager.hideAllGuiSeats();
            this.guiManager.hideGuiGrabBtns();
        } else if (this.scene.activeCamera === this.devCamera.camera) {
            this.scene.activeCamera = this.game28gAngelCamera.camera;
            this.guiManager.showAllGuiSeats();
            this.guiManager.showGuiGrabBtns();
        } else {
            this.scene.activeCamera = this.playerCamera.camera;
            this.playerCamera.enableControl(true, this.canvas);
            this.guiManager.hideAllGuiSeats();
            this.guiManager.hideGuiGrabBtns();
        }
    }

    /**
     * 顯示 Babylon.js Inspector（開發用，可即時檢查場景物件）
     */
    private async _showInspector() {
        const showingInspector = await this.scene.debugLayer.show({
            overlay: true, // 讓列表過長時滾動不會滾到整個網頁
        });
    }

    /**
     * 啟動渲染迴圈，持續更新場景
     */
    public run() {
        let dice1Stopped = false;
        let dice2Stopped = false;
        this.engine.runRenderLoop(() => {
            // 相機在玩家上方
            const playerCameraPos = this.playerCamera.position;
            const selfPlayerPos = this.selfPlayer.Mesh.position;

            // 玩家物件固定角度
            this.selfPlayer.Mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI, 0);
            const direction: Quaternion = this.selfPlayer.Mesh.rotationQuaternion as Quaternion;
            this.selfPlayer.Mesh.physicsBody?.setTargetTransform(
                playerCameraPos.add(new Vector3(0, -2.5, 0)),
                direction
            );
            // this.selfPlayer.Mesh.position = this.playerCamera.camera.position.add(new Vector3(0, -2.5, 0));

            if (this.game28gAngelCamera) {
                this.game28gAngelCamera.camera.alpha = Math.PI / 2;
                this.game28gAngelCamera.camera.beta = 0;
            }

            // // 偵測骰子靜止
            if (this.dice1 && this.dice1.Mesh && this.dice1.Mesh.physicsBody && this.dice1.Mesh.visibility === 1) {
                const linear = this.dice1.Mesh.physicsBody.getLinearVelocity();
                const angular = this.dice1.Mesh.physicsBody.getAngularVelocity();
                const isStopped = linear.length() < 0.05 && angular.length() < 0.05;

                if (isStopped && !dice1Stopped) {
                    dice1Stopped = true;
                    const topValue = this.dice1.getTopFaceValue();
                    console.log('骰子1 停止，朝上的點數：', topValue);
                }
                if (!isStopped) {
                    dice1Stopped = false;
                }
            }

            if (this.dice2 && this.dice2.Mesh && this.dice2.Mesh.physicsBody && this.dice2.Mesh.visibility === 1) {
                const linear = this.dice2.Mesh.physicsBody.getLinearVelocity();
                const angular = this.dice2.Mesh.physicsBody.getAngularVelocity();
                const isStopped = linear.length() < 0.05 && angular.length() < 0.05;

                if (isStopped && !dice2Stopped) {
                    dice2Stopped = true;
                    const topValue = this.dice2.getTopFaceValue();
                    console.log('骰子2 停止，朝上的點數：', topValue);
                }
                if (!isStopped) {
                    dice2Stopped = false;
                }
            }

            this.inputManager.update();

            this.scene.render(); // 渲染場景
        });
    }

    /**
     * 釋放 GameView 綁定的資源
     * 目前用於解除所有輸入綁定，後續需要時可擴充場景銷毀流程
     */
    public destroy() {
        this.sceneBuilder.destroy(); // 釋放靜態模組持有的資源
        this.roomModule = undefined;
        this.furnitureModule = undefined;
        this.inputDisposers.forEach((dispose) => {
            try {
                dispose();
            } catch (error) {
                console.warn('Failed to dispose input binding', error);
            }
        });
        this.inputDisposers = [];
    }

    //#region init
    public async init(canvas: HTMLCanvasElement) {
        await AssetManager.preloadAssets(this.scene, { ...ImagePack });
        AssetManager.backgroundPreloadAssets(this.scene, { ...ModelPack });
        await this.physicsManager.enablePhysics(); // 啟用物理系統

        this._initInputManager();
        this._initLight(); // 初始化光源
        this._buildStaticScene(); // 透過 SceneBuilder 建立房間與桌椅
        this._initDiceCup(); // 加入骰盅物件
        this._initDice(); // 加入骰子物件
        this._initMahjong(); // 加入麻將物件
        // this._initDominoes(); // 加入多米諾骨牌物件

        this._initPlayerCamera(canvas); // 初始化玩家相機
        this._initSelfPlayer(); // 加入玩家物件
        this._initDevCamera(canvas); // 初始化開發用相機
        this._initGame28gAngelCamera(canvas); // 初始化 28 度角相機
        this.inputDisposers.push(
            this.inputManager.registerActionMap('gameView.camera', {
                c: { onPressed: () => this.switchCamera() },
            })
        );

        this._initDealer();
        this._initOtherPlayers();

        this.a8gCameraRayManager = new RayManager(this.scene, this.game28gAngelCamera.camera);

        // 初始化 GUI 管理器
        this.guiManager = new GuiManager(this.scene, this.a8gCameraRayManager);
        this.guiManager.setGuiSeatPlane(this.guiSeatPlane);
        this.guiManager.setGuiDetailCardPlane(this.guiDetailCardPlane);
        this.guiManager.initGuiSeats();
        this.guiManager.setGuiGrabBtnsPlane(this.guiGrabBtnsPlane);
        this.guiManager.initGrabBtns();

        this.guiManager.registerPlanesToRayManager();

        // this._showInspector(); // 顯示場景偵測器（開發用）

        // await this.doFrameGraph(); // 套用一個編輯器拉節點，注意輸入輸出，效果有點類似shader
        // await this.doNodeMaterial(); // 基本上就是shader
    }

    /**
     * 初始化玩家相機（第一人稱視角）
     * @param canvas HTMLCanvasElement - 用於控制相機的畫布
     */
    private _initPlayerCamera(canvas: HTMLCanvasElement) {
        const startPosition: Vector3 = new Vector3(0, 6, 15);
        this.playerCamera = new PlayerCamera(this.scene, canvas, startPosition);
        this.playerCamera.setTarget(new Vector3(0, 5, 0)); // 設定相機目標位置

        this.inputDisposers.push(this.inputManager.registerActionMap('playerCamera', this.playerCamera.getActionMap()));
        this.inputDisposers.push(this.inputManager.registerPointerTarget('playerCamera', this.playerCamera));
    }

    /**
     * 建立玩家物件（SelfPlayer）
     * 場景中央加入玩家物件
     */
    private _initSelfPlayer() {
        this.selfPlayer = new SelfPlayer(this.scene);
        const height = this.selfPlayer.Height;
        this.selfPlayer.Mesh.position = new Vector3(0, height / 2 + 0.5, 10); // 玩家物件放置於場景中央
        this.physicsManager.addPhysics(this.selfPlayer.Mesh, PhysicsMotionType.DYNAMIC, false, 1);
        this.selfPlayer.Mesh.physicsBody?.setAngularDamping(5000);
    }

    /**
     * 初始化荷官物件，放置於賭桌旁
     */
    private _initDealer() {
        this.dealer = new Dealer_MultiMeshes(this.scene, 1, ResourcesKey.angelwomon, (dealer: Dealer_MultiMeshes) => {
            const dealerPosition = new Vector3(0, 0, -4.5);
            const scale = 4;
            const dealerScale = new Vector3(scale, scale, scale);
            const mesh = dealer.Mesh;
            mesh.setEnabled(true);
            mesh.position = dealerPosition;
            mesh.scaling = dealerScale;

            dealer.playWin({ isAdditive: true, isLoop: true });
        });

        this.dealer_2 = new Dealer_MultiMeshes(this.scene, 4, ResourcesKey.angelwomon, (dealer: Dealer_MultiMeshes) => {
            const dealerPosition = new Vector3(2, 0, -5.5);
            const scale = 4;
            const dealerScale = new Vector3(scale, scale, scale);
            const mesh = dealer.Mesh;
            mesh.setEnabled(true);
            mesh.position = dealerPosition;
            mesh.scaling = dealerScale;

            dealer.playEat({ isAdditive: true, isLoop: true });
        });
    }

    /**
     * 初始化其他玩家物件
     */
    private _initOtherPlayers() {
        this.otherPlayer_1 = new Dealer_MultiMeshes(
            this.scene,
            2,
            ResourcesKey.iuno_dance,
            (player1: Dealer_MultiMeshes) => {
                const mesh = player1.Mesh;
                mesh.setEnabled(true);
                // mesh.position = new Vector3(-5, 0, 0);
                mesh.position = new Vector3(-6, 0, 0);
                // mesh.rotation = new Vector3(0, Math.PI / 2, 0);
                // mesh.rotation = new Vector3(0, 0, 0);

                // const scale = 0.35;
                const scale = 4;
                // const scale = 40;
                mesh.scaling = new Vector3(scale, scale, scale);

                player1.playIdle({ isAdditive: true, isLoop: true });
            }
        );
        this.otherPlayer_2 = new Dealer_MultiMeshes(
            this.scene,
            3,
            ResourcesKey.canterella_dance,
            (player2: Dealer_MultiMeshes) => {
                const mesh = player2.Mesh;
                mesh.setEnabled(true);
                mesh.position = new Vector3(5, 0, 0);
                // mesh.rotation = new Vector3(0, -Math.PI / 2, 0);
                const scale = 4;
                mesh.scaling = new Vector3(scale, scale, scale);

                player2.playIdle({ isAdditive: true, isLoop: true });
            }
        );
    }

    /**
     * 建立骰盅物件並放置於桌面中央
     */
    private _initDiceCup() {
        const afterInit = (diceCup: DiceCup) => {
            const tableTopPos = this.currentTable.TableTopPos;
            diceCup.Mesh.position = new Vector3(tableTopPos.x, tableTopPos.y, tableTopPos.z);

            // 加入物理效果
            diceCup.Meshes.forEach((mesh: Mesh) => {
                this.physicsManager.removePhysics(mesh);
                this.physicsManager.addPhysics(mesh, PhysicsMotionType.STATIC, true);
            });
        };

        this.diceCup = new DiceCup(this.scene, afterInit);
    }

    /**
     * 建立骰子物件並放置於桌面中央
     */
    private _initDice() {
        const afterInit = (dice: Dice) => {
            const tableTopPos = this.currentTable.TableTopPos;
            const dicePosition = new Vector3(tableTopPos.x, tableTopPos.y + 1, tableTopPos.z);
            dice.Mesh.position = dicePosition;
            dice.Mesh.visibility = 0;

            // 加入物理效果
            this.physicsManager.removePhysics(dice.Mesh);
            this.physicsManager.addPhysics(dice.Mesh, PhysicsMotionType.DYNAMIC, false, 1, true);

            // 綁定 x 鍵讓骰子從 diceCup 高處落下（統一用 inputManager）
            this.inputDisposers.push(
                this.inputManager.registerActionMap(`dice.${dice.Uid}`, {
                    x: {
                        onPressed: () => {
                            if (dice && dice.Mesh.physicsBody) {
                                dice.Mesh.visibility = 1;

                                // 暫時移除物理效果
                                dice.Mesh.physicsBody.disablePreStep = false;

                                // 設定骰子的位置到骰盅的高處
                                const diceCupTop = this.diceCup.Mesh.position.y + 3; // 假設骰盅高度為 5
                                const newPosition = new Vector3(
                                    this.diceCup.Mesh.position.x,
                                    diceCupTop,
                                    this.diceCup.Mesh.position.z
                                );
                                dice.Mesh.position = newPosition;
                                dice.Mesh.physicsBody.transformNode.position = newPosition;

                                // 重新啟用物理效果，需要1幀的間隔
                                setTimeout(() => {
                                    dice && dice.Mesh.physicsBody && (dice.Mesh.physicsBody.disablePreStep = true);
                                }, 1);

                                // 添加隨機的線性速度和角速度，降低加速度大小
                                const randomLinear = new Vector3(
                                    (Math.random() - 0.5) * 1, // X方向
                                    -2, // Y方向（向下）
                                    (Math.random() - 0.5) * 1 // Z方向
                                );
                                const randomAngular = new Vector3(
                                    (Math.random() - 0.5) * 5,
                                    (Math.random() - 0.5) * 5,
                                    (Math.random() - 0.5) * 5
                                );

                                dice.Mesh.physicsBody.setLinearVelocity(randomLinear);
                                dice.Mesh.physicsBody.applyAngularImpulse(randomAngular);
                            } else {
                                console.warn('Dice or physicsBody is not available.');
                            }
                        },
                    },
                })
            );
        };

        // this.dice = new Dice(this.scene, 1, 0.25, afterInit);
        this.dice1 = new Dice(this.scene, 1, DICE_SCALE, afterInit);
        this.dice2 = new Dice(this.scene, 2, DICE_SCALE, afterInit);
    }

    /**
     * 初始化麻將物件
     */
    private _initMahjong() {
        this.mahjong = new Mahjong(this.scene, 1, (mahjong: Mahjong) => {
            const tableTopPos = this.currentTable.TableTopPos;
            const tablePos = this.currentTable.Mesh.position;
            mahjong.setDealStartPosition(new Vector3(tablePos.x, tableTopPos.y, tablePos.z));
            mahjong.MinY = tableTopPos.y + mahjong.getMeshThickness('dot', 1);
            this.inputDisposers.push(
                this.inputManager.registerActionMap('mahjong.deal', {
                    f: {
                        onPressed: () => {
                            this.dice1.Mesh.visibility = 0;
                            this.dice2.Mesh.visibility = 0;

                            mahjong.playDealAnimation(() => {
                                console.log('Deal animation finished');
                            });
                        },
                    },
                })
            );
        });
    }

    /**
     * 初始化多米諾骨牌物件
     */
    private _initDominoes() {
        this.dominoes = new Dominoes(this.scene, 1, (dominoes: Dominoes) => {
            const tableTopPos = this.currentTable.TableTopPos;
            const dominoMesh_0_0 = dominoes.getMeshByPoints(3, 4);
            const thickness = dominoes.getMeshThickness();
            dominoMesh_0_0 && dominoMesh_0_0.setEnabled(true);
            dominoMesh_0_0 && (dominoMesh_0_0.position = new Vector3(2, tableTopPos.y + thickness / 2, 3.25));
            console.log('dominoes', dominoMesh_0_0, thickness);
        });
    }

    /**
     * 初始化開發用相機（上帝視角）
     * @param canvas HTMLCanvasElement - 用於控制相機的畫布
     */
    private _initDevCamera(canvas: HTMLCanvasElement) {
        this.devCamera = new DevCamera(this.scene, canvas);
    }

    /**
     * 初始化 28 度角相機
     * @param canvas HTMLCanvasElement - 用於控制相機的畫布
     */
    private _initGame28gAngelCamera(canvas: HTMLCanvasElement) {
        this.game28gAngelCamera = new Game28gAngelCamera(this.scene, canvas);
        this.game28gAngelCamera.camera.position = new Vector3(0, 12, 0);

        this.guiSeatPlane = MeshBuilder.CreatePlane(
            'guiSeatPlane',
            { width: GUI_28G_PLANE_WIDTH, height: GUI_28G_PLANE_HEIGHT },
            this.scene
        );
        this.guiSeatPlane.scaling = new Vector3(GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE);
        this.guiSeatPlane.position = new Vector3(0, GUI_START_POS_Y + Z_INDEX.SEAT * GUI_PLANE_GAP, 0);

        this.guiDetailCardPlane = MeshBuilder.CreatePlane(
            'guiDetailCardPlane',
            { width: GUI_28G_PLANE_WIDTH, height: GUI_28G_PLANE_HEIGHT },
            this.scene
        );
        this.guiDetailCardPlane.scaling = new Vector3(GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE);
        this.guiDetailCardPlane.position = new Vector3(0, GUI_START_POS_Y + Z_INDEX.DETAIL_CARD * GUI_PLANE_GAP, 0); // 比guiSeatPlane稍微高一點，避免Z-fighting

        this.guiGrabBtnsPlane = MeshBuilder.CreatePlane(
            'guiGrabBtnsPlane',
            { width: GUI_28G_PLANE_WIDTH, height: GUI_28G_PLANE_HEIGHT },
            this.scene
        );
        this.guiGrabBtnsPlane.scaling = new Vector3(GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE, GUI_28G_PLANE_SCALE);
        this.guiGrabBtnsPlane.position = new Vector3(0, GUI_START_POS_Y + Z_INDEX.GRAB_BTNS * GUI_PLANE_GAP, 0); // 比guiDetailCardPlane稍微高一點，避免Z-fighting
    }

    /**
     * 初始化輸入管理器
     */
    private _initInputManager() {
        this.inputManager = new InputManager();
        this.inputManager.bindEvents();
    }

    /**
     * 初始化場景光源（半球光）
     */
    private _initLight() {
        const roomHeight = DefaultRoomConfig.bounds.height;
        new HLight(this.scene, new Vector3(0, roomHeight, 0)); // 建立環境光元件
        new DLight(this.scene, new Vector3(0, -roomHeight, 0)); // 建立定向光元件
        // new PLight(this.scene, new Vector3(0, roomHeight, 0)); // 建立點光源元件
    }

    private _buildStaticScene() {
        this.sceneBuilder.destroy(); // 確保沒有舊的靜態實例殘留
        this.sceneBuilder.init(); // 依配置重新建置房間與家具

        this.walls = [];

        this.roomModule = this.sceneBuilder.getRoomModule(); // 取得房間模組引用
        this.furnitureModule = this.sceneBuilder.getFurnitureModule(); // 取得家具模組引用

        if (this.roomModule) {
            const floor = this.roomModule.getFloor(); // 取回地板物件
            const ceiling = this.roomModule.getCeiling(); // 取回天花板物件
            this.walls = [...this.roomModule.getWalls()]; // 取得牆壁列表
            if (floor) {
                this.floor = floor;
            }
            if (ceiling) {
                this.ceiling = ceiling;
            }
        }

        if (this.furnitureModule) {
            const tables = this.furnitureModule.getTables(); // 所有賭桌設定
            const cylinder = tables.find((table) => table.kind === 'cylinder');
            const half = tables.find((table) => table.kind === 'halfCylinder');

            if (cylinder) {
                this.cylinderTable = cylinder.instance as CylinderTable;
                this.currentTable = this.cylinderTable;
            }

            if (half) {
                this.halfCylinderTable = half.instance as HalfCylinderTable;
            }

            if (!this.currentTable && this.halfCylinderTable) {
                this.currentTable = this.halfCylinderTable;
            }

            const chairs = this.furnitureModule.getChairs();
            if (chairs.length > 0) {
                this.chair = chairs[0].chair;
            }
        }
    }
    //#endregion

    //#region test function
    private async doFrameGraph() {
        // 在這裡執行每一幀的圖形處理

        const passPostProcess = new PassPostProcess('pass', 1, this.scene.activeCamera);

        passPostProcess.samples = 4;
        passPostProcess.resize(this.engine.getRenderWidth(), this.engine.getRenderHeight(), this.scene.activeCamera);

        const nrg = await NodeRenderGraph.ParseFromSnippetAsync('#FAPQIH#1', this.scene, {
            rebuildGraphOnEngineResize: false,
        });

        const frameGraph = nrg.frameGraph;

        passPostProcess.onSizeChangedObservable.add(() => {
            nrg.getInputBlocks()[0].value = passPostProcess.inputTexture.texture;
            nrg.build();
        });
        // console.log('PassPostProcess size changed', nrg.getInputBlocks()[0].value, nrg.getBlockByName('Texture'));
        nrg.getInputBlocks()[0].value = passPostProcess.inputTexture.texture;

        nrg.build();

        await nrg.whenReadyAsync();

        this.scene.onAfterRenderObservable.add(() => {
            frameGraph.execute();
        });
    }

    private async doNodeMaterial() {
        // 在這裡執行 NodeMaterial 的相關處理
        // 頭暈shader
        let nodeMaterial = await NodeMaterial.ParseFromFileAsync(
            'hypnosis',
            'https://piratejc.github.io/assets/hypnosis.json',
            this.scene
        );
        // this.table.Mesh.material = nodeMaterial;
        // this.floor.Mesh.material = nodeMaterial;
        this.dice1.Mesh.material = nodeMaterial;
        this.dice2.Mesh.material = nodeMaterial;
    }
    //#endregion
}
