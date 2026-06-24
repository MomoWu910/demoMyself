import GUI from 'lil-gui';

export class UIManager {
    private gui: GUI;
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
    }

    private createGUI(onRendererChange: (renderer: string) => void) {
        // Info Folder
        const folderInfo = this.gui.addFolder('Info');
        folderInfo.add(this.params, 'actualRenderer').name('Backend').disable().listen();
        folderInfo.add(this.params, 'count').name('Object Count').listen().disable();
        folderInfo.open();

        // Actions Folder
        const folderAction = this.gui.addFolder('Actions');
        folderAction.add(this.params, 'addAmount', 1000, 10000, 1000).name('Step Size');
        folderAction.add(this.params, 'add').name('Add Shibas 🐕');
        folderAction.add(this.params, 'reset').name('Reset 🗑️');
        folderAction.open();

        // System Folder
        const folderSystem = this.gui.addFolder('System');
        folderSystem.add(this.params, 'renderer', ['webgpu', 'webgl'])
            .name('Change Renderer')
            .onChange((v: string) => onRendererChange(v));
    }

    private createBackButton() {
        const backBtn = document.createElement('a');
        backBtn.innerText = '← Back';
        backBtn.href = './pixi_hub.html';
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
    }

    public updateCount(count: number) {
        this.params.count = count;
    }
}
