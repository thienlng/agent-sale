import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry.ts'],
  outfile: 'dist/widget.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2017', 'safari11'],
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
});
