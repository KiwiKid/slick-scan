import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import postcss from 'rollup-plugin-postcss';

const postcssPlugin = postcss({
  extract: true,
  minimize: true,
  use: ['sass']
});

const demoPostcssPlugin = postcss({
  extract: 'demo.css',
  minimize: true,
  use: ['sass']
});

export default [
  // Library build
  {
    input: 'src/index.tsx',
    output: [
      {
        file: 'dist/index.js',
        format: 'es',
        sourcemap: true
      }
    ],
    plugins: [
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
        preventAssignment: true
      }),
      typescript({
        tsconfig: './tsconfig.json',
        sourceMap: true,
        inlineSources: true,
        jsx: 'react'
      }),
      resolve({
        browser: true,
        preferBuiltins: false,
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }),
      commonjs({
        transformMixedEsModules: true,
        include: /node_modules/,
        requireReturnsDefault: 'auto'
      }),
      json(),
      postcssPlugin,
      terser({
        format: {
          comments: false
        }
      })
    ]
  },
  // Demo build
  {
    input: 'docs/index.ts',
    output: {
      file: 'dist/demo.js',
      format: 'es',
      sourcemap: true
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        sourceMap: true,
        inlineSources: true,
        jsx: 'react'
      }),
      resolve({
        browser: true,
        preferBuiltins: false,
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }),
      commonjs({
        transformMixedEsModules: true,
        include: /node_modules/,
        requireReturnsDefault: 'auto'
      }),
      demoPostcssPlugin,
      copy({
        targets: [
          { src: 'docs/index.html', dest: 'dist' }
        ]
      }),
      terser({
        format: {
          comments: false
        }
      })
    ]
  }
]; 