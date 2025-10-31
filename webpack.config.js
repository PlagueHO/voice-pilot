const path = require('path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    return {
        mode: argv.mode || 'development',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'out'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2',
            clean: true
        },
        resolve: {
            extensions: ['.ts', '.js'],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            compilerOptions: {
                                sourceMap: !isProduction
                            }
                        }
                    },
                    exclude: /node_modules/,
                },
            ],
        },
        plugins: [
            new CleanWebpackPlugin()
        ],
        optimization: {
            minimize: isProduction
        },
        devtool: isProduction ? false : 'source-map',
        target: 'node',
        externals: {
            vscode: 'commonjs vscode',
            // External node modules that shouldn't be bundled
            'applicationinsights-native-metrics': 'commonjs applicationinsights-native-metrics',
            '@azure/msal-node': 'commonjs @azure/msal-node',
            '@azure/msal-node-extensions': 'commonjs @azure/msal-node-extensions'
        },
        performance: {
            hints: 'warning',
            maxEntrypointSize: 5000000, // 5MB
            maxAssetSize: 5000000
        }
    };
};
