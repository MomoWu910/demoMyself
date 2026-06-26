import './style.css';
import { initI18n, mountLangToggle } from '../../i18n';

// 套用翻譯（不在此掛預設切換鈕，改插入導覽列的 #lang-slot）
initI18n();
const slot = document.getElementById('lang-slot');
if (slot) mountLangToggle({ parent: slot });
