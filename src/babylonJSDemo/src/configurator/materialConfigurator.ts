import { AbstractMesh, Color3, PBRMaterial } from '@babylonjs/core';

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
    original: { label: 'Original', metallic: 0, roughness: 0, clearCoat: 0 }, // 還原模型原始材質（實際以快照還原）
    matte: { label: 'Matte', metallic: 0, roughness: 0.92, clearCoat: 0 },
    leather: { label: 'Leather', metallic: 0, roughness: 0.55, clearCoat: 0.18, clearCoatRoughness: 0.4 },
    glossy: { label: 'Glossy', metallic: 0, roughness: 0.14, clearCoat: 0.9, clearCoatRoughness: 0.05 },
    metallic: { label: 'Metallic', metallic: 1, roughness: 0.3, clearCoat: 0 },
};

const TINT_PALETTE: TintInfo[] = [
    { id: 'none', label: 'Original', hex: '' }, // 不上色，保留貼圖原色
    { id: 'crimson', label: 'Crimson', hex: '#b32134' },
    { id: 'cobalt', label: 'Cobalt', hex: '#27508f' },
    { id: 'forest', label: 'Forest', hex: '#2f6d4f' },
    { id: 'amber', label: 'Amber', hex: '#c8922f' },
    { id: 'charcoal', label: 'Charcoal', hex: '#33363d' },
    { id: 'ivory', label: 'Ivory', hex: '#dcd6c8' },
];

// 依 mesh 名稱關鍵字推測友善部件名稱
const PART_KEYWORDS: { kw: string; label: string }[] = [
    { kw: 'outsole', label: '鞋底' },
    { kw: 'midsole', label: '中底' },
    { kw: 'sole', label: '鞋底' },
    { kw: 'lace', label: '鞋帶' },
    { kw: 'tongue', label: '鞋舌' },
    { kw: 'upper', label: '鞋面' },
    { kw: 'toe', label: '鞋頭' },
    { kw: 'heel', label: '鞋跟' },
    { kw: 'collar', label: '鞋口' },
    { kw: 'logo', label: 'Logo' },
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
}

interface Part extends PartInfo {
    meshes: AbstractMesh[];
    finishId: string;
    tintId: string;
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

    /** 掃描階層內所有具幾何的 mesh，建立部件清單 */
    private _collectParts(root: AbstractMesh) {
        const meshes = [root, ...root.getChildMeshes()].filter((m) => m.getTotalVertices() > 0);

        if (meshes.length <= 1) {
            // 單一 mesh：整雙鞋作為唯一部件
            this.parts = [
                { id: 'whole', label: '整雙鞋', meshes, finishId: 'original', tintId: 'none' },
            ];
            return;
        }

        // 多部件：每個 mesh 一個部件，推測友善名稱
        this.parts = meshes.map((m, i) => ({
            id: `part_${i}`,
            label: this._friendlyLabel(m.name, i),
            meshes: [m],
            finishId: 'original',
            tintId: 'none',
        }));
    }

    private _friendlyLabel(name: string, index: number): string {
        const lower = name.toLowerCase();
        const hit = PART_KEYWORDS.find((k) => lower.includes(k.kw));
        if (hit) return hit.label;
        const cleaned = name.replace(/[_.]/g, ' ').trim();
        return cleaned.length > 0 ? cleaned : `部件 ${index + 1}`;
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
        });
    }
}
