import { useHomeStore } from '../store';
import { nodeById, RESOURCE_LEGEND, type Tone } from '../projects';
import { useT } from './useT';

const TONE_CSS: Record<Tone, string> = {
    glsl: 'var(--glsl)',
    wgsl: 'var(--wgsl)',
    dual: 'var(--dual)',
    pixi: 'var(--pixi)',
    neutral: 'var(--muted)',
};

function StatusBadge() {
    const backend = useHomeStore((s) => s.backend);
    return (
        <span className={`backend ${backend ?? 'pending'}`}>{backend ? backend.toUpperCase() : '···'}</span>
    );
}

/** 右側 inspector：hover / 聚焦節點時，長出那個 pass 的細節。 */
function Inspector() {
    const t = useT();
    const activeId = useHomeStore((s) => s.activeId);
    if (!activeId) return null;
    const node = nodeById(activeId);

    return (
        <aside className="inspector" role="status">
            <span className="insp-glyph" style={{ color: TONE_CSS[node.tone] }}>
                {node.glyph}
            </span>
            <h2>{t(`${node.i18nKey}.title`)}</h2>
            <p dangerouslySetInnerHTML={{ __html: t(`${node.i18nKey}.desc`) }} />
            <div className="insp-tags">
                {node.tags.map((tag) => (
                    <span key={tag} className="insp-tag">
                        {tag}
                    </span>
                ))}
            </div>
            <a className="insp-enter" href={node.href}>
                {t(`${node.i18nKey}.cta`)}
            </a>
        </aside>
    );
}

export function Shell() {
    const t = useT();
    return (
        <div className="overlay">
            <header className="wordmark">
                <div className="mark-row">
                    <h1>ERIC WU</h1>
                    <StatusBadge />
                </div>
                <p className="tagline">{t('home.tagline')}</p>
            </header>

            <Inspector />

            <footer className="legend" aria-hidden="true">
                <span className="legend-title">{t('home.legend')}</span>
                <ul>
                    {RESOURCE_LEGEND.map((r) => (
                        <li key={r.resource}>
                            <span className="dot" style={{ background: TONE_CSS[r.tone] }} />
                            {r.resource}
                        </li>
                    ))}
                </ul>
                <span className="hint">{t('home.hint')}</span>
            </footer>
        </div>
    );
}
