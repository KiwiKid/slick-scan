import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import  terser  from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';
import copy from 'rollup-plugin-copy';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';

const basePlugins = [
  typescript({
    tsconfig: './tsconfig.json',
    sourceMap: true,
    inlineSources: true
  }),
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs({
    transformMixedEsModules: true,
    include: /node_modules/
  }),
  json(),
];

export default [
  // Main (production) build
  {
    input: 'src/index.tsx',
    output: {
      file: 'docs/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: {
          'process.env.NODE_ENV': JSON.stringify('production'),
          'process.env': JSON.stringify({ NODE_ENV: 'production' })
        }
      }),
      ...basePlugins,
      postcss({
        extract: 'docs/styles.css',
        minimize: true,
        use: ['sass'],
        inject: false
      }),
      copy({
        targets: [
          { src: 'src/index.html', dest: 'docs' }
        ],
        copyOnce: true
      }),
      terser()
    ]
  },
  // Dev build
  {
    input: 'src/index.tsx',
    output: {
      file: 'docs/dev/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: {
          'process.env.NODE_ENV': JSON.stringify('development'),
          'process.env': JSON.stringify({ NODE_ENV: 'development' })
        }
      }),
      ...basePlugins,
      postcss({
        extract: 'docs/dev/styles.css',
        minimize: false,
        use: ['sass'],
        inject: false
      }),
      copy({
        targets: [
          { src: 'src/index.html', dest: 'docs/dev' }
        ],
        copyOnce: true
      })
      // No terser for dev build
    ]
  }
]; 