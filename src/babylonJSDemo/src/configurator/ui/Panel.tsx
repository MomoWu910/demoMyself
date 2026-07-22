import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../i18n/useT';
import { selectionOf, useCfgStore } from '../store';
import { copyText, encodeSelection, shareUrl } from '../share';
import { downloadDataUrl, screenshotFilename } from '../capture';
import { surfaceKindOf, type SurfaceSource } from '../surfaceDetail';
import type { CameraViewId } from '../configuratorView';
import type { BackgroundMode } from '../../managers/environmentManager';

/** colorway 變體對應的色塊顏色（球鞋模型內建 midnight / beach / street） */
const VARIANT_SWATCH: Record<string, string> = {
    midnight: '#2a3550',
    beach: '#d8b98a',
    street: '#9aa0a6',
};

const LIGHTING_PRESETS = [
    { id: 'soft', key: 'cfg.preset.soft' },
    { id: 'dramatic', key: 'cfg.preset.dramatic' },
    { id: 'ecom', key: 'cfg.preset.ecom' },
];

const CAMERA_VIEWS: { id: CameraViewId; key: string }[] = [
    { id: 'hero', key: 'cfg.view.hero' },
    { id: 'side', key: 'cfg.view.side' },
    { id: 'front', key: 'cfg.view.front' },
    { id: 'top', key: 'cfg.view.top' },
    { id: 'detail', key: 'cfg.view.detail' },
];

const SURFACE_SOURCES: { id: SurfaceSource; key: string }[] = [
    { id: 'shader', key: 'cfg.surface.shader' },
    { id: 'texture', key: 'cfg.surface.texture' },
];

const BACKGROUNDS: { id: BackgroundMode; key: string }[] = [
    { id: 'studio', key: 'cfg.bg.studio' },
    { id: 'gradient', key: 'cfg.bg.gradient' },
    { id: 'dark', key: 'cfg.bg.dark' },
    { id: 'white', key: 'cfg.bg.white' },
];

/**
 * 一段有標題的區塊；`foldable` 的可以點標題收合。
 *
 * 收合狀態是元件自己的 local state，不進 store 也不進分享連結——它是「這台螢幕上
 * 我現在想看什麼」，不是「這雙鞋長什麼樣」。`defaultOpen` 只當初值：使用者手動
 * 展開後，之後改變視窗大小不該把它關回去。
 */
function Section({
    label,
    children,
    hidden,
    foldable,
    defaultOpen = true,
}: {
    label: string;
    children: React.ReactNode;
    hidden?: boolean;
    foldable?: boolean;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    if (hidden) return null;
    if (!foldable) {
        return (
            <div className="section">
                <span className="label">{label}</span>
                {children}
            </div>
        );
    }
    return (
        <div className="section">
            <button className="label fold" type="button" onClick={() => setOpen((v) => !v)}>
                <span>{label}</span>
                <em>{open ? '▴' : '▾'}</em>
            </button>
            {open && children}
        </div>
    );
}

/** 一條滑桿。值與顯示都來自 store，不再需要手動把數字寫回 DOM。 */
function Slider(props: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    onChange: (v: number) => void;
}) {
    return (
        <div className="slider-row">
            <div className="slabel">
                <span>{props.label}</span>
                <span className="val">{props.format(props.value)}</span>
            </div>
            <input
                type="range"
                min={props.min}
                max={props.max}
                step={props.step}
                value={props.value}
                onChange={(e) => props.onChange(parseFloat(e.target.value))}
            />
        </div>
    );
}

/**
 * 手機 bottom sheet：面板預設收合只露把手，並把「被底部 UI 蓋住的高度」回報給相機，
 * 讓鞋子始終置中在沒被蓋住的可視區。
 *
 * 這段是命令式的（要量真實 DOM 尺寸），所以留在 effect 裡而不是硬塞進 render。
 */
