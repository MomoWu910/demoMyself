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
            templateParameters: { bootHead },
        }),
        new HtmlWebpackPlugin({
            filename: 'configurator.html',
            template: './src/babylonJSDemo/src/configurator/index.html',
            chunks: ['configurator'],
            title: 'Product Configurator',
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
        }),
        new HtmlWebpackPlugin({
            filename: 'findings.html',
            template: './src/findings/index.html',
            chunks: ['findings'],
            title: 'Rendering Findings',
            templateParameters: { bootHead },
        }),
        new HtmlWebpackPlugin({
            filename: 'shader_lab.html',
            template: './src/shaderLab/index.html',
            chunks: ['shader_lab'],
            title: 'Shader Lab',
            templateParameters: { bootHead },
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
