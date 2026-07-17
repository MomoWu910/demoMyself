import { Container, Sprite } from 'pixi.js';
import type { Application, Container as PixiContainer, Texture } from 'pixi.js';
import type { BenchCase } from '../../bench';
import { EFFECTS, defaultValues, getEffect, type EffectInstance } from '../effects';
import { createChromaticFilter } from '../effects/chromatic';

/**
 * 把 Shader Lab 的每個效果編成一組 benchmark 案例，餵給 bench/BenchRunner。
 *
 * 三種問法（對應成本卡上三個要回答的問題）：
 *
 * 1. **結構成本**：baseline（純 sprite）vs effect ×1。差在 draw call——filter 會把
 *    物件踢出合批、獨立成 render pass；mesh 材質則不會。這一欄 WebGL 精確、WebGPU 標 n/a。
 * 2. **GPU 相對成本**：把同一個效果疊 K 層灌爆 fill rate，量掉幀後的 frame time。
 *    因為 cpuMs 看不到 GPU 光柵化時間（render() 只提交不等 GPU），唯有把 GPU 操成瓶頸，
 *    frame time 才會反映 fragment 負載。四個效果的 overdraw frame time 一比，就看得出
 *    dissolve 的四層 fbm 比 chromatic 的位移貴多少。
 * 3. **架構成本**（layering finding）：N 個 sprite 各掛一個 filter vs 全部塞進一個容器、
 *    容器掛單一 filter。render pass 從 N 降到 1，draw call 暴減。
 */

export interface ShaderBenchTuning {
    /** overdraw 疊幾層——要夠多才會把 GPU 操到掉幀，數字才有意義 */
    overdraw: number;
    /** overdraw 每層的螢幕佔地（px），固定住才能跨效果公平比較 */
    overdrawSize: number;
    /** layering finding 疊幾個物件 */
    layers: number;
}

export const DEFAULT_TUNING: ShaderBenchTuning = {
    overdraw: 48,
    overdrawSize: 512,
    layers: 200,
};

/** 讓一個節點置中、縮到指定佔地（跟 stage.ts 的 fit 同一套邏輯）。 */
function fitView(view: PixiContainer, app: Application, target: number): void {
    const b = view.getLocalBounds();
    const scale = target / Math.max(b.width || 1, b.height || 1);
    view.scale.set(scale);
    view.position.set(app.screen.width / 2, app.screen.height / 2);
}

export function buildShaderCases(
    app: Application,
    texture: Texture,
    tuning: ShaderBenchTuning = DEFAULT_TUNING,
): BenchCase[] {
    const holder = new Container();
    app.stage.addChild(holder);

    // 每個案例開跑前清乾淨上一個案例的殘留——沒清的話下一個案例會連同上一批一起量
    const clear = (): void => {
        for (const child of holder.removeChildren()) child.destroy({ children: true });
    };

    const cases: BenchCase[] = [];

    for (const eff of EFFECTS) {
        const defaults = defaultValues(eff);

        // 1a. baseline：純 sprite，不掛任何效果——draw call 的參考底線
        cases.push({
            id: `${eff.id}-base`,
            label: `${eff.id} · baseline`,
            meta: { scenario: eff.id, mode: 'Baseline', technique: eff.technique },
            setup: () => {
                clear();
                const sprite = new Sprite(texture);
                sprite.anchor.set(0.5);
                fitView(sprite, app, tuning.overdrawSize);
                holder.addChild(sprite);
                return 1;
            },
        });

        // 1b. effect ×1：掛上效果，跟 baseline 比 draw call 差
        {
            let inst: EffectInstance | null = null;
            cases.push({
                id: `${eff.id}-fx`,
                label: `${eff.id} · effect ×1`,
                meta: { scenario: eff.id, mode: 'Effect ×1', technique: eff.technique },
                setup: () => {
                    clear();
                    inst = getEffect(eff.id).create(texture);
                    inst.apply(defaults);
                    fitView(inst.view, app, tuning.overdrawSize);
                    holder.addChild(inst.view);
                    return 1;
                },
                update: (ms) => inst?.tick?.(ms / 1000),
            });
        }

        // 2. overdraw ×K：同一效果疊 K 層灌爆 fill rate，量 GPU 相對成本
        {
            const insts: EffectInstance[] = [];
            cases.push({
                id: `${eff.id}-overdraw`,
                label: `${eff.id} · overdraw ×${tuning.overdraw}`,
                meta: {
                    scenario: eff.id,
                    mode: `Overdraw ×${tuning.overdraw}`,
                    technique: eff.technique,
                },
                setup: () => {
                    clear();
                    insts.length = 0;
                    for (let i = 0; i < tuning.overdraw; i++) {
                        const inst = getEffect(eff.id).create(texture);
                        inst.apply(defaults);
                        fitView(inst.view, app, tuning.overdrawSize);
                        holder.addChild(inst.view);
                        insts.push(inst);
                    }
                    return tuning.overdraw;
                },
                update: (ms) => {
                    const s = ms / 1000;
                    for (const inst of insts) inst.tick?.(s);
                },
            });
        }
    }

    // 3. 架構 finding：N 個各掛 filter vs 父容器單一 filter（用 chromatic，徑向色差夠明顯）
    const scatter = (sprite: Sprite, i: number, n: number): void => {
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const cellW = app.screen.width / cols;
        const cellH = app.screen.height / rows;
        const size = Math.min(cellW, cellH) * 0.7;
        sprite.anchor.set(0.5);
        sprite.width = size;
        sprite.height = size;
        sprite.position.set(
            ((i % cols) + 0.5) * cellW,
            (Math.floor(i / cols) + 0.5) * cellH,
        );
    };

    cases.push({
        id: 'layering-per-object',
        label: `filter layering · per-object ×${tuning.layers}`,
        meta: { scenario: 'Filter layering', mode: 'Per-object filter', technique: 'filter' },
        setup: () => {
            clear();
            for (let i = 0; i < tuning.layers; i++) {
                const sprite = new Sprite(texture);
                scatter(sprite, i, tuning.layers);
                sprite.filters = [createChromaticFilter()]; // 每個物件一個 filter → 每個一道 render pass
                holder.addChild(sprite);
            }
            return tuning.layers;
        },
    });

    cases.push({
        id: 'layering-container',
        label: `filter layering · container ×${tuning.layers}`,
        meta: { scenario: 'Filter layering', mode: 'Container filter', technique: 'filter' },
        setup: () => {
            clear();
            const group = new Container();
            for (let i = 0; i < tuning.layers; i++) {
                const sprite = new Sprite(texture);
                scatter(sprite, i, tuning.layers);
                group.addChild(sprite);
            }
            group.filters = [createChromaticFilter()]; // 全部塞進一個容器、只掛一個 filter → 一道 render pass
            holder.addChild(group);
            return tuning.layers;
        },
    });

    return cases;
}
