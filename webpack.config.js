const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    mode: 'development',
    entry: './src/app.ts',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '/', // 確保資源路徑從根目錄開始
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
                test: /\.(png|jpe?g|gif|glb|gltf)$/i,
                type: 'asset/resource',
                generator: {
                    filename: 'res/[path][name][ext]', // 保留原始路徑和文件名
                    // filename: `assets/[name].[contenthash][ext]`,
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'public/index.html',
        }),
    ],
    watchOptions: {
        poll: 500, // 每500毫秒檢查一次文件系統的變化
        ignored: ['/node_modules/'], // 忽略目錄
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 3000,
        open: true,
    },
};