function useBottomSheet(panelRef: React.RefObject<HTMLElement | null>, collapsed: boolean, setCollapsed: (v: boolean) => void) {
    // measure 需要讀「最新的」collapsed，但它註冊在只跑一次的 effect 裡——用 ref 過渡
    const readyRef = useRef(false);

    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const mq = window.matchMedia('(max-width: 720px)');

        const measure = () => {
            const view = useCfgStore.getState().view;
            if (!view) return;
            if (!mq.matches) {
                view.setBottomObstruction(0);
                return;
            }
            // 面板頂緣以下（含面板、bottom bar、邊距）都算遮擋
            view.setBottomObstruction(window.innerHeight - panel.getBoundingClientRect().top);
        };

        // 收合/展開的 max-height 動畫進行中量不準，動畫結束才是準確高度。
        // 不能用固定 setTimeout 校正：3D render loop 佔滿主執行緒時，動畫會遠晚於固定
        // 延遲才真正完成（實測 transition 甚至 ~370ms 後才開始動），固定延遲會量到動畫
        // 途中的舊高度而讓 obstruction 卡死。改用 transitionend 精準校正。
        const onTransitionEnd = (e: TransitionEvent) => {
            if (e.propertyName === 'max-height') measure();
        };
        const onModeChange = () => setCollapsed(mq.matches); // 手機預設收合

        panel.addEventListener('transitionend', onTransitionEnd);
        mq.addEventListener('change', onModeChange);
        window.addEventListener('resize', measure);
        if (!readyRef.current) {
            readyRef.current = true;
            setCollapsed(mq.matches);
        }
        measure();

        return () => {
            panel.removeEventListener('transitionend', onTransitionEnd);
            mq.removeEventListener('change', onModeChange);
            window.removeEventListener('resize', measure);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 收合狀態一變就先量一次求即時回饋，準確值交給上面的 transitionend
    useEffect(() => {
        const panel = panelRef.current;
        const view = useCfgStore.getState().view;
        if (!panel || !view) return;
        if (!window.matchMedia('(max-width: 720px)').matches) {
            view.setBottomObstruction(0);
            return;
        }
        view.setBottomObstruction(window.innerHeight - panel.getBoundingClientRect().top);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapsed]);
}

/** 複製目前設定的連結。複製成功後把自己的字換成「已複製」兩秒，不另外彈東西。 */
function ShareButton() {
    const t = useT();
    const [copied, setCopied] = useState(false);

    const onClick = async () => {
        const s = useCfgStore.getState();
        if (!s.defaults) return;
        const ok = await copyText(shareUrl(encodeSelection(selectionOf(s), s.defaults)));
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button className={`ctrl-btn${copied ? ' on' : ''}`} onClick={onClick}>
            {copied ? t('cfg.btn.copied') : t('cfg.btn.share')}
        </button>
    );
}

/**
 * 匯出目前畫面的 PNG。
 *
 * 拍照那一幀會用兩倍解析度重畫，在低階機器上可能卡住半秒，所以按下去先把按鈕鎖起來
 * 並換成「匯出中」——沒有回饋的話使用者會以為沒反應而連按，連續幾次 2 倍重畫更卡。
 */
function ExportButton() {
    const t = useT();
    const [busy, setBusy] = useState(false);

    const onClick = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const s = useCfgStore.getState();
            const dataUrl = await s.capture(2);
            if (dataUrl) downloadDataUrl(dataUrl, screenshotFilename(selectionOf(s)));
        } finally {
            setBusy(false);
        }
    };

    return (
        <button className={`ctrl-btn${busy ? ' on' : ''}`} onClick={onClick} disabled={busy}>
            {busy ? t('cfg.btn.exporting') : t('cfg.btn.export')}
        </button>
    );
}

/**
 * 兩種表面細節來源的取得成本。
 *
 * **刻意只顯示下載量與準備耗時，不顯示 FPS**：兩種來源準備完之後都只是一次貼圖
 * 取樣，每幀成本完全相同，擺一個永遠一樣的 FPS 上去等於暗示它們有效能差異。
 * 這裡的數字全是量到的（傳輸量查 Resource Timing，耗時是 performance.now 夾出來的）。
 */
