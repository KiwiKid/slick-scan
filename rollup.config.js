import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import postcss from 'rollup-plugin-postcss';

export default {
  input: 'src/index.tsx',
  output: {
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
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
    postcss({
      extract: 'styles.css',
      minimize: true
    }),
    terser()
  ]
}; 