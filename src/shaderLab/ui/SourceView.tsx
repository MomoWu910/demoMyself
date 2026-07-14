import { useLabStore } from '../store';
import { getEffect } from '../effects';
import { useT } from './useT';

const KEYWORDS =
    'fn|let|var|const|struct|return|if|else|for|while|discard|uniform|in|out|void|precision|highp|mediump|lowp';
// 不寫 vec3<f32> 這種完整型別：escape 之後尖括號已變成實體，比對不到。
// 拆成 vec3 與 f32 兩個 token 分別上色，結果是一樣的。
const TYPES =
    'float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|sampler2D|f32|i32|u32|texture_2d|sampler';
const BUILTINS =
    'texture|textureSample|mix|smoothstep|clamp|fract|floor|sin|cos|dot|normalize|length|pow|abs|min|max|step';

// escape 只動 & < >，不會影響下面這些 pattern，所以可以先 escape 再上色
const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = new RegExp(
    [
        '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1 註解
        '(@[a-zA-Z_]+)', // 2 WGSL attribute
        `\\b(${KEYWORDS})\\b`, // 3 關鍵字
        `\\b(${TYPES})\\b`, // 4 型別
        `\\b(${BUILTINS})\\b(?=\\s*\\()`, // 5 內建函式
        '\\b(\\d+\\.?\\d*)\\b', // 6 數字
    ].join('|'),
    'g',
);

const CLASS = ['cmt', 'attr', 'kw', 'ty', 'fn', 'num'];

function highlight(code: string): string {
    return escapeHtml(code).replace(TOKEN, (match, ...groups) => {
        const i = groups.slice(0, CLASS.length).findIndex((g) => g !== undefined);
        return i === -1 ? match : `<span class="${CLASS[i]}">${match}</span>`;
    });
}

/**
 * 同一個效果的兩份原始碼並列可切。
 * 這個 Lab 的主張就是「同一個效果，GLSL 與 WGSL 各寫一份、逐像素一致」——
 * 所以原始碼是內容本身，不是附錄。
 */
export function SourceView() {
    const t = useT();
    const effectId = useLabStore((s) => s.effectId);
    const tab = useLabStore((s) => s.sourceTab);
    const setSourceTab = useLabStore((s) => s.setSourceTab);

    const def = getEffect(effectId);
    const code = def.sources[tab];

    return (
        <section className="source">
            <div className="source-head">
                <h2>{t('shader.panel.source')}</h2>
                <div className="tabs">
                    <button
                        className={tab === 'glsl' ? 'active' : ''}
                        onClick={() => setSourceTab('glsl')}
                    >
                        GLSL
                    </button>
                    <button
                        className={tab === 'wgsl' ? 'active' : ''}
                        onClick={() => setSourceTab('wgsl')}
                    >
                        WGSL
                    </button>
                </div>
            </div>
            <p className="source-note">
                {t(tab === 'glsl' ? 'shader.source.glslNote' : 'shader.source.wgslNote')}
            </p>
            <pre className="code">
                <code dangerouslySetInnerHTML={{ __html: highlight(code.trim()) }} />
            </pre>
        </section>
    );
}
