import { useEffect, useState } from 'react';
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

/* 小螢幕＝寬度窄（直屏）或高度矮（手機轉橫），兩種都是技術棧會壓到節點的情況。
 * 只看寬度抓不到窄橫屏，同 .sky-dial 的兩條 media query。 */
const COMPACT_MQ = '(max-width: 640px), (max-height: 500px)';

/** 小螢幕與否。技術棧要不要收起、tagline 用長版還短版，都吃這一個判定。 */
function useCompact(): boolean {
    const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_MQ).matches);
    useEffect(() => {
        const mq = window.matchMedia(COMPACT_MQ);
        const onChange = () => setCompact(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return compact;
}

/* hover 節點時整個 Legend 會 unmount（讓位給 inspector），展開狀態放元件內就會被一起丟掉——
 * 手機上剛展開、手指掃過一個節點就收回去。存在 module scope 才活得過 unmount。 */
let legendOpen: boolean | null = null;

/** 左下技術棧：桌機常駐展開，小螢幕收成一顆標題鈕，點了才長出來。 */
function Legend() {
    const t = useT();
    const compact = useCompact();
    const [open, setOpenState] = useState(() => legendOpen ?? !compact);
    const setOpen = (v: boolean) => {
        legendOpen = v;
        setOpenState(v);
    };

    // 換螢幕型態（手機轉向）就回到該型態的預設：橫轉直時留著展開狀態會直接壓在節點上。
    useEffect(() => setOpen(!compact), [compact]);

    return (
        <footer className={`legend${open ? ' open' : ''}${compact ? ' compact' : ''}`}>
            <button
                type="button"
                className="legend-toggle"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                <span className="legend-title">{t('home.tech.title')}</span>
                <span className="legend-caret" aria-hidden="true" />
            </button>
            <div className="legend-body" aria-hidden={!open}>
                {/* 兩層是必要的：外層 legend-inner 只做 overflow 裁切（0fr 過渡靠它），
                    背板的 padding 要放在再內一層，否則收起時 padding 會撐出一條殘留的底。 */}
                <div className="legend-inner">
                  <div className="legend-card">
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
                    {/* 線的圖例——用實際的線段當樣本，不用圓點：圓點長得像節點，
                        原本那份圖例會被讀成在講節點，就是因為這個。
                        三種樣本一一對應畫面上的三種線（見 projects.ts 的 EdgeKind）。 */}
                    <span className="legend-lines">
                        <span>
                            <i className="ln solid" />
                            {t('home.legend.module')}
                        </span>
                        <span>
                            <i className="ln dashed" />
                            {t('home.legend.library')}
                        </span>
                        <span>
                            <i className="ln dotted" />
                            {t('home.legend.wraps')}
                        </span>
                        {/* 沒有樣本可畫的那一項：全站共用模組畫成線會變完全圖，只能用文字交代。
                            縮排對齊上面三行的文字，讀起來才是同一組的第四點。 */}
                        <span className="ln-note">{t('home.legend.shell')}</span>
                    </span>
                    <span className="hint">{t('home.hint')}</span>
                  </div>
                </div>
            </div>
        </footer>
    );
}

export function Shell() {
    const t = useT();
    const activeId = useHomeStore((s) => s.activeId);
    const entering = useHomeStore((s) => s.enteringId);
    const compact = useCompact();

    return (
        <div className={`overlay${entering ? ' entering' : ''}`}>
            <header className="wordmark">
                <div className="mark-row">
                    <h1>ERIC WU</h1>
                    <StatusBadge />
                </div>
                <p className="tagline">{t(compact ? 'home.tagline.short' : 'home.tagline')}</p>
            </header>

            <A11yNav />
            <Inspector />
            <SkyDial />

            {/* hover 時技術棧讓位給 inspector（都在畫面下緣） */}
            {!activeId && <Legend />}
        </div>
    );
}
