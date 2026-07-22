import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../i18n/useT';
import { selectionOf, useCfgStore } from '../store';
import { copyText, encodeSelection, shareUrl } from '../share';
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

const BACKGROUNDS: { id: BackgroundMode; key: string }[] = [
    { id: 'studio', key: 'cfg.bg.studio' },
    { id: 'gradient', key: 'cfg.bg.gradient' },
    { id: 'dark', key: 'cfg.bg.dark' },
    { id: 'white', key: 'cfg.bg.white' },
];

/** 一段有標題的區塊 */
function Section({ label, children, hidden }: { label: string; children: React.ReactNode; hidden?: boolean }) {
    if (hidden) return null;
    return (
        <div className="section">
            <span className="label">{label}</span>
            {children}
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

export function Panel() {
    const t = useT();
    const panelRef = useRef<HTMLElement | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    useBottomSheet(panelRef, collapsed, setCollapsed);

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

                <Section label={t('cfg.section.lighting')}>
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
            </div>
        </>
    );
}
