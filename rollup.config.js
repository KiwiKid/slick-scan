import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';

export default {
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
      'process.env.NODE_ENV': JSON.stringify('development'),
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
    copy({
      targets: [
        { src: 'node_modules/bulma/css/bulma.min.css', dest: 'dist' },
        { src: 'styles.css', dest: 'dist' }
      ]
    }),
    terser()
  ]
}; 