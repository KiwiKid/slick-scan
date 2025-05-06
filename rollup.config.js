import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';
import copy from 'rollup-plugin-copy';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';

export default {
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
        'process.env': JSON.stringify({
          NODE_ENV: 'production'
        })
      }
    }),
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
    postcss({
      extract: 'docs/styles.css',
      minimize: true
    }),
    copy({
      targets: [
        { src: 'src/index.html', dest: 'docs' }
      ]
    }),
    terser()
  ]
}; 