function SurfaceCost() {
    const t = useT();
    const m = useCfgStore((s) => s.surfaceMetrics);
    const busy = useCfgStore((s) => s.surfaceBusy);

    if (busy) return <div className="cost">{t('cfg.surface.preparing')}</div>;
    if (!m) return null;

    const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    return (
        <div className="cost">
            <div>
                <span>{t('cfg.surface.download')}</span>
                <span className="val">{m.source === 'shader' ? `0 KB (+${kb(m.shaderBytes)} GLSL)` : kb(m.bytes)}</span>
            </div>
            <div title={t('cfg.surface.prepHint')}>
                <span>{t('cfg.surface.prep')} ⓘ</span>
                <span className="val">{m.prepMs.toFixed(1)} ms</span>
            </div>
            <div>
                <span>{t('cfg.surface.perFrame')}</span>
                <span className="val">{t('cfg.surface.same')}</span>
            </div>
        </div>
    );
}

export function Panel() {
    const t = useT();
    const panelRef = useRef<HTMLElement | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    useBottomSheet(panelRef, collapsed, setCollapsed);
    // 選了有紋理的 finish 之後整份面板全展開約 854px，加上 max-height 保留的
    // 120px 上下邊距，要 975px 高的視窗才裝得下（實測 1440×900 溢出 75px）。
    // 不到這個高度就把兩段進階選項預設收起來。
    const [compact] = useState(() => window.innerHeight < 975);

    const s = useCfgStore();
    if (!s.ready) return null;

    const part = s.partState[s.currentPart] ?? { finishId: 'original', tintId: 'none' };

    return (
        <>
            <aside className={`side-panel${collapsed ? ' collapsed' : ''}`} ref={panelRef}>
                <button className="sheet-handle" type="button" onClick={() => setCollapsed((v) => !v)}>
                    <span>⚙ {t('cfg.sheet.customize')}</span>
                    <em>▼</em>
                </button>

                {/* 部件：單一 mesh 的模型只有「整雙」一個部件，整段就不必出現 */}
                <Section label={t('cfg.section.part')} hidden={s.parts.length <= 1}>
                    <div className="pills">
                        {s.parts.map((p) => (
                            <button
                                key={p.id}
                                className={`pill${p.id === s.currentPart ? ' active' : ''}`}
                                onClick={() => s.setPart(p.id)}
                            >
                                {t(p.label)}
                            </button>
                        ))}
                    </div>
                </Section>

                <Section label={t('cfg.section.finish')}>
                    <div className="pills">
                        {s.finishes.map((f) => (
                            <button
                                key={f.id}
                                className={`pill${f.id === part.finishId ? ' active' : ''}`}
                                onClick={() => s.setFinish(f.id)}
                            >
                                {t(f.label)}
                            </button>
                        ))}
                    </div>
                </Section>

                <Section label={t('cfg.section.color')}>
                    <div className="swatches">
                        {s.tints.map((tint) => (
                            <div
                                key={tint.id}
                                className={`swatch${tint.id === 'none' ? ' none' : ''}${tint.id === part.tintId ? ' active' : ''}`}
                                style={tint.id === 'none' ? undefined : { background: tint.hex }}
                                title={t(tint.label)}
                                onClick={() => s.setTint(tint.id)}
                            />
                        ))}
                    </div>
                </Section>

                <Section label={t('cfg.section.colorway')} hidden={s.variants.length === 0}>
                    <div className="swatches">
                        {s.variants.map((name) => (
                            <div
                                key={name}
                                className={`swatch${name === s.variant ? ' active' : ''}`}
                                style={{ background: VARIANT_SWATCH[name.toLowerCase()] ?? '#888' }}
                                title={name}
                                onClick={() => s.setVariant(name)}
                            />
                        ))}
                    </div>
                </Section>

                <div className="divider" />

                <Section label={t('cfg.section.lighting')} foldable defaultOpen={!compact}>
                    <div className="pills">
                        {LIGHTING_PRESETS.map((p) => (
                            <button
                                key={p.id}
                                className={`pill${p.id === s.lightingPreset ? ' active' : ''}`}
                                onClick={() => s.setLightingPreset(p.id)}
                            >
                                {t(p.key)}
                            </button>
                        ))}
                    </div>
                    <Slider
                        label={t('cfg.slider.envInt')}
                        value={s.envIntensity}
                        min={0}
                        max={3}
                        step={0.05}
                        format={(v) => v.toFixed(2)}
                        onChange={s.setEnvIntensity}
                    />
                    <Slider
                        label={t('cfg.slider.envRot')}
                        value={s.envRotationDeg}
                        min={0}
                        max={360}
                        step={1}
                        format={(v) => `${Math.round(v)}°`}
                        onChange={s.setEnvRotationDeg}
                    />
                    <Slider
                        label={t('cfg.slider.keyInt')}
                        value={s.keyIntensity}
                        min={0}
                        max={6}
                        step={0.05}
                        format={(v) => v.toFixed(2)}
                        onChange={s.setKeyIntensity}
                    />
                    <Slider
                        label={t('cfg.slider.keyTemp')}
                        value={s.keyTempK}
                        min={2700}
                        max={9000}
                        step={100}
                        format={(v) => `${Math.round(v)}K`}
                        onChange={s.setKeyTempK}
                    />
                </Section>

                {/* 機位。使用者自己拖過相機後 cameraView 會變 'free'，這裡就沒有任何一顆是亮的 */}
                {/* 表面細節。finish 是 original / glossy 時沒有紋理可調，整段收起來 */}
                <Section
                    label={t('cfg.section.surface')}
                    hidden={!surfaceKindOf(part.finishId)}
                    foldable
                    defaultOpen={!compact}
                >
                    <div className="pills">
                        {SURFACE_SOURCES.map((src) => (
                            <button
                                key={src.id}
                                className={`pill${src.id === s.surfaceSource ? ' active' : ''}`}
                                onClick={() => s.setSurfaceSource(src.id)}
                            >
                                {t(src.key)}
                            </button>
                        ))}
                    </div>
                    <Slider
                        label={t('cfg.slider.tiling')}
                        value={s.surfaceTiling}
                        min={0.5}
                        max={12}
                        step={0.5}
                        format={(v) => `${v.toFixed(1)}×`}
                        onChange={s.setSurfaceTiling}
                    />
                    <Slider
                        label={t('cfg.slider.bump')}
                        value={s.surfaceBump}
                        min={0}
                        max={3}
                        step={0.05}
                        format={(v) => v.toFixed(2)}
                        onChange={s.setSurfaceBump}
                    />
                    <SurfaceCost />
                </Section>

                <Section label={t('cfg.section.view')}>
                    <div className="pills">
                        {CAMERA_VIEWS.map((v) => (
                            <button
                                key={v.id}
                                className={`pill${v.id === s.cameraView ? ' active' : ''}`}
                                onClick={() => s.setCameraView(v.id)}
                            >
                                {t(v.key)}
                            </button>
                        ))}
                    </div>
                </Section>

                <Section label={t('cfg.section.background')}>
                    <div className="pills">
                        {BACKGROUNDS.map((b) => (
                            <button
                                key={b.id}
                                className={`pill${b.id === s.background ? ' active' : ''}`}
                                onClick={() => s.setBackground(b.id)}
                            >
                                {t(b.key)}
                            </button>
                        ))}
                    </div>
                </Section>
            </aside>

            <div className="bottom-bar">
                <button className={`ctrl-btn${s.autoRotate ? ' on' : ''}`} onClick={s.toggleAutoRotate}>
                    {t('cfg.btn.autorotate')}
                </button>
                <button className="ctrl-btn" onClick={s.resetView}>
                    {t('cfg.btn.reset')}
                </button>
                <ShareButton />
                <ExportButton />
            </div>
        </>
    );
}
