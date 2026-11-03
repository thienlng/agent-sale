import { build } from 'esbuild';

await build({
  entryPoints: ['src/entry.ts'],
  outfile: 'dist/widget.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2017', 'safari11'],
  // esbuild >= 0.27.7 marks destructuring as unsupported before Safari 14.1 (compat-table edge
  // cases) but cannot lower it, so the build fails. Safari 10+ runs ES2015 destructuring, and
  // older esbuild emitted it unchanged; keep that output.
  supported: { destructuring: true },
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
});
