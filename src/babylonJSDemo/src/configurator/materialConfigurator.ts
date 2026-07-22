import { AbstractMesh, BaseTexture, Color3, PBRMaterial, Vector3 } from '@babylonjs/core';
import type { SurfaceSet } from './surfaceDetail';

/**
 * 這裡所有的 `label` 都是 **i18n key**，不是要直接畫出來的字——UI 端一律 `t(label)`。
 *
 * 這樣寫是因為 `t()` 查不到 key 時原樣回傳 key（見 i18n/index.ts），所以
 * 「翻譯過的名稱」與「翻不了、只能拿 mesh 原名頂著」兩種情況可以共用同一個欄位，
 * 不必為了後者多開一個 fallback 欄位再到處判斷該用哪個。
 */

/** 一個可獨立配置材質的部件（單一 mesh 模型 = 一個「整雙」部件；分件模型 = 鞋面/鞋底/鞋帶…） */
export interface PartInfo {
    id: string;
    label: string;
}

/** 質感（finish）選項：以 PBR 參數組合模擬不同材質表面 */
export interface FinishInfo {
    id: string;
    label: string;
}

/** 顏色 tint 選項 */
export interface TintInfo {
    id: string;
    label: string;
    hex: string;
}

/** 質感預設：以 metallic / roughness / clearCoat 組合呈現不同材質表面 */
interface FinishPreset {
    label: string;
    metallic: number;
    roughness: number;
    clearCoat: number; // 0 = 關閉清漆層
    clearCoatRoughness?: number;
}

const FINISH_PRESETS: Record<string, FinishPreset> = {
    original: { label: 'cfg.finish.original', metallic: 0, roughness: 0, clearCoat: 0 }, // 還原模型原始材質（實際以快照還原）
    matte: { label: 'cfg.finish.matte', metallic: 0, roughness: 0.92, clearCoat: 0 },
    leather: { label: 'cfg.finish.leather', metallic: 0, roughness: 0.55, clearCoat: 0.18, clearCoatRoughness: 0.4 },
    glossy: { label: 'cfg.finish.glossy', metallic: 0, roughness: 0.14, clearCoat: 0.9, clearCoatRoughness: 0.05 },
    metallic: { label: 'cfg.finish.metallic', metallic: 1, roughness: 0.3, clearCoat: 0 },
};

const TINT_PALETTE: TintInfo[] = [
    { id: 'none', label: 'cfg.tint.none', hex: '' }, // 不上色，保留貼圖原色
    { id: 'crimson', label: 'cfg.tint.crimson', hex: '#b32134' },
    { id: 'cobalt', label: 'cfg.tint.cobalt', hex: '#27508f' },
    { id: 'forest', label: 'cfg.tint.forest', hex: '#2f6d4f' },
    { id: 'amber', label: 'cfg.tint.amber', hex: '#c8922f' },
    { id: 'charcoal', label: 'cfg.tint.charcoal', hex: '#33363d' },
    { id: 'ivory', label: 'cfg.tint.ivory', hex: '#dcd6c8' },
];

/**
 * 從材質／mesh 名稱推測部件名稱。
 *
 * 上半是通用材質詞（任何產品都可能出現），下半是鞋類專有詞。**順序有意義**：
 * 由上往下第一個命中的就採用，所以 `leather` 這種同時是材質也是質感的詞放在通用區。
 * 認不出來也沒關係，會退回材質名本身（見 _friendlyLabel）。
 */
const PART_KEYWORDS: { kw: string; label: string }[] = [
    { kw: 'fabric', label: 'cfg.part.fabric' },
    { kw: 'cloth', label: 'cfg.part.fabric' },
    { kw: 'wood', label: 'cfg.part.wood' },
    { kw: 'metal', label: 'cfg.part.metal' },
    { kw: 'glass', label: 'cfg.part.glass' },
    { kw: 'plastic', label: 'cfg.part.plastic' },
    { kw: 'label', label: 'cfg.part.label' },
    { kw: 'leather', label: 'cfg.part.leather' },
    { kw: 'outsole', label: 'cfg.part.outsole' },
    { kw: 'midsole', label: 'cfg.part.midsole' },
    { kw: 'sole', label: 'cfg.part.sole' },
    { kw: 'lace', label: 'cfg.part.lace' },
    { kw: 'tongue', label: 'cfg.part.tongue' },
    { kw: 'upper', label: 'cfg.part.upper' },
    { kw: 'toe', label: 'cfg.part.toe' },
    { kw: 'heel', label: 'cfg.part.heel' },
    { kw: 'collar', label: 'cfg.part.collar' },
    { kw: 'logo', label: 'cfg.part.logo' },
];

