import { Scene, Mesh, Vector3, Animation, AnimationGroup } from '@babylonjs/core';
import ModelManager from '../../managers/modelsManager';
import { ModelPack } from '../../constants/assets';

const DEALCARD_START_POS_X = 0;
const DEALCARD_START_POS_Z = -3;
const DEAL_DELAY = 250;

/**
 * 麻將物件
 * @param scene Babylon.js 場景
 * @param position 麻將初始位置
 * 一種麻將會有四張，總共是一筒~九筒+白板，10種，共40張
 */
export class Mahjong {
    private scene: Scene;
    private uid: number;
    private minY: number;

    private modelManager: ModelManager;
    private modelName: string = 'mahjong';

    private meshes: { [key: string]: Mesh[] } = {};

    private dealStartPosition: Vector3 = new Vector3(DEALCARD_START_POS_X, 0, DEALCARD_START_POS_Z);
    private playerCount: number = 4;
    private round: number = 0;
    private unDealedMjs: Mesh[] = [];
    private dealingMjs: { [seat: string]: Mesh[] } = {};
    private dealedMjs: { [round: string]: Mesh[] } = {};

    constructor(scene: Scene, uid: number, callback: Function) {
        this.scene = scene;
        this.uid = uid;
        this.round = 0;
        this.modelManager = ModelManager.getInstance(scene);
        this.loadModel(callback);
    }

    //#region load model
    private async loadModel(callback: Function) {
        const cloneModel = await this.modelManager.prepareMultiModels(this.scene, this.modelName, 'mahjong');

        if (cloneModel && cloneModel.cloneMeshes && cloneModel.cloneMeshes.length > 0) {
            this.afterLoaded(cloneModel);

            // const thickness = this.getMeshThickness('dot', 1);
            // const cols = 7;
            // const gapX = 0.5;
            // const gapZ = 0.5;
            // const startX = -1.5;
            // const startZ = 1.5;
            // Object.keys(this.meshes).forEach((key, i) => {
            //     const mesh = this.meshes[key];
            //     if (mesh) {
            //         const row = Math.floor(i / cols);
            //         const col = i % cols;
            //         mesh[0].position = new Vector3(startX + col * gapX, 4 + thickness / 2, startZ + row * gapZ);
            //         mesh[1].position = new Vector3(startX + col * gapX, 4 + thickness / 2, startZ + row * gapZ);
            //     }
            // });
        }
        callback(this);
    }

    private afterLoaded(cloneModel: any) {
        let tmpArr: { [key: string]: Mesh[] } = {};
        // 將相同上下點的 Mesh 分組
        for (let i = 0; i < cloneModel.cloneMeshes.length; i++) {
            const mesh = cloneModel.cloneMeshes[i];
            const name: string = mesh.name; // ex. zzz_Mahjong_root_dot_2_primitive0
            const type = name.split('_')[4];
            const points = name.split('_')[5];

            if (tmpArr[`${type}_${points}`] === undefined) tmpArr[`${type}_${points}`] = [];
            tmpArr[`${type}_${points}`].push(mesh);

            const scale = 1;
            mesh.scaling = new Vector3(-scale, scale, scale);
        }

        // 合併 Mesh
        Object.keys(tmpArr).forEach((key) => {
            const bindMesh = Mesh.MergeMeshes(tmpArr[key], true, true, undefined, true, true);
            if (!this.meshes[key]) this.meshes[key] = [];

            if (bindMesh) {
                bindMesh.name = 'mahjong_' + key + '_0';
                bindMesh.id = 'mahjong_' + key + '_0';
                bindMesh.setEnabled(false);
                const scale = 0.45;
                bindMesh.scaling = new Vector3(scale, scale, scale);
                bindMesh.rotation = new Vector3(0, 0, Math.PI);
                this.meshes[key].push(bindMesh);
                this.unDealedMjs.push(bindMesh);

                for (let i = 1; i < 4; i++) {
                    const cloneMesh = bindMesh.clone('mahjong_' + key + '_' + i);
                    cloneMesh.id = 'mahjong_' + key + '_' + i;
                    this.meshes[key].push(cloneMesh);
                    this.unDealedMjs.push(cloneMesh);
                }
            }
        });
    }
    //#endregion

