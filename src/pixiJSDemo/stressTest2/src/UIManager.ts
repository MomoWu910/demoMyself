import GUI from 'lil-gui';
import { t, onLangChange, mountLangToggle } from '../../../i18n';

export class UIManager {
    private gui: GUI;
    private backBtn!: HTMLAnchorElement;
    private ctrls: { c: { name(s: string): unknown }; key: string }[] = [];
    private folders: { f: { title(s: string): unknown }; key: string }[] = [];
    private params: {
        count: number;
        renderer: string;
        actualRenderer: string;
        addAmount: number;
        add: () => void;
        reset: () => void;
    };

    constructor(
        initialRenderer: string,
        actualRenderer: string,
        onAddShibas: (amount: number) => void,
        onReset: () => void,
        onRendererChange: (renderer: string) => void
    ) {
        this.params = {
            count: 0,
            renderer: initialRenderer,
            actualRenderer: actualRenderer,
            addAmount: 5000,
            add: () => onAddShibas(this.params.addAmount),
            reset: onReset
        };

        this.gui = new GUI({ title: 'PixiJS v8 Benchmark' });
        this.createGUI(onRendererChange);
        this.createBackButton();
        onLangChange(() => this.applyLang());
    }

    private applyLang() {
        this.backBtn.innerText = t('nav.backFindings');
        this.ctrls.forEach(({ c, key }) => c.name(t(key)));
        this.folders.forEach(({ f, key }) => f.title(t(key)));
    }

    private createGUI(onRendererChange: (renderer: string) => void) {
        // Info Folder
        const folderInfo = this.gui.addFolder(t('gui.folder.info'));
        const cBackend = folderInfo.add(this.params, 'actualRenderer').name(t('gui.backend')).disable().listen();
        const cCount = folderInfo.add(this.params, 'count').name(t('gui.objectCount')).listen().disable();
        folderInfo.open();

        // Actions Folder
        const folderAction = this.gui.addFolder(t('gui.folder.actions'));
        const cStep = folderAction.add(this.params, 'addAmount', 1000, 10000, 1000).name(t('gui.stepSize'));
        const cAdd = folderAction.add(this.params, 'add').name(t('gui.addShibas'));
        const cReset = folderAction.add(this.params, 'reset').name(t('gui.reset'));
        folderAction.open();

        // System Folder
        const folderSystem = this.gui.addFolder(t('gui.folder.system'));
        const cRenderer = folderSystem.add(this.params, 'renderer', ['webgpu', 'webgl'])
            .name(t('gui.changeRenderer'))
            .onChange((v: string) => onRendererChange(v));

        this.ctrls = [
            { c: cBackend, key: 'gui.backend' },
            { c: cCount, key: 'gui.objectCount' },
            { c: cStep, key: 'gui.stepSize' },
            { c: cAdd, key: 'gui.addShibas' },
            { c: cReset, key: 'gui.reset' },
            { c: cRenderer, key: 'gui.changeRenderer' },
        ];
        this.folders = [
            { f: folderInfo, key: 'gui.folder.info' },
            { f: folderAction, key: 'gui.folder.actions' },
            { f: folderSystem, key: 'gui.folder.system' },
        ];
    }

    private createBackButton() {
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
            transition: 'background 0.3s',
            zIndex: '100'
        });
        document.body.appendChild(backBtn);

        // 語言切換鈕：放在 back 右側（右上角為 lil-gui）
        mountLangToggle({ style: { top: '55px', left: '110px' } });
    }

    public updateCount(count: number) {
        this.params.count = count;
    }
}
