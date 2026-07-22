import type { CfgSelection } from './store';

/**
 * 把配置器畫面存成 PNG 檔。
 *
 * 「拍」那一步在 ConfiguratorView.captureScreenshot（它才碰得到 engine 與 canvas），
 * 這裡只負責「存成一個對人有意義的檔案」——檔名與下載。分開的理由是這一半完全不
 * 依賴 3D：換成把 data URL 丟去後端、或貼進剪貼簿，動的都只有這個檔。
 */

/**
 * 依目前設定組出檔名，例如 `shoe-midnight-metallic-crimson-side.png`。
 *
 * 匯出通常一次好幾張要拿去比對，全部叫 screenshot(3).png 的話下載夾裡誰是誰完全分不出來。
 * 檔名帶設定就等於自帶標籤——這也是為什麼寧可長一點也不用時間戳。
 */
export function screenshotFilename(s: CfgSelection): string {
    const part = s.partState[s.currentPart];
    const bits = [
        'shoe',
        s.variant,
        part?.finishId !== 'original' ? part?.finishId : '',
        part?.tintId !== 'none' ? part?.tintId : '',
        s.background,
        s.cameraView !== 'free' ? s.cameraView : '',
    ].filter(Boolean);
    return `${bits.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '')}.png`;
}

/** 觸發瀏覽器下載。data URL 直接掛在 <a download> 上即可，不必繞 Blob。 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
