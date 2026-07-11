const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const pixiTemplate = './src/pixiJSDemo/index.html'; // 建立一個共用模板
const isDev = process.env.NODE_ENV === 'development';

module.exports = {
    mode: isDev ? 'development' : 'production',
    entry: {
        main: './src/home/index.ts',                             // 入口首頁的 JS
        configurator: './src/babylonJSDemo/src/configurator/index.ts', // Babylon.js 產品配置器
        pixi_hub: './src/pixiJSDemo/pixiHub/index.ts',           // Pixi.js 選單頁
        pixi_stress: './src/pixiJSDemo/stressTest/index.ts',     // Pixi.js 壓力測試
        pixi_stress2: './src/pixiJSDemo/stressTest2/index.ts',   // Pixi.js 壓力測試2
        pixi_optimization: './src/pixiJSDemo/optimization/index.ts', // Pixi.js 最佳實踐
        pixi_x_three: './src/pixiJSDemo/pixiXthree/index.ts', // Pixi.js X Three.js
        rwd_showcase: './src/rwdShowcase/index.ts',           // RWD 裝置模擬器
    },
    output: {
        filename: '[name].bundle.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true, // Webpack 5 建議加上這個，每次打包前清空 dist
        // publicPath: process.env.NODE_ENV === 'production' ? '/demoMyself/' : '/'
        publicPath: isDev ? '/' : '/demoMyself/',
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
                test: /\.ts$/,
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
                test: /\.css$/i,
                use: ['style-loader', 'css-loader'],
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            filename: 'index.html',
            template: './src/home/index.html',
            chunks: ['main'],
            title: 'Eric Wu - Portfolio',
        }),
        new HtmlWebpackPlugin({
            filename: 'configurator.html',
            template: './src/babylonJSDemo/src/configurator/index.html',
            chunks: ['configurator'],
            title: 'Product Configurator',
        }),
        new HtmlWebpackPlugin({
            filename: 'pixi_hub.html',
            template: './src/pixiJSDemo/pixiHub/index.html',
            chunks: ['pixi_hub'],
            title: 'PixiJS Demos',
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
        new CopyWebpackPlugin({
            patterns: [
                { from: 'public', to: 'public' } 
            ],
        }),
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