    //#region animation
    /**
     * 播放翻轉動畫
     * @param mj 麻將 Mesh
     */
    public playFlip(mj: Mesh, callback?: Function): void {
        const scene = this.scene;
        const beginPosY = mj.position.y;
        const thickness = this.getMeshThickness('dot', 1);

        // 初始狀態：強制翻到牌背
        // mj.rotation = new Vector3(0, 0, Math.PI);

        // 動畫參數
        const frameRate = 30;
        const totalFrames = 6;

        // 創建動畫
        const rotationAnimation = new Animation(
            'flipRotation',
            'rotation.z',
            frameRate,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        const positionAnimation = new Animation(
            'flipPosition',
            'position.y',
            frameRate,
            Animation.ANIMATIONTYPE_FLOAT,
            Animation.ANIMATIONLOOPMODE_CONSTANT
        );

        // 設置旋轉動畫的關鍵幀
        const rotationKeys = [
            { frame: 0, value: Math.PI }, // 背面
            { frame: totalFrames / 2, value: Math.PI / 2 }, // 側面
            { frame: totalFrames, value: 0 }, // 正面
        ];
        rotationAnimation.setKeys(rotationKeys);

        // 設置位置動畫的關鍵幀（高度起伏）
        const positionKeys = [
            { frame: 0, value: beginPosY }, // 起始高度
            { frame: totalFrames / 4, value: beginPosY + thickness }, // 上升
            { frame: (3 * totalFrames) / 4, value: beginPosY + thickness }, // 保持高度
            { frame: totalFrames, value: beginPosY }, // 回到桌面高度
        ];
        positionAnimation.setKeys(positionKeys);

        // 將動畫附加到麻將 Mesh
        mj.animations = [rotationAnimation, positionAnimation];

        // 播放動畫
        scene.beginAnimation(mj, 0, totalFrames, false, 1.0, () => {
            callback && callback();
        });
    }

    /**
     * 從40張牌隨機抽八張麻將，表演發牌動畫，完成後呼叫 callback
     * 發牌到固定的四個位置，每次同時發兩張
     */
    public playDealAnimation(callback: Function) {
        if (this.round > 4) {
            console.error('已達到最大發牌輪數');
            return;
        }
        this.round++;

        const startPos = new Vector3(this.dealStartPosition.x, this.minY, this.dealStartPosition.z);
        const thickness = this.getMeshThickness('dot', 1);
        const dealPositions = [
            new Vector3(this.dealStartPosition.x - 2.1, this.minY, this.dealStartPosition.z), // 玩家1位置
            new Vector3(this.dealStartPosition.x + 0.15, this.minY, this.dealStartPosition.z - 1.15), // 玩家2位置
            new Vector3(this.dealStartPosition.x + 1.7, this.minY, this.dealStartPosition.z), // 玩家3位置
            new Vector3(this.dealStartPosition.x + 0.15, this.minY, this.dealStartPosition.z + 1.35), // 玩家4位置
        ];

        // 隱藏已發的麻將
        for (const round in this.dealedMjs) {
            this.dealedMjs[round].forEach((mesh) => {
                mesh.setEnabled(false);
            });
        }

        // 抽取八張麻將
        const allMeshes = this.unDealedMjs;
        const selectedMeshes = allMeshes.sort(() => Math.random() - 0.5).slice(0, 8);

        // 抽出的麻將從未發牌列表移除，並且兩兩一組加入發牌中列表
        for (const mesh of selectedMeshes) {
            const index = this.unDealedMjs.indexOf(mesh);
            if (index > -1) {
                this.unDealedMjs.splice(index, 1);
            }

            if (!this.dealingMjs[`seat_${selectedMeshes.indexOf(mesh) % this.playerCount}`])
                this.dealingMjs[`seat_${selectedMeshes.indexOf(mesh) % this.playerCount}`] = [];

            this.dealingMjs[`seat_${selectedMeshes.indexOf(mesh) % this.playerCount}`].push(mesh);
        }

        console.log('undeal mjs: ', this.unDealedMjs);
        console.log('dealing mjs: ', this.dealingMjs);

        // 準備發牌前，發牌中列表中的麻將每一組中兩張牌堆疊擺放，並且每組依照目標坐位順序由左至右排列，所以顯示上會是 2222
        for (const seat in this.dealingMjs) {
            const mj1 = this.dealingMjs[seat][0];
            const mj2 = this.dealingMjs[seat][1];

            const whichSeat = Number(seat.split('_')[1]);
            const offsetSeat = this.getMeshWidth('dot', 1) * (whichSeat - 2);
            const offsetY = thickness; // 兩張牌的堆疊高度差
            if (mj1 && mj2) {
                mj1.position = new Vector3(startPos.x + offsetSeat, startPos.y, startPos.z);
                mj1.rotation.z = Math.PI;
                mj2.position = new Vector3(startPos.x + offsetSeat, startPos.y + offsetY, startPos.z);
                mj2.rotation.z = Math.PI;
                mj1.setEnabled(true);
                mj2.setEnabled(true);
            }
        }

        // 動畫參數
        const frameRate = 30;
        const totalFrames = 6;

        // 發牌表演，發牌中列表中的麻將依照組次序兩兩同時發出，發到目標座位座標後，位於上方的那張牌移動到下方那張牌的右側貼齊
        Object.keys(this.dealingMjs).forEach((seat, index) => {
            const mj1 = this.dealingMjs[seat][0];
            const mj2 = this.dealingMjs[seat][1];
            const whichSeat = Number(seat.split('_')[1]);
            const targetPos = dealPositions[whichSeat];
            const offsetX = this.getMeshWidth('dot', 1); // 兩張牌的水平間距

            if (mj1 && mj2) {
                // 創建動畫
                const positionAnimationMj1 = new Animation(
                    'dealPosition1',
                    'position',
                    frameRate,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CONSTANT
                );
                const positionAnimationMj2 = new Animation(
                    'dealPosition2',
                    'position',
                    frameRate,
                    Animation.ANIMATIONTYPE_VECTOR3,
                    Animation.ANIMATIONLOOPMODE_CONSTANT
                );

                // 設置位置動畫的關鍵幀
                const mj1StartPos = mj1.position.clone();
                const positionKeysMj1 = [
                    { frame: 0, value: mj1StartPos }, // 起始位置
                    { frame: totalFrames, value: new Vector3(targetPos.x, mj1StartPos.y, targetPos.z) },
                ];
                positionAnimationMj1.setKeys(positionKeysMj1);

                const mj2StartPos = mj2.position.clone();
                const positionKeysMj2 = [
                    { frame: 0, value: mj2StartPos }, // 起始位置
                    { frame: totalFrames, value: new Vector3(targetPos.x, mj2StartPos.y, targetPos.z) }, // 目標位置
                    { frame: totalFrames + 4, value: new Vector3(targetPos.x + offsetX, mj2StartPos.y, targetPos.z) }, // 移動到右側
                    { frame: totalFrames + 8, value: new Vector3(targetPos.x + offsetX, mj1StartPos.y, targetPos.z) }, // 移動到桌面
                ];
                positionAnimationMj2.setKeys(positionKeysMj2);

                // 將動畫附加到麻將 Mesh
                mj1.animations = [positionAnimationMj1];
                mj2.animations = [positionAnimationMj2];

                // 使用 setTimeout 控制每組動畫的啟動時間間隔
                setTimeout(() => {
                    this.scene.beginAnimation(mj1, 0, totalFrames);
                    this.scene.beginAnimation(mj2, 0, totalFrames + 8, false, 1.0, () => {
                        this.playFlip(mj1, () => {
                            this.playFlip(mj2);
                        });
                        // 動畫完成後，將發牌中列表中的麻將加入已發牌列表，並且清空發牌中列表
                        if (!this.dealedMjs[`round_${this.round}`]) this.dealedMjs[`round_${this.round}`] = [];
                        this.dealedMjs[`round_${this.round}`].push(mj1, mj2);
                        delete this.dealingMjs[seat];

                        // 如果是最後一組，執行 callback
                        if (index === Object.keys(this.dealingMjs).length - 1) {
                            callback();
                        }
                    });
                }, index * DEAL_DELAY); // 每組間隔 500ms
            }
        });
    }
    //#endregion

    //#region getter/setter
    /**
     * 取得麻將 Mesh
     */
    public get Meshes() {
        return this.meshes;
    }

    /**
     * 取得麻將 Mesh 的最小 Y 值
     */
    public get MinY(): number {
        return this.minY;
    }

    /**
     * 設定麻將 Mesh 的最小 Y 值，通常是桌上
     */
    public set MinY(value: number) {
        this.minY = value;
    }

    /**
     * 設定發牌起始位置
     */
    public setDealStartPosition(position: Vector3) {
        this.dealStartPosition = position;
    }

    /**
     * 取得指定點數的麻將 Mesh, 白板為 white_0
     */
    public getMeshByPoints(type: string, points: number): Mesh | null {
        const key = `${type}_${points}`;
        if (!this.meshes[key]) {
            console.warn('Mahjong getMeshByPoints not exist:', key);
            return null;
        } else return this.meshes[key][0];
    }

    /**
     * 取得一個牌的 Mesh 厚度
     */
    public getMeshThickness(type: string, points: number): number {
        const mesh = this.getMeshByPoints(type, points);
        if (mesh) {
            const max = mesh.getBoundingInfo().boundingBox.maximum.y;
            const min = mesh.getBoundingInfo().boundingBox.minimum.y;
            const scale = mesh.scaling.y;
            return (max - min) * scale;
        }
        return 0;
    }

    /**
     * 取得一個牌的 Mesh 寬度
     */
    public getMeshWidth(type: string, points: number): number {
        const mesh = this.getMeshByPoints(type, points);
        if (mesh) {
            const max = mesh.getBoundingInfo().boundingBox.maximum.x;
            const min = mesh.getBoundingInfo().boundingBox.minimum.x;
            const scale = mesh.scaling.x;
            return (max - min) * scale;
        }
        return 0;
    }
    //#endregion
}
