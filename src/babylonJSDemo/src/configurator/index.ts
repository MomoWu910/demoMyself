import { ConfiguratorView } from './configuratorView';
import { PartInfo, FinishInfo, TintInfo } from './materialConfigurator';
import { initI18n, t } from '../../../i18n';
import { mountReveal } from '../../../shell/reveal';
import { wireGoBack } from '../../../shell/goBack';

mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開
wireGoBack(document.querySelector('.back-btn')); // 返回＝回上一頁，不新增歷史紀錄

// colorway 變體對應的色塊顏色（球鞋模型內建 midnight / beach / street）
const VARIANT_SWATCH: Record<string, string> = {
    midnight: '#2a3550',
    beach: '#d8b98a',
    street: '#9aa0a6',
};

// 動態 pill 用 i18n key；建立時設 dataset.i18n，語言切換時 applyDom() 會自動重譯
const LIGHTING_PRESETS: { id: string; key: string }[] = [
    { id: 'soft', key: 'cfg.preset.soft' },
    { id: 'dramatic', key: 'cfg.preset.dramatic' },
    { id: 'ecom', key: 'cfg.preset.ecom' },
];

const BACKGROUNDS: { id: string; key: string }[] = [
    { id: 'studio', key: 'cfg.bg.studio' },
    { id: 'gradient', key: 'cfg.bg.gradient' },
    { id: 'dark', key: 'cfg.bg.dark' },
    { id: 'white', key: 'cfg.bg.white' },
];

// 每個部件目前選用的 finish / tint（供 UI 切換部件時還原 active 狀態）
interface PartUiState {
    finishId: string;
    tintId: string;
}

/** 取得元素；找不到時回 null（防禦舊 DOM / 模板未更新導致的崩潰） */
function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

window.addEventListener('DOMContentLoaded', async () => {
    // 套用翻譯 + 右上角語言切換鈕（右上角為空白區，側面板在右側中間）
    initI18n({ style: { top: '20px', right: '20px' } });

    const canvas = byId<HTMLCanvasElement>('renderCanvas');
    if (!canvas) return;
    const view = new ConfiguratorView(canvas);

    const { variants, activeVariant, parts, finishes, tints } = await view.init();
    view.run();
    (globalThis as any).__CFG_VIEW__ = view; // debug handle（比照 __PIXI_APP__ 慣例）

    try {
        // 各部件 UI 狀態（預設 original / none）
        const partState: Record<string, PartUiState> = {};
        parts.forEach((p) => (partState[p.id] = { finishId: 'original', tintId: 'none' }));
        let currentPart = parts[0]?.id ?? 'whole';

        _buildParts(parts, (id) => { currentPart = id; }, partState, finishes, tints);
        _buildFinishes(view, finishes, () => currentPart, partState);
        _buildTints(view, tints, () => currentPart, partState);
        _buildColorway(view, variants, activeVariant, () => currentPart, partState, finishes, tints);
        _buildLighting(view);
        _buildBackgrounds(view);
        _wireControls(view);
    } catch (err) {
        // 任一控制項建構失敗都不該擋住畫面（例如 dev server HTML 未更新）
        // eslint-disable-next-line no-console
        console.warn('[configurator] 控制面板建構出現問題，請重啟 dev server：', err);
    }

    // 就緒：顯示面板、淡出載入畫面（即使上面有缺漏也照常顯示）
    const panel = byId('panel');
    if (panel) panel.style.display = 'flex';
    const bottomBar = byId('bottom-bar');
    if (bottomBar) bottomBar.style.display = 'flex';
    byId('loading')?.classList.add('hidden');

    _wireSheet(view);
});

/**
 * 手機 bottom sheet：面板預設收合只露把手，並把「被底部 UI 蓋住的高度」
 * 回報給相機做框景偏移，讓鞋子始終置中在沒被蓋住的可視區
 */
