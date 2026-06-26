// src/pixi/optimization/DescriptionPanel.ts
import { t, onLangChange } from '../../../i18n';

// testCase → i18n key 前綴
const KEY_MAP: Record<string, string> = {
    'Tint vs Filter': 'opt.tintFilter',
    'Text vs Bitmap': 'opt.textBitmap',
    'Sprite vs Graphics': 'opt.spriteGraphics',
};

export function createDescriptionPanel() {
    const infoBox = document.createElement('div');
    Object.assign(infoBox.style, {
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        width: '300px',
        padding: '15px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#eee',
        fontFamily: '"Segoe UI", sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
        borderRadius: '8px',
        pointerEvents: 'none',
        borderLeft: '4px solid #00d2ff',
        boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
        transition: 'border-color 0.3s',
    });
    document.body.appendChild(infoBox);

    let last: { testCase: string; isOptimized: boolean } | null = null;

    const render = () => {
        if (!last) {
            infoBox.innerHTML = t('opt.select');
            return;
        }
        infoBox.style.borderLeft = last.isOptimized ? '4px solid #00d2ff' : '4px solid #ff5555';
        const base = KEY_MAP[last.testCase];
        infoBox.innerHTML = base ? t(`${base}.${last.isOptimized ? 'optimized' : 'naive'}`) : t('opt.select');
    };

    onLangChange(render);

    return {
        update: (testCase: string, isOptimized: boolean) => {
            last = { testCase, isOptimized };
            render();
        },
        destroy: () => {
            infoBox.remove();
        },
    };
}
