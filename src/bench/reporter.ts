import { round } from './env';
import type { BenchReport, BenchResult } from './types';

/**
 * 把結果算成「相對基準線的倍數」。
 *
 * 這是整份報表最有價值的一欄：絕對毫秒數換一台機器就變了，
 * 但「optimized 比 naive 省幾倍 CPU」在不同硬體上是穩定的，才是可以拿去做技術決策的結論。
 * 配對規則：同 meta.scenario 之下，以 meta.mode === 'Naive' 的案例為基準。
 */
export function withSpeedup(results: BenchResult[]): Array<BenchResult & { speedup: number | null }> {
    const baselines = new Map<string, number>();
    for (const r of results) {
        if (r.meta?.mode === 'Naive' && r.meta?.scenario) {
            baselines.set(String(r.meta.scenario), r.cpuMs.median);
        }
    }
    return results.map((r) => {
        const base = r.meta?.scenario ? baselines.get(String(r.meta.scenario)) : undefined;
        const speedup = base && r.cpuMs.median > 0 ? round(base / r.cpuMs.median, 1) : null;
        return { ...r, speedup };
    });
}

export function toMarkdown(report: BenchReport): string {
    const { env, config } = report;
    const rows = withSpeedup(report.results);

    const head = [
        `## PixiJS Optimization Lab — Benchmark`,
        ``,
        `| | |`,
        `|---|---|`,
        `| Renderer | \`${env.renderer}\` |`,
        `| GPU | ${env.gpu} |`,
        `| Viewport / DPR | ${env.viewport} @ ${env.dpr}x |`,
        `| Display | ${env.refreshHz} Hz |`,
        `| Sampling | ${config.warmupFrames} warm-up + ${config.sampleFrames} sampled frames |`,
        `| Date | ${env.timestamp} |`,
        ``,
        `> CPU frame time = case update + \`renderer.render()\`. GPU rasterisation time is not measurable from the browser and is not reported.`,
        ``,
        `| Scenario | Mode | Objects | CPU median (ms) | p95 (ms) | FPS | Draw calls | vs Naive |`,
        `|---|---|---:|---:|---:|---:|---:|---:|`,
    ];

    const body = rows.map((r) => {
        const scenario = r.meta?.scenario ?? '—';
        const mode = r.meta?.mode ?? '—';
        const draws = r.drawCalls === null ? 'n/a¹' : String(r.drawCalls);
        const speed = r.speedup === null ? '—' : r.speedup === 1 ? 'baseline' : `**${r.speedup}×**`;
        return `| ${scenario} | ${mode} | ${r.objectCount} | ${r.cpuMs.median} | ${r.cpuMs.p95} | ${r.fps} | ${draws} | ${speed} |`;
    });

    const foot = report.results.some((r) => r.drawCalls === null)
        ? ['', `¹ WebGPU 的繪製指令錄在 GPURenderPassEncoder 上，無法以 hook WebGL context 的方式攔截。`]
        : [];

    return [...head, ...body, ...foot].join('\n');
}

/** 結果面板：跑完後蓋在畫面上，可複製 Markdown / 下載 JSON。 */
export class BenchPanel {
    private root: HTMLDivElement;
    private body: HTMLDivElement;

    constructor() {
        this.root = document.createElement('div');
        Object.assign(this.root.style, {
            position: 'fixed',
            inset: '0',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6,8,20,0.72)',
            backdropFilter: 'blur(6px)',
            zIndex: '2000',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            padding: '16px',
            boxSizing: 'border-box',
        } as Partial<CSSStyleDeclaration>);

        this.body = document.createElement('div');
        Object.assign(this.body.style, {
            background: '#11162b',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '14px',
            padding: '20px',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '86vh',
            overflow: 'auto',
            color: '#e8ecff',
            fontSize: '13px',
            boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
        } as Partial<CSSStyleDeclaration>);

