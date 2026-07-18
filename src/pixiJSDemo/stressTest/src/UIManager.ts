import GUI from 'lil-gui';
import { ColorMatrixFilter, Container } from 'pixi.js';
import { t, onLangChange, mountLangToggle } from '../../../i18n';
import { wireGoBack } from '../../../shell/goBack';

export class UIManager {
    private onAddShibas: (count: number) => void;
    private onFilterChange: (enable: boolean) => void;
    private settings: {
        enableFilter: boolean;
        shibaCount: number;
        addShibas: (count: number) => void;
    };
    private gui: GUI;
    private backBtn!: HTMLAnchorElement;
    private ctrls: { c: { name(s: string): unknown }; key: string }[] = [];

    constructor(
        onAddShibas: (count: number) => void,
        onFilterChange: (enable: boolean) => void
    ) {
        this.onAddShibas = onAddShibas;
        this.onFilterChange = onFilterChange;

        this.settings = {
            enableFilter: false,
            shibaCount: 0,
            addShibas: () => this.onAddShibas(100)
        };

        this.gui = new GUI();
        this.createUI();
        this.createGUI();
        onLangChange(() => this.applyLang());
    }

    private applyLang() {
        this.backBtn.innerText = t('nav.backFindings');
        this.ctrls.forEach(({ c, key }) => c.name(t(key)));
    }

    private createUI() {
        // Back Button
        const backBtn = document.createElement('a');
        this.backBtn = backBtn;
        backBtn.innerText = t('nav.backFindings');
        backBtn.href = './findings.html'; // 壓測是「實驗結論」底下的實驗，返回回 Findings
        Object.assign(backBtn.style, {
             position: 'absolute',
             top: '55px',
             left: '20px',
             color: 'white',
             textDecoration: 'none',
             background: 'rgba(0,0,0,0.3)',
             padding: '10px 15px',
             borderRadius: '8px',
             fontFamily: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif',
             backdropFilter: 'blur(5px)',
             transition: 'background 0.3s'
        });
        backBtn.onmouseenter = () => backBtn.style.background = 'rgba(0,0,0,0.5)';
        backBtn.onmouseleave = () => backBtn.style.background = 'rgba(0,0,0,0.3)';

        document.body.appendChild(backBtn);
        wireGoBack(backBtn); // 返回＝回上一頁，不新增歷史紀錄

        // 語言切換鈕：擺在 back 正下方。窄螢幕頂列已被 back + 右上 lil-gui 佔滿，
        // 放右側會撞到其一，改成放下方誰都不撞。
        const langWrap = mountLangToggle({ style: { top: '55px', left: '20px' } });
        const placeLang = () => {
            langWrap.style.left = `${backBtn.offsetLeft}px`;
            langWrap.style.top = `${backBtn.offsetTop + backBtn.offsetHeight + 10}px`;
        };
        placeLang();
        onLangChange(placeLang);
    }

    private createGUI() {
        const urlParams = new URLSearchParams(window.location.search);
        const useWebGPU = urlParams.get('preference') === 'webgpu';

        // Add WebGPU toggle
        const engineSettings = { useWebGPU };
        const cWebGPU = this.gui.add(engineSettings, 'useWebGPU')
            .name(t('gui.useWebGPU'))
            .onChange((value: boolean) => {
                const params = new URLSearchParams(window.location.search);
                params.set('preference', value ? 'webgpu' : 'webgl');
                window.location.search = params.toString();
            });

        const cFilter = this.gui.add(this.settings, 'enableFilter')
            .name(t('gui.enableFilter'))
            .onChange((value: boolean) => {
                this.onFilterChange(value);
            });

        const cCount = this.gui.add(this.settings, 'shibaCount')
            .name(t('gui.shibaCount'))
            .listen()
            .disable();

        const cAdd = this.gui.add(this.settings, 'addShibas')
            .name(t('gui.add100'));

        this.ctrls = [
            { c: cWebGPU, key: 'gui.useWebGPU' },
            { c: cFilter, key: 'gui.enableFilter' },
            { c: cCount, key: 'gui.shibaCount' },
            { c: cAdd, key: 'gui.add100' },
        ];
    }

    public updateShibaCount(count: number) {
        this.settings.shibaCount = count;
    }
}
