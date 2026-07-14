import './style.css';
import { createRoot } from 'react-dom/client';
import { initI18n } from '../i18n';
import { mountStage } from './stage';
import { Panel } from './ui/Panel';

/**
 * Shader Lab 的組裝點。
 *
 * 分工是刻意的：**React 管 canvas 外的 UI，Pixi 管 canvas 內的世界**，
 * 兩邊只透過一個 Zustand store 溝通（面板寫參數，舞台每幀讀）。
 * React 完全不參與 render loop——60 fps 的東西不該經過 virtual DOM。
 */
initI18n({ parent: document.getElementById('lang-slot') as HTMLElement });

createRoot(document.getElementById('panel-root') as HTMLElement).render(<Panel />);

void mountStage(document.getElementById('stage') as HTMLElement);
