import './style.css';
import { createRoot } from 'react-dom/client';
import { initI18n } from '../i18n';
import { mountReveal } from '../shell/reveal';
import { wireBack } from '../shell/backNav';
import { mountStage } from './stage';
import { Panel } from './ui/Panel';

mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開
wireBack(document.querySelector('.back')); // 返回回到實際來源頁（首頁或 hub），不寫死

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
