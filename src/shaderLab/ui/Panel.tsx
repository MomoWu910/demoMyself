import { useState } from 'react';
import { useLabStore, type Backend } from '../store';
import { EFFECTS, getEffect, type EffectDef, type ParamDef } from '../effects';
import { runShaderBenchmark } from '../bench/runShaderBench';
import { SHADER_COSTS, LAYERING_FINDING, COST_PROVENANCE } from '../bench/costData';
import { SourceView } from './SourceView';
import { useT } from './useT';

type RangeParam = Extract<ParamDef, { kind: 'range' }>;
type ColorParam = Extract<ParamDef, { kind: 'color' }>;

function RangeRow({ param }: { param: RangeParam }) {
    const t = useT();
    const value = useLabStore((s) => s.values[s.effectId][param.key]) as number;
    const setParam = useLabStore((s) => s.setParam);
    const effectId = useLabStore((s) => s.effectId);
    const animating = useLabStore((s) => s.animating);

    // 被自動播放接管的參數：slider 照樣跟著跑，但不給拖——不然會跟舞台每幀的寫入打架
    const driven = animating && getEffect(effectId).animate?.key === param.key;

    return (
        <label className={`param${driven ? ' driven' : ''}`}>
            <span className="param-name">{t(param.labelKey)}</span>
            <span className="param-value">{value}</span>
            <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={value}
                disabled={driven}
                onChange={(e) => setParam(param.key, Number(e.target.value))}
            />
        </label>
    );
}

function ColorRow({ param }: { param: ColorParam }) {
    const t = useT();
    const value = useLabStore((s) => s.values[s.effectId][param.key]) as string;
    const setParam = useLabStore((s) => s.setParam);

    return (
        <label className="param">
            <span className="param-name">{t(param.labelKey)}</span>
            <span className="param-value">{value}</span>
            <input
                type="color"
                value={value}
                onChange={(e) => setParam(param.key, e.target.value)}
            />
        </label>
    );
}

/**
 * backend 切換。
 *
 * 這個 Lab 的主張是「同一個效果，GLSL 與 WGSL 各寫一份」——原本卻只有一個唯讀
 * 的 badge，兩份原始碼看得到、卻不能讓它們真的各跑一次。旗子貼圖上那個
 * `GLSL ⇄ WGSL` 等於在承諾一個不存在的功能。
 *
 * **切換靠重載頁面**：Pixi 的 renderer 類型在 `Application.init()` 就定了，
 * 中途換不了。重載也讓網址帶著 `?renderer=`，可以直接分享「用 WebGL 跑的這頁」。
 *
 * 不支援 WebGPU 的瀏覽器會**靜默退回** WebGL（見 stage.ts），所以這裡先問
 * `navigator.gpu`：沒有就把那顆鍵鎖起來並說明原因，否則使用者點了沒反應，
 * 只會以為是自己點錯。
 */
function BackendSwitch() {
    const t = useT();
    const backend = useLabStore((s) => s.backend);
    // 用值判斷而不是 `'gpu' in navigator`：屬性存在但被停用（值為 undefined）的瀏覽器
    // 用 `in` 會判成支援，然後使用者點下去、重載、又靜默退回 WebGL——白跑一趟。
    const gpuSupported = typeof navigator !== 'undefined' && (navigator as { gpu?: unknown }).gpu != null;

    const switchTo = (target: Backend) => {
        if (target === backend) return;
        const params = new URLSearchParams(window.location.search);
        params.set('renderer', target); // 寫明確值，分享出去的網址看得出跑的是哪個
        window.location.search = params.toString();
    };

    return (
        <div className="backend-switch" role="group" aria-label={t('shader.panel.backend')}>
            {(['webgl', 'webgpu'] as Backend[]).map((id) => {
                const blocked = id === 'webgpu' && !gpuSupported;
                return (
                    <button
                        key={id}
                        type="button"
                        className={`badge ${id}${backend === id ? ' active' : ''}`}
                        disabled={blocked || backend === null}
                        title={blocked ? t('shader.panel.noWebgpu') : t('shader.panel.switchTo')}
                        onClick={() => switchTo(id)}
                    >
                        {id.toUpperCase()}
                    </button>
                );
            })}
        </div>
    );
}

function StatusBar() {
    const t = useT();
    const fps = useLabStore((s) => s.fps);

    return (
        <div className="status">
            <BackendSwitch />
            <span className="fps">
                {fps} <small>{t('shader.panel.fps')}</small>
            </span>
        </div>
    );
}

/** draw call：WebGPU 攔不到，據實顯示 n/a，不填 0 混過去 */
function drawText(v: number | null): string {
    return v === null ? 'n/a' : String(v);
}

