import { useLabStore } from '../store';
import { EFFECTS, getEffect, type ParamDef } from '../effects';
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

function StatusBar() {
    const t = useT();
    const backend = useLabStore((s) => s.backend);
    const fps = useLabStore((s) => s.fps);

    return (
        <div className="status">
            <span className={`badge ${backend ?? 'pending'}`}>
                {backend ? backend.toUpperCase() : '…'}
            </span>
            <span className="fps">
                {fps} <small>{t('shader.panel.fps')}</small>
            </span>
        </div>
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

            <section className="cost">
                <h2>{t('shader.panel.cost')}</h2>
                <p>{t(`${def.i18nKey}.cost`)}</p>
            </section>

            <SourceView />
        </div>
    );
}
