import GUI from 'lil-gui';
import { ColorMatrixFilter, Container } from 'pixi.js';

export class UIManager {
    private onAddShibas: (count: number) => void;
    private onFilterChange: (enable: boolean) => void;
    private settings: {
        enableFilter: boolean;
        shibaCount: number;
        addShibas: (count: number) => void;
    };
    private gui: GUI;

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
    }

    private createUI() {
        // Back Button
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
             transition: 'background 0.3s'
        });
        backBtn.onmouseenter = () => backBtn.style.background = 'rgba(0,0,0,0.5)';
        backBtn.onmouseleave = () => backBtn.style.background = 'rgba(0,0,0,0.3)';

        document.body.appendChild(backBtn);
    }

    private createGUI() {
        const urlParams = new URLSearchParams(window.location.search);
        const useWebGPU = urlParams.get('preference') === 'webgpu';

        // Add WebGPU toggle
        const engineSettings = { useWebGPU };
        this.gui.add(engineSettings, 'useWebGPU')
            .name('Use WebGPU ⚡')
            .onChange((value: boolean) => {
                const params = new URLSearchParams(window.location.search);
                params.set('preference', value ? 'webgpu' : 'webgl');
                window.location.search = params.toString();
            });

        this.gui.add(this.settings, 'enableFilter')
            .name('Enable Filter (B&W)')
            .onChange((value: boolean) => {
                this.onFilterChange(value);
            });
        
        this.gui.add(this.settings, 'shibaCount')
            .name('Shiba Count')
            .listen()
            .disable();
            
        this.gui.add(this.settings, 'addShibas')
            .name('Add 100 Shibas 🐕');
    }

    public updateShibaCount(count: number) {
        this.settings.shibaCount = count;
    }
}