/** 還原用的材質原始參數快照 */
interface OriginalParams {
    metallic: number | null;
    roughness: number | null;
    microSurface: number;
    clearCoatEnabled: boolean;
    clearCoatIntensity: number;
    clearCoatRoughness: number;
    albedoColor: Color3;
    /**
     * 模型自己帶的法線 / ORM 貼圖。也要記——表面細節會覆寫這兩個槽，
     * 而 `original` finish 的意思是「還原成模型原本的樣子」，
     * 只把它們設成 null 的話，原本就有法線貼圖的模型會被我們洗掉。
     */
    bumpTexture: BaseTexture | null;
    metallicTexture: BaseTexture | null;
    useRoughnessFromMetallicTextureGreen: boolean;
    useMetallnessFromMetallicTextureBlue: boolean;
}

interface Part extends PartInfo {
    meshes: AbstractMesh[];
    finishId: string;
    tintId: string;
    /** 目前掛著的表面細節貼圖（null = 這個 finish 沒有表面細節） */
    surface?: SurfaceSet | null;
}

/**
 * 材質配置器（model-agnostic）
 * @description 掃描載入模型的 sub-mesh 自動建立可配置部件：
 * 多個部件 → 各自獨立配置（鞋面 / 鞋底 / 鞋帶…）；單一 mesh → 一個「整雙」部件。
 * 每個部件可套用 finish 質感 preset（roughness / metallic / clearCoat）與顏色 tint。
 * 切換 colorway 變體後，呼叫 reapplyAll() 即可把使用者的選擇重新疊回新材質上。
 */
export class MaterialConfigurator {
    private parts: Part[] = [];
    private originalParams = new Map<number, OriginalParams>();

    constructor(productRoot: AbstractMesh) {
        this._collectParts(productRoot);
    }

    /**
     * 掃描階層內所有具幾何的 mesh，**依材質分組**成部件。
     *
     * 早期是「一個 mesh 一個部件」，換上真正分件的模型後才發現那樣會長歪：
     * 同一張椅子的木頭可能拆成十一個 mesh，卻只有一種木頭材質，面板就長出十一顆
     * 按鈕、其中一堆調的是同一件事。**使用者心裡的「部件」是材質，不是 mesh。**
     *
     * 分組鍵用材質名稱而非材質物件：colorway 變體會整套抽換材質物件，但分組是載入
     * 當下算好就固定的（part.meshes 不變），所以用什麼當鍵其實只影響命名——
     * 用名稱的好處是它同時就是現成的部件標籤來源。
     */
    private _collectParts(root: AbstractMesh) {
        const meshes = [root, ...root.getChildMeshes()].filter((m) => m.getTotalVertices() > 0);

        const groups = new Map<string, AbstractMesh[]>();
        for (const m of meshes) {
            // 沒有材質名可分的，各自成組（退回舊行為，總比全部併成一組好）
            const key = m.material?.name || `#${m.uniqueId}`;
            const list = groups.get(key);
            if (list) list.push(m);
            else groups.set(key, [m]);
        }

        if (groups.size <= 1) {
            // 單一材質：整件作為唯一部件，UI 會把「部件」那段整段隱藏
            this.parts = [
                { id: 'whole', label: 'cfg.part.whole', meshes, finishId: 'original', tintId: 'none' },
            ];
            return;
        }

        this.parts = this._dropTinyParts(root, [...groups.entries()]).map(([matName, group], i) => ({
            id: `part_${i}`,
            label: this._friendlyLabel(matName, group[0].name, i),
            meshes: group,
            finishId: 'original',
            tintId: 'none',
        }));
    }

    /**
     * 濾掉小到看不出來的部件。
     *
     * 分件模型常帶著品牌標籤、螺絲、內襯這類配件，它們在面板上會佔一顆按鈕，
     * 但使用者按下去根本看不出哪裡變了——**能配置卻看不到效果的選項，比沒有更糟**。
     *
     * 用包圍盒體積佔比而不是寫死排除 `label` 這種名字，是為了讓它對任何模型都成立。
     * 門檻 1% 是量出來的：SheenChair 的四個部件依序是 67% / 83% / 48.5% / **0.24%**，
     * 中間隔了三個數量級，怎麼切都不會誤傷。
     *
     * 保底：若濾完剩不到兩個部件（整顆模型都是碎件），就全部保留——寧可面板長一點，
     * 也不要把一個分件模型呈現成沒有部件可調。
     */
    private _dropTinyParts(root: AbstractMesh, groups: [string, AbstractMesh[]][]): [string, AbstractMesh[]][] {
        const volumeOf = (list: AbstractMesh[]): number => {
            let min: Vector3 | null = null;
            let max: Vector3 | null = null;
            for (const m of list) {
                const b = m.getHierarchyBoundingVectors(true);
                min = min ? Vector3.Minimize(min, b.min) : b.min.clone();
                max = max ? Vector3.Maximize(max, b.max) : b.max.clone();
            }
            if (!min || !max) return 0;
            const s = max.subtract(min);
            return s.x * s.y * s.z;
        };

        const rootVol = volumeOf([root]);
        if (rootVol <= 0) return groups;

        const kept = groups.filter(([, list]) => volumeOf(list) / rootVol >= 0.01);
        return kept.length >= 2 ? kept : groups;
    }

