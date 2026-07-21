import { useEffect, useRef, useState } from 'react';
import { currentHour, isOverridden, onSkyChange, realHour, setHourOverride } from '../graph/sky';

/**
 * 時刻軸——右下角那顆小小的天體。
 *
 * 平常只是一個圖示（月／晨／日／夕），把「這面水映的是現在幾點的天空」這件事講出來：
 * 不放任何東西的話，白天來的人根本不會知道還有夜晚版。hover 才長出可以撥的軌道，
 * 所以它在不被理會時幾乎不佔視覺份量，被理會時才是個玩具。
 *
 * 撥過之後就停在使用者選的時刻（不自動滑回），軌道上留一個「現在」的刻度，點它交還給真實時鐘。
 */

/** 圖示切換的時刻。跟 sky.ts 的 keyframe 對齊，但這裡是給人看的分段，不必跟明度門檻一致。 */
function phaseOf(h: number): 'night' | 'dawn' | 'day' | 'dusk' {
    if (h >= 5 && h < 7.8) return 'dawn';
    if (h >= 7.8 && h < 16.2) return 'day';
    if (h >= 16.2 && h < 19.6) return 'dusk';
    return 'night';
}

function PhaseIcon({ phase }: { phase: ReturnType<typeof phaseOf> }) {
    // 全部畫在 24×24、用 currentColor，才能跟著天色翻面
    if (phase === 'night') {
        return (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                    d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }
    if (phase === 'day') {
        return (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" />
                    <path d="M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
                </g>
            </svg>
        );
    }
    // 晨／夕共用「半個太陽壓在地平線上」，差別在箭頭朝上還是朝下
    const up = phase === 'dawn';
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none">
                <path d="M6.6 15.4a5.4 5.4 0 0 1 10.8 0" />
                <path d="M2.6 18.6h18.8" />
                <path d="M12 3.2v4.4" />
                {up ? <path d="M9.8 5.4L12 3.2l2.2 2.2" /> : <path d="M9.8 5.4L12 7.6l2.2-2.2" />}
            </g>
        </svg>
    );
}

const fmt = (h: number): string => {
    const hh = Math.floor(((h % 24) + 24) % 24);
    const mm = Math.floor((((h % 24) + 24) % 24 - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export function SkyDial() {
    const [hour, setHour] = useState(currentHour);
    const [open, setOpen] = useState(false);
    const [overridden, setOverridden] = useState(isOverridden);
    const trackRef = useRef<HTMLDivElement>(null);

    // 天色由 sky.ts 統一廣播：ticker 每分鐘的重查會走到這裡，圖示才會跟著真實時間慢慢換
    useEffect(() => onSkyChange(() => {
        setHour(currentHour());
        setOverridden(isOverridden());
    }), []);

    const seek = (clientX: number): void => {
        const el = trackRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
        setHourOverride(p * 24);
    };

    const phase = phaseOf(hour);
    const now = realHour();

    return (
        <div
            className={`sky-dial${open ? ' open' : ''}`}
            onPointerEnter={() => setOpen(true)}
            onPointerLeave={() => setOpen(false)}
        >
            <div
                className="dial-track"
                ref={trackRef}
                role="slider"
                aria-label="Time of day"
                aria-valuemin={0}
                aria-valuemax={24}
                aria-valuenow={Math.round(hour * 10) / 10}
                aria-valuetext={fmt(hour)}
                tabIndex={0}
                onPointerDown={(e) => {
                    // 指標捕捉：拖出軌道範圍外也還收得到 move，放開才結束
                    e.currentTarget.setPointerCapture(e.pointerId);
                    seek(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e.clientX);
                }}
                onKeyDown={(e) => {
                    // 鍵盤也要能撥——它是 slider，不是只給滑鼠玩的裝飾
                    if (e.key === 'ArrowLeft') setHourOverride((hour - 0.5 + 24) % 24);
                    else if (e.key === 'ArrowRight') setHourOverride((hour + 0.5) % 24);
                    else if (e.key === 'Escape') setHourOverride(null);
                    else return;
                    e.preventDefault();
                }}
            >
                <span className="dial-fill" style={{ width: `${(hour / 24) * 100}%` }} />
                {/* 真實時刻的刻度：撥走之後靠它找回來 */}
                {overridden && (
                    <button
                        className="dial-now"
                        style={{ left: `${(now / 24) * 100}%` }}
                        title="回到現在"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setHourOverride(null)}
                    />
                )}
            </div>
            <span className="dial-time">{fmt(hour)}</span>
            <span className="dial-icon" title={fmt(hour)}>
                <PhaseIcon phase={phase} />
            </span>
        </div>
    );
}
