// src/pixi/optimization/DescriptionPanel.ts

// 定義說明文字資料庫
const descriptions: Record<string, { naive: string, optimized: string }> = {
    'Tint vs Filter': {
        naive: `
            <strong style="color:#ff5555">🔴 Naive (Filters)</strong><br>
            每個物件都掛載獨立的 ColorMatrixFilter。<br>
            <span style="color:#aaa">• 打斷 Batching (合批失效)</span><br>
            <span style="color:#aaa">• 增加 Render Pass 切換成本</span><br>
            <span style="color:#aaa">• 容易導致 UBO 記憶體溢出</span>
        `,
        optimized: `
            <strong style="color:#00d2ff">🟢 Optimized (Tint)</strong><br>
            使用 Sprite.tint 修改頂點顏色屬性。<br>
            <span style="color:#aaa">• 完美合批 (Batching)</span><br>
            <span style="color:#aaa">• 零 GPU 額外負擔</span><br>
            <span style="color:#aaa">• 適合做受傷、變色等效果</span>
        `
    },
    'Text vs Bitmap': {
        naive: `
            <strong style="color:#ff5555">🔴 Naive (PIXI.Text)</strong><br>
            每幀更新文字內容。<br>
            <span style="color:#aaa">• 觸發 Canvas 2D 重繪</span><br>
            <span style="color:#aaa">• 觸發 Texture 上傳 (頻寬殺手)</span><br>
            <span style="color:#aaa">• 極度消耗 CPU 與記憶體</span>
        `,
        optimized: `
            <strong style="color:#00d2ff">🟢 Optimized (BitmapText)</strong><br>
            使用預先生成的字型圖集 (Atlas)。<br>
            <span style="color:#aaa">• 渲染方式等同於 Sprite</span><br>
            <span style="color:#aaa">• 零 Canvas 重繪成本</span><br>
            <span style="color:#aaa">• 適合分數、計時器等高頻變動文字</span>
        `
    },
    'Sprite vs Graphics': {
        naive: `
            <strong style="color:#ff5555">🔴 Naive (Graphics)</strong><br>
            每幀執行 clear() 與 drawCircle() 重畫。<br>
            <span style="color:#aaa">• CPU 需重新計算幾何 (Tessellation)</span><br>
            <span style="color:#aaa">• 無法合批 (每個 Graphics 都是獨立的)</span><br>
            <span style="color:#aaa">• 動態圖形的效能殺手</span>
        `,
        optimized: `
            <strong style="color:#00d2ff">🟢 Optimized (Texture)</strong><br>
            預先將 Graphics 轉為 Texture。<br>
            <span style="color:#aaa">• 僅更新 Scale/Transform (GPU 處理)</span><br>
            <span style="color:#aaa">• CPU 負擔幾乎為零</span><br>
            <span style="color:#aaa">• 適合粒子、血條等重複圖形</span>
        `
    }
};

export function createDescriptionPanel() {
    // 1. 建立 DOM
    const infoBox = document.createElement('div');
    
    // 2. 設定樣式
    Object.assign(infoBox.style, {
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        width: '300px',
        padding: '15px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#eee',
        fontFamily: '"Segoe UI", sans-serif',
        fontSize: '14px',
        lineHeight: '1.5',
        borderRadius: '8px',
        pointerEvents: 'none',
        borderLeft: '4px solid #00d2ff',
        boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
        transition: 'border-color 0.3s' // 增加一點轉場動畫
    });

    document.body.appendChild(infoBox);

    // 3. 回傳更新介面
    return {
        update: (testCase: string, isOptimized: boolean) => {
            const modeKey = isOptimized ? 'optimized' : 'naive';
            
            // 切換邊框顏色
            infoBox.style.borderLeft = isOptimized ? '4px solid #00d2ff' : '4px solid #ff5555';
            
            // 更新 HTML 內容
            if (descriptions[testCase]) {
                infoBox.innerHTML = descriptions[testCase][modeKey];
            } else {
                infoBox.innerHTML = 'Select a test scenario...';
            }
        },
        destroy: () => {
            if (infoBox.parentNode) {
                infoBox.parentNode.removeChild(infoBox);
            }
        }
    };
}