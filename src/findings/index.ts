import './style.css';
import { initI18n, t, onLangChange } from '../i18n';
import { withSpeedup } from '../bench';
import type { BenchReport } from '../bench';
import { REPORTS, FINDINGS } from './data';

const tabsEl = document.getElementById('renderer-tabs') as HTMLDivElement;
const envEl = document.getElementById('env-line') as HTMLDivElement;
const tableEl = document.getElementById('results-table') as HTMLTableElement;
const listEl = document.getElementById('findings-list') as HTMLElement;

let active = 0;

function renderTabs(): void {
    if (REPORTS.length < 2) {
        tabsEl.innerHTML = '';
        return;
    }
    tabsEl.innerHTML = REPORTS.map(
        (r, i) =>
            `<button data-idx="${i}" class="${i === active ? 'active' : ''}">${r.env.renderer.toUpperCase()}</button>`,
    ).join('');
    tabsEl.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
            active = Number((b as HTMLButtonElement).dataset.idx);
            render();
        }),
    );
}

function renderReport(report: BenchReport): void {
    const { env, config } = report;
    envEl.textContent =
        `${env.renderer.toUpperCase()} · ${env.gpu} · ${env.viewport} @${env.dpr}x · ${env.refreshHz}Hz · ` +
        `${config.warmupFrames} warm-up + ${config.sampleFrames} sampled frames · ${env.timestamp.slice(0, 10)}`;

    const rows = withSpeedup(report.results);
    const head = `<thead><tr>
        <th>${t('findings.col.scenario')}</th>
        <th>${t('findings.col.mode')}</th>
        <th class="num">${t('findings.col.objects')}</th>
        <th class="num">${t('findings.col.cpu')}</th>
        <th class="num">p95</th>
        <th class="num">${t('findings.col.fps')}</th>
        <th class="num">${t('findings.col.draws')}</th>
        <th class="num">${t('findings.col.vs')}</th>
    </tr></thead>`;

    const body = rows
        .map((r) => {
            const opt = r.meta?.mode === 'Optimized';
            const draws = r.drawCalls === null ? '<span class="na">n/a</span>' : String(r.drawCalls);
            const speed =
                r.speedup === null || r.speedup === 1
                    ? `<span class="baseline">—</span>`
                    : `<span class="speedup">${r.speedup}×</span>`;
            // 幀率低於 30 標紅：這一列的成本不見得出現在 CPU 欄位裡（見 Finding 04）
            const fps = r.fps < 30 ? `<span class="bad">${r.fps}</span>` : String(r.fps);
            return `<tr class="${opt ? 'optimized' : ''}">
                <td>${r.meta?.scenario ?? '—'}</td>
                <td>${r.meta?.mode ?? '—'}</td>
                <td class="num">${r.objectCount}</td>
                <td class="num"><b>${r.cpuMs.median}</b></td>
                <td class="num">${r.cpuMs.p95}</td>
                <td class="num">${fps}</td>
                <td class="num">${draws}</td>
                <td class="num">${speed}</td>
            </tr>`;
        })
        .join('');

    tableEl.innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderEmpty(): void {
    envEl.textContent = '';
    tableEl.innerHTML = '';
    tableEl.insertAdjacentHTML(
        'afterend',
        `<div class="empty" id="empty-state">${t('findings.data.empty')}</div>`,
    );
}

function renderFindings(): void {
    listEl.innerHTML = FINDINGS.map(
        (f, i) => `
        <article class="finding">
            <div class="finding-num">FINDING ${String(i + 1).padStart(2, '0')}</div>
            <h3>${t(`${f.key}.title`)}</h3>
            <p>${t(`${f.key}.body`)}</p>
            <div class="takeaway">${t(`${f.key}.takeaway`)}</div>
        </article>`,
    ).join('');
}

function render(): void {
    document.getElementById('empty-state')?.remove();
    renderTabs();
    if (REPORTS.length) {
        renderReport(REPORTS[active]);
    } else {
        renderEmpty();
    }
    renderFindings();
}

initI18n({ style: { top: '20px', right: '20px' } });
render();
onLangChange(render);