    /**
     * 部件標籤：先看材質名、再看 mesh 名，都認不出來就拿材質名原樣頂著。
     *
     * **材質名優先**是因為分件模型的材質幾乎都取得很語意化（`fabric Mystere Mango
     * Velvet`、`wood Brown`、`metal`），而 mesh 名常常是 `Object_12` 這種。
     * 關鍵字表退成備援——它原本只有鞋類詞彙，換一顆椅子就全部落空。
     *
     * 回傳的是 i18n key；認不出來時回傳的原字串會被 `t()` 的
     * 「查無此 key 就原樣輸出」接住（見檔頭說明）。
     */
    private _friendlyLabel(materialName: string, meshName: string, index: number): string {
        for (const source of [materialName, meshName]) {
            const lower = source.toLowerCase();
            const hit = PART_KEYWORDS.find((k) => lower.includes(k.kw));
            if (hit) return hit.label;
        }
        const cleaned = materialName.replace(/[_.]/g, ' ').trim();
        return cleaned.length > 0 && !cleaned.startsWith('#') ? cleaned : `Part ${index + 1}`;
    }

    /** 供 UI 建立部件選擇器；單一部件時 UI 可隱藏此列 */
    public getParts(): PartInfo[] {
        return this.parts.map(({ id, label }) => ({ id, label }));
    }

    public getFinishes(): FinishInfo[] {
        return Object.entries(FINISH_PRESETS).map(([id, p]) => ({ id, label: p.label }));
    }

    public getTints(): TintInfo[] {
        return TINT_PALETTE;
    }

    /** 套用 finish 質感到指定部件 */
    public applyFinish(partId: string, finishId: string) {
        const part = this.parts.find((p) => p.id === partId);
        if (!part || !FINISH_PRESETS[finishId]) return;
        part.finishId = finishId;
        this._forEachPbr(part, (mat) => this._applyFinishToMat(mat, finishId));
    }

    /** 套用顏色 tint 到指定部件 */
    public applyTint(partId: string, tintId: string) {
        const part = this.parts.find((p) => p.id === partId);
        if (!part) return;
        const tint = TINT_PALETTE.find((t) => t.id === tintId);
        if (!tint) return;
        part.tintId = tintId;
        this._forEachPbr(part, (mat) => this._applyTintToMat(mat, tint.hex || null));
    }

    /**
     * 把所有部件目前的 finish 與 tint 重新疊回現有材質
     * @description colorway 變體切換會整套抽換材質，切換後呼叫此方法即可保留使用者的質感/顏色選擇。
     */
    public reapplyAll() {
        this.parts.forEach((part) => {
            this._forEachPbr(part, (mat) => {
                this._applyFinishToMat(mat, part.finishId);
                const tint = TINT_PALETTE.find((t) => t.id === part.tintId);
                this._applyTintToMat(mat, tint?.hex || null);
            });
        });
    }

    private _forEachPbr(part: Part, fn: (mat: PBRMaterial) => void) {
        part.meshes.forEach((mesh) => {
            const mat = mesh.material;
            if (mat instanceof PBRMaterial) fn(mat);
        });
    }

    private _applyFinishToMat(mat: PBRMaterial, finishId: string) {
        this._captureOriginal(mat);
        const orig = this.originalParams.get(mat.uniqueId)!;

        if (finishId === 'original') {
            mat.metallic = orig.metallic;
            mat.roughness = orig.roughness;
            mat.microSurface = orig.microSurface;
            mat.clearCoat.isEnabled = orig.clearCoatEnabled;
            mat.clearCoat.intensity = orig.clearCoatIntensity;
            mat.clearCoat.roughness = orig.clearCoatRoughness;
            return;
        }

        const f = FINISH_PRESETS[finishId];
        // 改用 metallic-roughness 工作流，讓 roughness 確實生效（原模型為 spec-gloss）
        mat.metallic = f.metallic;
        mat.roughness = f.roughness;
        mat.clearCoat.isEnabled = f.clearCoat > 0;
        mat.clearCoat.intensity = f.clearCoat;
        mat.clearCoat.roughness = f.clearCoatRoughness ?? 0.1;
    }

