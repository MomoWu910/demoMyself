const fs = require('fs');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const pixiTemplate = './src/pixiJSDemo/index.html'; // 建立一個共用模板
const isDev = process.env.NODE_ENV === 'development';
const publicPath = isDev ? '/' : '/demoMyself/';

/**
 * 首屏字體：body 用 Archivo 500、標題 600、數據表用 JetBrains Mono 400。
 * 不 preload 的話，字體要等 CSS 下載並解析完才會被發現，形成 HTML → CSS → woff2 的串接瀑布。
 */
const PRELOAD_FONTS = ['archivo-500', 'archivo-600', 'jetbrains-mono-400'];

/**
 * 注入到有用字體的頁面 <head>（home / shaderLab / findings）。三件事：
 *   1. preload 首屏字體，讓它與 CSS 並行下載
 *   2. 字體就緒前先讓 body 透明（露出 <html> 的底色），就緒後淡入
 *   3. 800ms 保險上限——字體再慢也不會把頁面一直壓著不顯示
 * class 由 JS 加上，所以停用 JS 時 body 本來就是可見的，不會整頁空白。
 * fonts.ready 要等 DOMContentLoaded 之後才問，否則 CSS 尚未解析、字體還沒被發現就會提早 resolve。
 */
const bootHead = [
    ...PRELOAD_FONTS.map(
        (n) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="${publicPath}fonts/${n}.woff2">`
    ),
    '<style>html.shell-boot body{opacity:0}body{transition:opacity .28s ease}'
        + '@media(prefers-reduced-motion:reduce){body{transition:none}}</style>',
    '<script>(function(){var d=document,h=d.documentElement,x=0,t=null;'
        // 從首頁 render graph zoom 進來時，落地色寫在這個 key（見 shell/reveal.ts）。
        // 這裡只讀不清，清除仍由 reveal.ts 負責。
        + 'try{t=sessionStorage.getItem("shell:enterTone")}catch(_){}'
        + 'var p=h.style.backgroundColor;'
        // 遮罩期間就用節點色當底，接住首頁的 zoom；否則會先露出頁面底色而閃一下黑
        + 'if(t){h.style.backgroundColor=t;window.__shellBootTone=1}'
        + 'var e=function(){if(x)return;x=1;h.classList.remove("shell-boot");'
        // body 淡入完成後再還原，避免節點色殘留在捲動超出範圍的地方
        + 'if(t)setTimeout(function(){h.style.backgroundColor=p},320)};'
        + 'h.className+=" shell-boot";setTimeout(e,800);'
        + 'var g=function(){d.fonts&&d.fonts.ready?d.fonts.ready.then(e):e()};'
        + 'd.readyState==="loading"?d.addEventListener("DOMContentLoaded",g):g();'
        // 遮罩還在時就按上一頁離開，bfcache 會把 body:opacity 0 一起存起來，
        // 還原時就成了空白頁。pageshow 無條件解除，確保回上一頁一定看得到內容。
        + 'addEventListener("pageshow",function(v){if(!v.persisted)return;'
        + 'h.classList.remove("shell-boot");if(t)h.style.backgroundColor=p})})();</script>',
].join('');

/**
 * build 時把 i18n 字典載進來（用 esbuild 轉 TS，專案已有這個依賴）。
 * 模組頂層只會呼叫 readLang()，其中的 localStorage 存取包在 try/catch 裡，在 Node 下安全。
 */
function loadDict() {
    const out = require('esbuild').buildSync({
        entryPoints: [path.resolve(__dirname, 'src/i18n/index.ts')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
        logLevel: 'silent',
    });
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
    return mod.exports.DICT;
}
const DICT = loadDict();

/**
 * 語言切換原本要等 bundle 執行（實測約 1.9s）才把 data-i18n 的英文換成中文，
 * 偏好中文的使用者每次都會先看到英文再跳一次。
 *
 * 這裡在 build 時掃出該頁靜態 HTML 用到的 key，只把這幾條中文字串內聯進頁尾腳本，
 * 在解析器讀到 </body> 時就同步換好——早於 deferred bundle，也還在 boot 遮罩蓋著的期間，
 * 所以使用者從第一眼就是中文。bundle 之後照常再 applyDom 一次，值相同不會有變化。
 */
function i18nBootFor(templatePath) {
    const html = fs.readFileSync(path.resolve(__dirname, templatePath), 'utf8');
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-html|-title)?="([^"]+)"/g)) keys.add(m[1]);

    const zh = {};
    for (const k of keys) if (DICT[k]) zh[k] = DICT[k].zh;
    if (!Object.keys(zh).length) return '';

    // JSON 內若出現 </script> 會提早結束腳本區塊，轉義掉
    const json = JSON.stringify(zh).replace(/<\//g, '<\\/');
    return '<script>(function(){var L;try{L=localStorage.getItem("site-lang")}catch(_){}'
        + 'if(L!=="zh")return;var D=' + json + ',d=document;'
        + 'd.documentElement.lang="zh-TW";'
        + 'var q=d.querySelectorAll("[data-i18n],[data-i18n-html],[data-i18n-title]");'
        + 'for(var i=0;i<q.length;i++){var e=q[i],s=e.dataset;'
        + 'if(s.i18n&&D[s.i18n]!=null)e.textContent=D[s.i18n];'
        + 'if(s.i18nHtml&&D[s.i18nHtml]!=null)e.innerHTML=D[s.i18nHtml];'
        + 'if(s.i18nTitle&&D[s.i18nTitle]!=null)e.title=D[s.i18nTitle];}})();</script>';
}

module.exports = {
    mode: isDev ? 'development' : 'production',
    entry: {
        main: './src/home/index.tsx',                            // 入口首頁：React 殼 + Pixi render graph
        configurator: './src/babylonJSDemo/src/configurator/index.ts', // Babylon.js 產品配置器
        pixi_stress: './src/pixiJSDemo/stressTest/index.ts',     // Pixi.js 壓力測試
        pixi_stress2: './src/pixiJSDemo/stressTest2/index.ts',   // Pixi.js 壓力測試2
        pixi_optimization: './src/pixiJSDemo/optimization/index.ts', // Pixi.js 最佳實踐
        pixi_x_three: './src/pixiJSDemo/pixiXthree/index.ts', // Pixi.js X Three.js
        rwd_showcase: './src/rwdShowcase/index.ts',           // RWD 裝置模擬器
        findings: './src/findings/index.ts',                  // 渲染效能實測結論
        shader_lab: './src/shaderLab/index.tsx',              // 自訂 Shader Lab（GLSL + WGSL）＋ React/Zustand 面板
    },
    output: {
        filename: '[name].bundle.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true, // Webpack 5 建議加上這個，每次打包前清空 dist
        // publicPath: process.env.NODE_ENV === 'production' ? '/demoMyself/' : '/'
        publicPath,
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        fallback: {
            fs: false,
            path: false, // ammo.js seems to also use path
        },
        alias: {
            '@res': path.resolve(__dirname, 'res'),
        },
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/, // .tsx：Shader Lab 的控制面板是 React
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.(png|jpe?g|gif|glb|gltf|env|hdr|dds)$/i,
                type: 'asset/resource',
                generator: {
                    filename: 'res/[path][name][ext]', // 保留原始路徑和文件名
                    // filename: `assets/[name].[contenthash][ext]`,
                },
            },
            {
                test: /\.woff2?$/i, // 自 host 字型
                type: 'asset/resource',
                generator: { filename: 'fonts/[name][ext]' },
            },
            {
                // dev 用 style-loader 換 HMR；production 抽成獨立 .css，
                // 由 HtmlWebpackPlugin 注入 <head>，避免樣式套用前先閃一次純文字（FOUC）。
                test: /\.css$/i,
                use: [isDev ? 'style-loader' : MiniCssExtractPlugin.loader, 'css-loader'],
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            filename: 'index.html',
            template: './src/home/index.html',
            chunks: ['main'],
            title: 'Eric Wu - Portfolio',
            templateParameters: { bootHead, i18nBoot: i18nBootFor('./src/home/index.html') },
        }),
        new HtmlWebpackPlugin({
            filename: 'configurator.html',
            template: './src/babylonJSDemo/src/configurator/index.html',
            chunks: ['configurator'],
            title: 'Product Configurator',
            templateParameters: { i18nBoot: i18nBootFor('./src/babylonJSDemo/src/configurator/index.html') },
        }),
        new HtmlWebpackPlugin({
            filename: 'pixi_stress.html',
            template: pixiTemplate,
            chunks: ['pixi_stress'],
            title: 'PixiJS Stress Test',
        }),
        new HtmlWebpackPlugin({
            filename: 'pixi_stress2.html',
            template: pixiTemplate,
            chunks: ['pixi_stress2'],
            title: 'GPU-Driven Particle System',
        }),
        new HtmlWebpackPlugin({
            filename: 'pixi_optimization.html',
            template: pixiTemplate,
            chunks: ['pixi_optimization'],
            title: 'PixiJS Optimization Lab',
        }),
        new HtmlWebpackPlugin({
            filename: 'pixi_x_three.html',
            template: pixiTemplate,
            chunks: ['pixi_x_three'],
            title: 'PixiJS X Three.js',
        }),
        new HtmlWebpackPlugin({
            filename: 'rwd_showcase.html',
            template: './src/rwdShowcase/index.html',
            chunks: ['rwd_showcase'],
            title: 'RWD Showcase',
            templateParameters: { i18nBoot: i18nBootFor('./src/rwdShowcase/index.html') },
        }),
        new HtmlWebpackPlugin({
            filename: 'findings.html',
            template: './src/findings/index.html',
            chunks: ['findings'],
            title: 'Rendering Findings',
            templateParameters: { bootHead, i18nBoot: i18nBootFor('./src/findings/index.html') },
        }),
        new HtmlWebpackPlugin({
            filename: 'shader_lab.html',
            template: './src/shaderLab/index.html',
            chunks: ['shader_lab'],
            title: 'Shader Lab',
            templateParameters: { bootHead, i18nBoot: i18nBootFor('./src/shaderLab/index.html') },
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'public', to: 'public' }
            ],
        }),
        // 每個 entry 抽出自己的 CSS，HtmlWebpackPlugin 會依 chunks 對應注入 <link>
        ...(isDev ? [] : [new MiniCssExtractPlugin({ filename: '[name].css' })]),
    ],
    watchOptions: {
        poll: 500, // 每500毫秒檢查一次文件系統的變化
        ignored: ['/node_modules/'], // 忽略目錄
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'), // 讓 dev server 讀得到靜態資源
        },
        compress: true,
        port: 8080, // 指定 port
        open: true, // 啟動時自動打開瀏覽器
        hot: true,  // 啟用熱更新 (Hot Module Replacement)
    },
};  
