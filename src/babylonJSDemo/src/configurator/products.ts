/**
 * 可切換的產品模型。
 *
 * 兩顆模型是刻意挑成互補的，用來證明這個配置器是 **model-agnostic**——
 * UI 不是寫死的一張表，是從模型結構長出來的：
 *
 * - `shoe`：單一 mesh、單一材質 → 面板只長出「整雙鞋」一個部件，「部件」那段自動隱藏。
 * - `chair`：fabric / wood / metal / label 四種材質各自獨立 → 面板長出四個部件，
 *   而且正好能同時展示三種表面細節（布配 Matte、木配 Leather、金屬配 Metallic）。
 *
 * 挑選過程實際下載了 Khronos 官方樣本裡九顆產品類模型逐一拆開比對。SheenChair 是
 * 唯一同時滿足四個條件的：**CC0**（其餘多為 CC BY）、**UV 完整覆蓋**（Phase 4 的
 * 表面細節才整顆都有效）、部件語意乾淨、體積只有現有鞋的一半。
 * ChronographWatch 的 12 個部件更漂亮，但 UV 只覆蓋 19 個 primitive 中的 8 個，
 * 表面細節在它身上是半殘的。授權見 res/models/CREDITS.md。
 */
export interface ProductDef {
    id: string;
    labelKey: string;
    /** webpack asset/resource 產出的 URL；模型不進 bundle，切到它時才 fetch */
    url: string;
    /**
     * 這顆模型的「正面」相對於機位表差幾弧度。
     *
     * CAMERA_VIEWS 的角度是照鞋子的朝向定的，但每顆 glb 在建模時面朝哪邊是作者
     * 各自決定的——椅子的正面就差了 90°，直接套機位表會拍到椅背。
     * **朝向是模型的屬性，不是機位的屬性**，所以修正值放在這裡而不是去改機位表。
     */
    alphaOffset?: number;
}

export const PRODUCTS: ProductDef[] = [
    { id: 'shoe', labelKey: 'cfg.product.shoe', url: require('../../res/models/shoe.glb') },
    {
        id: 'chair',
        labelKey: 'cfg.product.chair',
        url: require('../../res/models/SheenChair.glb'),
        alphaOffset: Math.PI / 2,
    },
];

export const DEFAULT_PRODUCT = 'shoe';

export function productById(id: string): ProductDef {
    return PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];
}
