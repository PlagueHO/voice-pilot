const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new CleanWebpackPlugin(),
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/media', to: 'media' },
                { from: 'package.json', to: 'package.json' },
                { from: 'vsc-extension-quickstart.md', to: 'vsc-extension-quickstart.md' },
                { from: 'README.md', to: 'README.md' },
            ],
        }),
    ],
    devtool: 'source-map',
    target: 'node',
    externals: {
        vscode: 'commonjs vscode',
    },
};