function _wireSheet(view: ConfiguratorView) {
    const panel = byId('panel');
    const toggle = byId('sheet-toggle');
    if (!panel || !toggle) return;
    const mq = window.matchMedia('(max-width: 720px)');

    const measure = () => {
        if (!mq.matches) { view.setBottomObstruction(0); return; }
        // 面板頂緣以下（含面板、bottom bar、邊距）都算遮擋
        view.setBottomObstruction(window.innerHeight - panel.getBoundingClientRect().top);
    };
    // 收合/展開的 max-height 動畫進行中量不準，動畫結束才是準確高度。
    // 不能用固定 setTimeout 校正：3D render loop 佔滿主執行緒時，動畫會遠晚於
    // 固定延遲才真正完成（實測 transition 甚至 ~370ms 後才開始動），固定延遲會
    // 量到動畫途中的舊高度而讓 obstruction 卡死。改用 transitionend 精準校正。
    panel.addEventListener('transitionend', (e) => {
        if ((e as TransitionEvent).propertyName === 'max-height') measure();
    });
    // 先立即量一次求即時回饋，準確值交給上面的 transitionend
    const measureSoon = () => { measure(); };

    toggle.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
        measureSoon();
    });
    const applyMode = () => {
        panel.classList.toggle('collapsed', mq.matches); // 手機預設收合
        measureSoon();
    };
    mq.addEventListener('change', applyMode);
    window.addEventListener('resize', measure);
    applyMode();
}

/**
 * 部件選擇器：只有多部件模型才顯示；切換部件時把 finish / tint 的 active 狀態同步成該部件的選擇
 */
function _buildParts(
    parts: PartInfo[],
    setCurrent: (id: string) => void,
    state: Record<string, PartUiState>,
    finishes: FinishInfo[],
    tints: TintInfo[],
) {
    if (parts.length <= 1) return; // 單一部件不顯示此列
    const container = byId('parts');
    if (!container) return;
    byId('sec-parts')?.classList.remove('hidden');

    parts.forEach((p, i) => {
        const pill = document.createElement('button');
        pill.className = 'pill' + (i === 0 ? ' active' : '');
        pill.textContent = p.label;
        pill.addEventListener('click', () => {
            setCurrent(p.id);
            container.querySelectorAll('.pill').forEach((el) => el.classList.remove('active'));
            pill.classList.add('active');
            _syncActive('finishes', state[p.id].finishId);
            _syncActiveSwatch('tints', state[p.id].tintId);
        });
        container.appendChild(pill);
    });
}

/** 質感 pills */
function _buildFinishes(
    view: ConfiguratorView,
    finishes: FinishInfo[],
    getCurrent: () => string,
    state: Record<string, PartUiState>,
) {
    const container = byId('finishes');
    if (!container) return;
    finishes.forEach((f) => {
        const pill = document.createElement('button');
        pill.className = 'pill' + (f.id === 'original' ? ' active' : '');
        pill.dataset.id = f.id;
        pill.textContent = f.label;
        pill.addEventListener('click', () => {
            const part = getCurrent();
            view.applyFinish(part, f.id);
            state[part].finishId = f.id;
            container.querySelectorAll('.pill').forEach((el) => el.classList.remove('active'));
            pill.classList.add('active');
        });
        container.appendChild(pill);
    });
}

/** 顏色 tint 色塊 */
function _buildTints(
    view: ConfiguratorView,
    tints: TintInfo[],
    getCurrent: () => string,
    state: Record<string, PartUiState>,
) {
    const container = byId('tints');
    if (!container) return;
    tints.forEach((t) => {
        const sw = document.createElement('div');
        const isNone = t.id === 'none';
        sw.className = 'swatch' + (isNone ? ' none' : '') + (t.id === 'none' ? ' active' : '');
        sw.dataset.id = t.id;
        sw.title = t.label;
        if (!isNone) sw.style.background = t.hex;
        sw.addEventListener('click', () => {
            const part = getCurrent();
            view.applyTint(part, t.id);
            state[part].tintId = t.id;
            container.querySelectorAll('.swatch').forEach((el) => el.classList.remove('active'));
            sw.classList.add('active');
        });
        container.appendChild(sw);
    });
}

/** colorway 變體色塊：模型無變體時隱藏整段 */
function _buildColorway(
    view: ConfiguratorView,
    variants: string[],
    active: string,
    getCurrent: () => string,
    state: Record<string, PartUiState>,
    finishes: FinishInfo[],
    tints: TintInfo[],
) {
    if (variants.length === 0) return;
    const container = byId('swatches');
    if (!container) return;
    byId('sec-colorway')?.classList.remove('hidden');

    variants.forEach((name) => {
        const sw = document.createElement('div');
        sw.className = 'swatch' + (name === active ? ' active' : '');
        sw.style.background = VARIANT_SWATCH[name.toLowerCase()] ?? '#888';
        sw.title = name;
        sw.addEventListener('click', () => {
            view.selectVariant(name);
            container.querySelectorAll('.swatch').forEach((el) => el.classList.remove('active'));
            sw.classList.add('active');
            // 變體會重套 finish / tint，UI active 狀態同步回目前部件的選擇
            const part = getCurrent();
            _syncActive('finishes', state[part].finishId);
            _syncActiveSwatch('tints', state[part].tintId);
        });
        container.appendChild(sw);
    });
}

