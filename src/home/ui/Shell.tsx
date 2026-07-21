import { useHomeStore } from '../store';
import { NODES, nodeById, TECH_STACK, type Tone } from '../projects';
import { enterProject } from '../enter';
import { useT } from './useT';
import { SkyDial } from './SkyDial';

const TONE_CSS: Record<Tone, string> = {
    glsl: 'var(--glsl)',
    wgsl: 'var(--wgsl)',
    dual: 'var(--dual)',
    pixi: 'var(--pixi)',
    three: 'var(--three)',
    babylon: 'var(--babylon)',
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
    // 停在畫面同一側會蓋住節點——所以擺在節點的對側。
    // 桌面看水平位置（左/右），直屏看垂直位置（上/下），下方節點的卡片改擺上方，才不會蓋住它、造成 hover 閃爍。
    const dock = node.x > 0.5 ? 'dock-left' : 'dock-right';
    const vdock = node.narrow.y > 0.6 ? 'vdock-top' : 'vdock-bottom';

    return (
        <aside className={`inspector ${dock} ${vdock}`} role="status">
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
            <SkyDial />

            {/* hover 時技術棧讓位給 inspector（都在畫面下緣） */}
            {!activeId && (
                <footer className="legend" aria-hidden="true">
                    <span className="legend-title">{t('home.tech.title')}</span>
                    <ul>
                        {TECH_STACK.map((g) => (
                            <li key={g.i18nKey}>
                                <span className="tech-label">{t(g.i18nKey)}</span>
                                <span className="tech-items">
                                    {g.items.map((item, i) => (
                                        <span key={item.name}>
                                            {i > 0 && <span className="tech-sep"> · </span>}
                                            <span style={item.tone ? { color: TONE_CSS[item.tone] } : undefined}>
                                                {item.name}
                                            </span>
                                        </span>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {/* 線的圖例縮成一行附註——用實際的線段當樣本，不用圓點：
                        圓點長得像節點，原本那份圖例會被讀成在講節點，就是因為這個。 */}
                    <span className="legend-lines">
                        <span>
                            <i className="ln solid" />
                            {t('home.legend.line')}
                        </span>
                        <span>
                            <i className="ln dotted" />
                            {t('home.legend.wraps')}
                        </span>
                    </span>
                    <span className="hint">{t('home.hint')}</span>
                </footer>
            )}
        </div>
    );
}