    private _applyTintToMat(mat: PBRMaterial, hex: string | null) {
        this._captureOriginal(mat);
        const orig = this.originalParams.get(mat.uniqueId)!;
        mat.albedoColor = hex ? Color3.FromHexString(hex) : orig.albedoColor.clone();
    }

    /** 第一次接觸材質時，記錄其原始參數以供還原 */
    private _captureOriginal(mat: PBRMaterial) {
        if (this.originalParams.has(mat.uniqueId)) return;
        this.originalParams.set(mat.uniqueId, {
            metallic: mat.metallic,
            roughness: mat.roughness,
            microSurface: mat.microSurface,
            clearCoatEnabled: mat.clearCoat.isEnabled,
            clearCoatIntensity: mat.clearCoat.intensity,
            clearCoatRoughness: mat.clearCoat.roughness,
            albedoColor: mat.albedoColor.clone(),
            bumpTexture: mat.bumpTexture,
            metallicTexture: mat.metallicTexture,
            useRoughnessFromMetallicTextureGreen: mat.useRoughnessFromMetallicTextureGreen,
            useMetallnessFromMetallicTextureBlue: mat.useMetallnessFromMetallicTextureBlue,
        });
    }

    /**
     * 掛上（或拿掉）表面細節貼圖。
     *
     * `set` 為 null 代表這個 finish 沒有表面細節，還原成模型自己帶的那兩張貼圖。
     *
     * 粗糙度走 `metallicTexture` 的 **green channel** 是 glTF 的 ORM 慣例。
     * 但要同時關掉 `useMetallnessFromMetallicTextureBlue`——我們的粗糙度圖是灰階，
     * blue 裡放的還是粗糙度值，被當成金屬度讀的話，霧面布料會整片變成金屬。
     *
     * tiling 與凹凸強度設在 texture 實例上而不是材質上，所以所有部件共用同一組值——
     * 這是刻意的：那兩條滑桿講的是「這塊布料本身多細」，不是「這個部件多細」。
     */
    public applySurface(partId: string, set: SurfaceSet | null, tiling: number, bump: number) {
        const part = this.parts.find((p) => p.id === partId);
        if (!part) return;
        part.surface = set;

        this._forEachPbr(part, (mat) => {
            this._captureOriginal(mat);
            const orig = this.originalParams.get(mat.uniqueId)!;

            if (!set) {
                mat.bumpTexture = orig.bumpTexture;
                mat.metallicTexture = orig.metallicTexture;
                mat.useRoughnessFromMetallicTextureGreen = orig.useRoughnessFromMetallicTextureGreen;
                mat.useMetallnessFromMetallicTextureBlue = orig.useMetallnessFromMetallicTextureBlue;
                return;
            }

            set.normal.uScale = set.normal.vScale = tiling;
            set.rough.uScale = set.rough.vScale = tiling;
            set.normal.level = bump;

            mat.bumpTexture = set.normal;
            mat.metallicTexture = set.rough;
            mat.useRoughnessFromMetallicTextureGreen = true;
            mat.useRoughnessFromMetallicTextureAlpha = false;
            mat.useMetallnessFromMetallicTextureBlue = false;
        });
    }

    /**
     * 把表面貼圖從所有材質上卸下，還原成模型自己帶的那些。
     *
     * **模型被 dispose 前一定要先呼叫**：`dispose(false, true)` 會連材質上掛著的
     * 貼圖一起銷毀，而表面貼圖是 surfaceDetail 那份跨模型共用的快取——被順手清掉
     * 之後，快取裡留下的是已銷毀的殭屍物件，切回這顆模型就會拿它去貼。
     */
    public detachSurfaces() {
        for (const part of this.parts) this.applySurface(part.id, null, 1, 1);
    }

    /** 只調整已掛上的表面貼圖參數（滑桿拖動時走這條，不必重新準備貼圖） */
    public tuneSurface(tiling: number, bump: number) {
        for (const part of this.parts) {
            if (!part.surface) continue;
            part.surface.normal.uScale = part.surface.normal.vScale = tiling;
            part.surface.rough.uScale = part.surface.rough.vScale = tiling;
            part.surface.normal.level = bump;
        }
    }
}