/** 打光：preset pills + 四條滑桿 */
function _buildLighting(view: ConfiguratorView) {
    const presetBox = byId('lighting-presets');
    if (presetBox) {
        LIGHTING_PRESETS.forEach((p, i) => {
            const pill = document.createElement('button');
            pill.className = 'pill' + (i === 0 ? ' active' : '');
            pill.dataset.i18n = p.key;
            pill.textContent = t(p.key);
            pill.addEventListener('click', () => {
                view.applyLightingPreset(p.id);
                presetBox.querySelectorAll('.pill').forEach((el) => el.classList.remove('active'));
                pill.classList.add('active');
                _syncPresetSliders(p.id);
            });
            presetBox.appendChild(pill);
        });
    }

    _wireSlider('env-intensity', 'env-int-val', (v) => v.toFixed(2), (v) => view.setEnvIntensity(v));
    _wireSlider('env-rotation', 'env-rot-val', (v) => `${Math.round(v)}°`, (v) => view.setEnvRotation((v * Math.PI) / 180));
    _wireSlider('key-intensity', 'key-int-val', (v) => v.toFixed(2), (v) => view.setKeyLightIntensity(v));
    _wireSlider('key-temp', 'key-temp-val', (v) => `${Math.round(v)}K`, (v) => view.setKeyLightTemperature(v));
}

/** 背景 pills */
function _buildBackgrounds(view: ConfiguratorView) {
    const container = byId('backgrounds');
    if (!container) return;
    BACKGROUNDS.forEach((b, i) => {
        const pill = document.createElement('button');
        pill.className = 'pill' + (i === 0 ? ' active' : '');
        pill.dataset.i18n = b.key;
        pill.textContent = t(b.key);
        pill.addEventListener('click', () => {
            view.setBackgroundMode(b.id as 'studio' | 'dark' | 'white' | 'gradient');
            container.querySelectorAll('.pill').forEach((el) => el.classList.remove('active'));
            pill.classList.add('active');
        });
        container.appendChild(pill);
    });
}

/** 自動旋轉開關與重置視角 */
function _wireControls(view: ConfiguratorView) {
    const autoBtn = byId<HTMLButtonElement>('autorotate');
    if (autoBtn) {
        let autoOn = true;
        autoBtn.addEventListener('click', () => {
            autoOn = !autoOn;
            view.setAutoRotate(autoOn);
            autoBtn.classList.toggle('on', autoOn);
        });
    }
    byId('reset')?.addEventListener('click', () => view.resetView());
}

/** 綁定單一滑桿：更新數值標籤並回呼 */
function _wireSlider(inputId: string, valId: string, fmt: (v: number) => string, onChange: (v: number) => void) {
    const input = byId<HTMLInputElement>(inputId);
    const val = byId(valId);
    if (!input) return;
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (val) val.textContent = fmt(v);
        onChange(v);
    });
}

/** 打光 preset 連動更新滑桿顯示（強度/旋轉維持現值） */
function _syncPresetSliders(presetId: string) {
    const map: Record<string, { env: number; key: number }> = {
        soft: { env: 1.1, key: 2.2 },
        dramatic: { env: 0.45, key: 3.6 },
        ecom: { env: 1.7, key: 2.0 },
    };
    const p = map[presetId];
    if (!p) return;
    _setSlider('env-intensity', 'env-int-val', p.env, (v) => v.toFixed(2));
    _setSlider('key-intensity', 'key-int-val', p.key, (v) => v.toFixed(2));
}

function _setSlider(inputId: string, valId: string, value: number, fmt: (v: number) => string) {
    const input = byId<HTMLInputElement>(inputId);
    if (input) input.value = String(value);
    const val = byId(valId);
    if (val) val.textContent = fmt(value);
}

/** 依 id 同步 pill 群組的 active 狀態 */
function _syncActive(containerId: string, activeId: string) {
    const container = byId(containerId);
    if (!container) return;
    container.querySelectorAll('.pill').forEach((el) => {
        const id = (el as HTMLElement).dataset.id;
        el.classList.toggle('active', id === activeId);
    });
}

/** 依 id 同步色塊群組的 active 狀態 */
function _syncActiveSwatch(containerId: string, activeId: string) {
    const container = byId(containerId);
    if (!container) return;
    container.querySelectorAll('.swatch').forEach((el) => {
        const id = (el as HTMLElement).dataset.id;
        el.classList.toggle('active', id === activeId);
    });
}
