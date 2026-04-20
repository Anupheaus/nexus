const path = require('path');
const nodeExternals = require('webpack-node-externals');
const NodemonPlugin = require('nodemon-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ProgressPlugin = require('progress-webpack-plugin');
const HotModulePlugin = require('./WebpackHotReloadPlugin');

const generateSettings = (name, isDev) => ({
  watch: isDev,
  name,
  devtool: isDev ? 'eval-cheap-module-source-map' : false,
  ...(isDev ? {
    watchOptions: {
      ignored: /node_modules\/(?!@anupheaus).*/,
    },
  } : {}),
  output: {
    path: path.resolve(__dirname, './dist'),
    hashFunction: 'xxhash64',
    ...(isDev ? {} : { library: { type: 'umd' } }),
  },
  module: {
    rules: [{
      test: /\.tsx?$/,
      loader: 'ts-loader',
      options: {
        transpileOnly: isDev,
        onlyCompileBundledFiles: true,
        compilerOptions: {
          declaration: true,
          declarationDir: './dist',
          noEmit: false,
        },
      },
    }, {
      test: /\.css$/,
      use: ['style-loader', 'css-loader'],
    }],
  },
  resolveLoader: {
    modules: [path.join(__dirname, 'node_modules')],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: isDev ? {
      '@anupheaus/common': path.join(__dirname, '../common/src'),
      '@anupheaus/react-ui': path.join(__dirname, '../react-ui/src'),
    } : {},
  },
  plugins: [
    new ProgressPlugin({ name }),
  ],
  stats: {
    assets: false,
    builtAt: true,
    cached: false,
    cachedAssets: false,
    children: false,
    chunks: false,
    chunkGroups: false,
    chunkModules: false,
    chunkOrigins: false,
    colors: true,
    depth: false,
    entrypoints: false,
    env: false,
    errors: true,
    errorDetails: true,
    hash: false,
    logging: 'error',
    modules: false,
    outputPath: false,
    performance: true,
    providedExports: false,
    publicPath: false,
    reasons: false,
    source: false,
    timings: true,
    usedExports: false,
    version: false,
    warnings: true,
  },
});

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';
  const clientSettings = generateSettings('client', isDev);
  const commonSettings = generateSettings('common', isDev);
  const serverSettings = generateSettings('server', isDev);

  const config = [
    {
      /* Client */
      ...clientSettings,
      entry: {
        client: isDev ? './tests/harness/client/index.tsx' : './src/client/index.ts',
      },
      resolve: {
        ...clientSettings.resolve,
        alias: {
          ...clientSettings.resolve.alias,
          'react': path.join(__dirname, './node_modules/react'),
          'react-dom': path.join(__dirname, './node_modules/react-dom'),
        },
        fallback: {
          path: false,
          os: false,
          buffer: false,
          util: false,
          browser: false,
          fs: false,
        },
      },
      target: 'web',
      externals: isDev ? [] : [nodeExternals()],
      plugins: [
        ...(clientSettings.plugins ?? []),
        ...(isDev ? [new HotModulePlugin()] : []),
      ],
    },
    ...(isDev ? [] : [{
      /* Common */
      ...commonSettings,
      entry: {
        common: './src/common/index.ts',
      },
      target: 'node',
      externals: [nodeExternals()],
    }]),
    {
      /* Server */
      ...serverSettings,
      entry: {
        server: isDev ? './tests/harness/server/start.ts' : './src/server/index.ts',
      },
      target: 'node',
      externals: [nodeExternals()],
      plugins: [
        ...(serverSettings.plugins ?? []),
        ...(isDev ? [
          new CopyWebpackPlugin({
            patterns: [
              { from: './tests/harness/server/views', to: './views' },
            ],
          }),
          new NodemonPlugin(),
        ] : []),
      ],
    },
  ];

  if (argv.name != null) return config.find(({ name }) => name.toLowerCase() === argv.name.toLowerCase());
  return config;
};
