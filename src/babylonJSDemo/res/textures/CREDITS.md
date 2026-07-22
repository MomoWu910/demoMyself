# 表面細節貼圖來源

全部來自 [ambientCG](https://ambientcg.com)，授權 **CC0 1.0 Universal**（公眾領域）：
可自由複製、修改、散布，含商業用途，**無需署名**。此檔僅為留存出處，不是授權要求。
授權原文：<https://docs.ambientcg.com/license/>

| 檔案 | 原始資產 | 用途 |
|---|---|---|
| `fabric_normal.jpg` / `fabric_rough.jpg` | [Fabric019](https://ambientcg.com/view?id=Fabric019) | finish = Matte |
| `leather_normal.jpg` / `leather_rough.jpg` | [Leather011](https://ambientcg.com/view?id=Leather011) | finish = Leather |
| `metal_normal.jpg` / `metal_rough.jpg` | [Metal009](https://ambientcg.com/view?id=Metal009) | finish = Metallic |

## 處理方式

原始下載為 1K-JPG 包，取其中的 `_NormalGL`（OpenGL 慣例，Babylon 用這個，**不是** `_NormalDX`）
與 `_Roughness` 兩張，縮到 512px、JPEG 品質 78：

```
sips -s format jpeg -s formatOptions 78 -Z 512 <src> --out <dst>
```

六張合計約 430 KB。**尺寸是刻意壓的**：這頁的重點是「shader 生成 vs 掃描貼圖」的
成本對照，而配置器已經帶著 7.8 MB 的 shoe.glb，貼圖再肥下去 gh-pages 會 push 不上去
（見專案 README 的 deploy 註記）。512px 在 Detail 近拍機位仍看得出材質差異。
