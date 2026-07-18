import './style.css';
import { createRoot } from 'react-dom/client';
import { initI18n } from '../i18n';
import { mountGraph } from './graph/scene';
import { Shell } from './ui/Shell';

/**
 * 首頁的組裝點——一張「活的 render graph」。
 *
 * 分工跟 Shader Lab 同一套：**React 管 canvas 外的殼（wordmark / inspector / 圖例），
 * Pixi 管 canvas 內的世界（光場 / 節點 / 資源流動）**，兩邊只透過一個 Zustand store 溝通。
 * React 不參與 render loop——60fps 的東西不該經過 virtual DOM。
 */
initI18n({ parent: document.getElementById('lang-slot') as HTMLElement });

createRoot(document.getElementById('overlay-root') as HTMLElement).render(<Shell />);

void mountGraph(document.getElementById('field-stage') as HTMLElement);