/**
 * 成本區。有實測數字（來自面板的「量測成本」→ 抄進 costData.ts）就顯示結構化的三欄；
 * 還沒量過的效果退回手寫敘述。架構 finding 與選中哪個效果無關，量過就一直顯示。
 */
function CostSection({ def }: { def: EffectDef }) {
    const t = useT();
    const [running, setRunning] = useState(false);
    const cost = SHADER_COSTS[def.id];

    return (
        <section className="cost">
            <div className="section-head">
                <h2>{t('shader.panel.cost')}</h2>
                <button className="ghost" disabled={running} onClick={() => void runShaderBenchmark(setRunning)}>
                    {running ? t('shader.cost.running') : t('shader.cost.run')}
                </button>
            </div>

            {cost ? (
                <div className="cost-measured">
                    <dl className="cost-metrics">
                        <div>
                            <dt>{t('shader.cost.drawcall')}</dt>
                            <dd>
                                {drawText(cost.drawBase)} → <b>{drawText(cost.drawFx)}</b>
                            </dd>
                        </div>
                    </dl>
                    <p className="cost-note">{t('shader.cost.note')}</p>
                    {COST_PROVENANCE && (
                        <p className="cost-prov">
                            {COST_PROVENANCE.renderer.toUpperCase()} · {COST_PROVENANCE.gpu} · {COST_PROVENANCE.viewport} ·{' '}
                            {COST_PROVENANCE.refreshHz}Hz · {COST_PROVENANCE.date}
                        </p>
                    )}
                </div>
            ) : (
                <>
                    <p>{t(`${def.i18nKey}.cost`)}</p>
                    <p className="cost-hint">{t('shader.cost.hint')}</p>
                </>
            )}

            {LAYERING_FINDING && (
                <div className="cost-layering">
                    <h3>{t('shader.cost.layering')}</h3>
                    <dl className="cost-metrics">
                        <div>
                            <dt>{t('shader.cost.layering.perObject')}</dt>
                            <dd>
                                {drawText(LAYERING_FINDING.perObjectDraw)} draws · {LAYERING_FINDING.perObjectMs} ms
                            </dd>
                        </div>
                        <div>
                            <dt>{t('shader.cost.layering.container')}</dt>
                            <dd>
                                {drawText(LAYERING_FINDING.containerDraw)} draws · {LAYERING_FINDING.containerMs} ms
                            </dd>
                        </div>
                    </dl>
                    <p className="cost-note">{t('shader.cost.layering.note')}</p>
                </div>
            )}
        </section>
    );
}

export function Panel() {
    const t = useT();
    const effectId = useLabStore((s) => s.effectId);
    const selectEffect = useLabStore((s) => s.selectEffect);
    const animating = useLabStore((s) => s.animating);
    const setAnimating = useLabStore((s) => s.setAnimating);
    const resetParams = useLabStore((s) => s.resetParams);

    const def = getEffect(effectId);

    return (
        <div className="panel-inner">
            <StatusBar />

            <section>
                <h2>{t('shader.panel.effect')}</h2>
                <div className="effect-list">
                    {EFFECTS.map((e) => (
                        <button
                            key={e.id}
                            className={`effect${e.id === effectId ? ' active' : ''}`}
                            onClick={() => selectEffect(e.id)}
                        >
                            {t(`${e.i18nKey}.title`)}
                        </button>
                    ))}
                </div>
                {/* filter 還是 mesh 材質——這是這個效果成本的分水嶺，值得標在最顯眼的地方 */}
                <div className={`technique ${def.technique}`}>
                    <b>{t(`shader.technique.${def.technique}`)}</b>
                    <span>{t(`shader.technique.${def.technique}.note`)}</span>
                </div>
                <p className="desc">{t(`${def.i18nKey}.desc`)}</p>
            </section>

            <section>
                <div className="section-head">
                    <h2>{t('shader.panel.params')}</h2>
                    <button className="ghost" onClick={resetParams}>
                        {t('shader.panel.reset')}
                    </button>
                </div>

                {def.animate && (
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={animating}
                            onChange={(e) => setAnimating(e.target.checked)}
                        />
                        <span>{t('shader.panel.animate')}</span>
                    </label>
                )}

                <div className="params">
                    {def.params.map((p) =>
                        p.kind === 'range' ? (
                            <RangeRow key={p.key} param={p} />
                        ) : (
                            <ColorRow key={p.key} param={p} />
                        ),
                    )}
                </div>
            </section>

            <CostSection def={def} />

            <SourceView />
        </div>
    );
}
