# 產品模型來源

兩顆模型都來自 [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)。

## shoe.glb — Materials Variants Shoe

© 2021 **Shopify**，授權 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode)。
原始資產：[MaterialsVariantsShoe](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MaterialsVariantsShoe)

**CC BY 要求署名**，這份檔案就是履行該義務。單一 mesh、單一材質，內建三組
`KHR_materials_variants` colorway（midnight / beach / street）。

## SheenChair.glb — Sheen Chair

© 2020 **Wayfair, LLC**（模型與貼圖：Eric Chadwick），授權
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/legalcode)（公眾領域，免署名）。
原始資產：[SheenChair](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair)

四種材質（fabric / wood / metal / label）各自獨立、UV 完整覆蓋、內建兩組變體。
選它的理由見 `src/babylonJSDemo/src/configurator/products.ts`。

## 檔案怎麼載入

兩顆 glb 都經 webpack 的 `asset/resource` 產出成獨立檔案，**不會打進 bundle**——
`SceneLoader.ImportMeshAsync` 在使用者真的切到該模型時才去 fetch，所以多放一顆
模型不會拖慢首次載入，只增加 `dist` 的體積（與 gh-pages 的推送量，見 README）。
