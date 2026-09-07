import './style.css';
import { createRoot } from 'react-dom/client';
import { initI18n } from '../i18n';
import { mountReveal } from '../shell/reveal';
import { mountArcade } from './core/stage';
import { bootstrapServerData } from './server/bootstrap';
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

/**
 * **資料層要先灌完才能讓玩家下注。**
 *
 * 注單表的讀取是同步的（記憶體快取），而快取要等 IndexedDB 讀完才有內容。
 * 在那之前下注的話，`record()` 會拿一個空陣列接上新注單再整張寫回去——
 * 歷史注單就沒了（見 server/bootstrap.ts）。
 *
 * 揭幕動畫與 i18n 不等它：那兩件事跟資料無關，
 * **能先畫的就先畫**，不要為了一個背景讀取讓整頁停在空白。
 */
void bootstrapServerData().then(() => {
    createRoot(document.getElementById('hud-root') as HTMLElement).render(<Hud />);
    void mountArcade(document.getElementById('stage') as HTMLElement);
});
