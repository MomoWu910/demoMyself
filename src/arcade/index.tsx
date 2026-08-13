import './style.css';
import { createRoot } from 'react-dom/client';
import { initI18n } from '../i18n';
import { mountReveal } from '../shell/reveal';
import { mountArcade } from './core/stage';
import { Hud } from './ui/Hud';

/**
 * 遊樂場的組裝點。
 *
 * 分工同 Shader Lab：**React 管 canvas 外的 UI，Pixi 管 canvas 內的世界**，
 * 兩邊只透過 store 溝通。差別在這一頁 canvas 裡的東西是**會整批換掉的**——
 * 玩法之間切換時，舊玩法的所有資源要能還乾淨（見 core/module.ts）。
 */
mountReveal(); // 從首頁 render graph zoom 進來時，從同色淡出揭開

initI18n({ parent: document.getElementById('lang-slot') as HTMLElement });

createRoot(document.getElementById('hud-root') as HTMLElement).render(<Hud />);

void mountArcade(document.getElementById('stage') as HTMLElement);
