import { ConfiguratorView } from './configuratorView';

// 各材質變體對應的色塊顏色（球鞋模型內建 midnight / beach / street）
const VARIANT_SWATCH: Record<string, string> = {
    midnight: '#2a3550',
    beach: '#d8b98a',
    street: '#9aa0a6',
};

window.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const view = new ConfiguratorView(canvas);

    const { variants, activeVariant } = await view.init();
    view.run();

    _buildSwatches(view, variants, activeVariant);
    _wireControls(view);

    // 模型就緒，淡出載入畫面、顯示控制面板
    document.getElementById('panel')!.style.display = 'flex';
    document.getElementById('loading')!.classList.add('hidden');
});

/**
 * 依模型可用變體動態建立色塊按鈕
 */
function _buildSwatches(view: ConfiguratorView, variants: string[], active: string) {
    const container = document.getElementById('swatches')!;
    container.innerHTML = '';

    variants.forEach((name) => {
        const swatch = document.createElement('div');
        swatch.className = 'swatch' + (name === active ? ' active' : '');
        swatch.style.background = VARIANT_SWATCH[name.toLowerCase()] ?? '#888';
        swatch.title = name;

        const label = document.createElement('span');
        label.textContent = name;
        swatch.appendChild(label);

        swatch.addEventListener('click', () => {
            view.selectVariant(name);
            container.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
            swatch.classList.add('active');
        });

        container.appendChild(swatch);
    });
}

/**
 * 綁定自動旋轉開關與重置視角
 */
function _wireControls(view: ConfiguratorView) {
    const autoBtn = document.getElementById('autorotate') as HTMLButtonElement;
    let autoOn = true;
    autoBtn.addEventListener('click', () => {
        autoOn = !autoOn;
        view.setAutoRotate(autoOn);
        autoBtn.classList.toggle('on', autoOn);
    });

    document.getElementById('reset')!.addEventListener('click', () => view.resetView());
}
