const path = require('path')

module.exports = {
    entry: './src/index.ts',
    mode: 'production',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        libraryTarget: 'umd',
        globalObject: 'this'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    externals: {
        '@angular/core': '@angular/core',
        '@angular/common': '@angular/common',
        'rxjs': 'rxjs',
        'tabby-core': 'tabby-core'
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js'],
        fallback: {
            'fs': false,
            'path': false,
            'crypto': false
        }
    }
}
