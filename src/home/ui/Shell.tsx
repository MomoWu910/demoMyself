import { useHomeStore } from '../store';
import { NODES, nodeById, RESOURCE_LEGEND, type Tone } from '../projects';
import { enterProject } from '../enter';
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

/** 右側 inspector：hover / 聚焦節點時長出那個 pass 的細節。 */
function Inspector() {
    const t = useT();
    const activeId = useHomeStore((s) => s.activeId);
    if (!activeId) return null;
    const node = nodeById(activeId);
    // 停在畫面同一側會蓋住節點——所以擺在節點的對側
    const dock = node.x > 0.5 ? 'dock-left' : 'dock-right';

    return (
        <aside className={`inspector ${dock}`} role="status">
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
            <a
                className="insp-enter"
                href={node.href}
                onClick={(e) => {
                    e.preventDefault();
                    enterProject(node.id);
                }}
            >
                {t(`${node.i18nKey}.cta`)}
            </a>
        </aside>
    );
}

/** 鍵盤 / 螢幕報讀者的入口：sr-only 的一排連結。聚焦時同步高亮 canvas 節點。 */
function A11yNav() {
    const t = useT();
    const setActive = useHomeStore((s) => s.setActive);
    return (
        <nav className="a11y-nav" aria-label="Projects">
            {NODES.map((n) => (
                <a
                    key={n.id}
                    href={n.href}
                    onFocus={() => setActive(n.id)}
                    onBlur={() => {
                        if (useHomeStore.getState().activeId === n.id) setActive(null);
                    }}
                    onClick={(e) => {
                        e.preventDefault();
                        enterProject(n.id);
                    }}
                >
                    {t(`${n.i18nKey}.title`)}
                </a>
            ))}
        </nav>
    );
}

export function Shell() {
    const t = useT();
    const activeId = useHomeStore((s) => s.activeId);
    const entering = useHomeStore((s) => s.enteringId);

    return (
        <div className={`overlay${entering ? ' entering' : ''}`}>
            <header className="wordmark">
                <div className="mark-row">
                    <h1>ERIC WU</h1>
                    <StatusBadge />
                </div>
                <p className="tagline">{t('home.tagline')}</p>
            </header>

            <A11yNav />
            <Inspector />

            {/* hover 時圖例讓位給 inspector（都在畫面下緣） */}
            {!activeId && (
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
            )}
        </div>
    );
}