        this.root.appendChild(this.body);
        this.root.addEventListener('click', (e) => {
            if (e.target === this.root) this.hide();
        });
        document.body.appendChild(this.root);
    }

    show(): void {
        this.root.style.display = 'flex';
    }

    hide(): void {
        this.root.style.display = 'none';
    }

    progress(done: number, total: number, label: string): void {
        this.show();
        const pct = Math.round((done / total) * 100);
        this.body.innerHTML = `
            <div style="font-size:15px;font-weight:600;margin-bottom:14px">Running benchmark… ${done}/${total}</div>
            <div style="height:6px;border-radius:99px;background:rgba(255,255,255,0.1);overflow:hidden;margin-bottom:12px">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#5b8cff,#a56bff);transition:width .2s"></div>
            </div>
            <div style="opacity:.65">${escapeHtml(label)}</div>
            <div style="opacity:.45;margin-top:18px;font-size:12px">請讓分頁保持在前景——背景分頁會被瀏覽器降頻，量出來的數字沒有意義。</div>
        `;
    }

    results(report: BenchReport): void {
        this.show();
        const rows = withSpeedup(report.results);
        const { env } = report;

        const table = rows
            .map((r) => {
                const speed =
                    r.speedup === null
                        ? '—'
                        : r.speedup === 1
                          ? '<span style="opacity:.5">baseline</span>'
                          : `<b style="color:#7ee2a8">${r.speedup}×</b>`;
                const draws = r.drawCalls === null ? '<span style="opacity:.45">n/a</span>' : r.drawCalls;
                return `<tr>
                    <td style="padding:6px 10px">${escapeHtml(String(r.meta?.scenario ?? '—'))}</td>
                    <td style="padding:6px 10px">${escapeHtml(String(r.meta?.mode ?? '—'))}</td>
                    <td style="padding:6px 10px;text-align:right">${r.objectCount}</td>
                    <td style="padding:6px 10px;text-align:right"><b>${r.cpuMs.median}</b></td>
                    <td style="padding:6px 10px;text-align:right;opacity:.75">${r.cpuMs.p95}</td>
                    <td style="padding:6px 10px;text-align:right;opacity:.75">${r.fps}</td>
                    <td style="padding:6px 10px;text-align:right;opacity:.75">${draws}</td>
                    <td style="padding:6px 10px;text-align:right">${speed}</td>
                </tr>`;
            })
            .join('');

        this.body.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px">
                <div style="font-size:16px;font-weight:600">Benchmark results</div>
                <button id="bench-close" style="background:none;border:1px solid rgba(255,255,255,.2);color:#e8ecff;border-radius:8px;padding:5px 12px;cursor:pointer">Close</button>
            </div>
            <div style="opacity:.6;font-size:12px;line-height:1.7;margin-bottom:16px">
                ${escapeHtml(env.renderer.toUpperCase())} · ${escapeHtml(env.gpu)} · ${env.viewport} @${env.dpr}x · ${env.refreshHz}Hz<br>
                ${report.config.warmupFrames} warm-up + ${report.config.sampleFrames} sampled frames
            </div>
            <div style="overflow-x:auto">
            <table style="border-collapse:collapse;width:100%;font-size:12px;min-width:640px">
                <thead><tr style="text-align:left;opacity:.6;border-bottom:1px solid rgba(255,255,255,.15)">
                    <th style="padding:6px 10px">Scenario</th>
                    <th style="padding:6px 10px">Mode</th>
                    <th style="padding:6px 10px;text-align:right">Objects</th>
                    <th style="padding:6px 10px;text-align:right">CPU ms</th>
                    <th style="padding:6px 10px;text-align:right">p95</th>
                    <th style="padding:6px 10px;text-align:right">FPS</th>
                    <th style="padding:6px 10px;text-align:right">Draws</th>
                    <th style="padding:6px 10px;text-align:right">vs Naive</th>
                </tr></thead>
                <tbody>${table}</tbody>
            </table>
            </div>
            <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
                <button id="bench-md" style="background:#5b8cff;border:none;color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:600">Copy Markdown</button>
                <button id="bench-json" style="background:none;border:1px solid rgba(255,255,255,.2);color:#e8ecff;border-radius:8px;padding:8px 14px;cursor:pointer">Download JSON</button>
            </div>
        `;

        this.body.querySelector('#bench-close')?.addEventListener('click', () => this.hide());

        const mdBtn = this.body.querySelector('#bench-md') as HTMLButtonElement;
        mdBtn?.addEventListener('click', async () => {
            await navigator.clipboard.writeText(toMarkdown(report));
            mdBtn.textContent = 'Copied ✓';
            setTimeout(() => (mdBtn.textContent = 'Copy Markdown'), 1600);
        });

        this.body.querySelector('#bench-json')?.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pixi-bench-${report.env.renderer}-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }
}

function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
