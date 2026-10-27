/* global console, process, URL */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 20 * 1024;
const code = readFileSync(new URL('../dist/widget.js', import.meta.url));
const size = gzipSync(code, { level: 9 }).length;
console.log(`widget.js: ${code.length} B raw, ${size} B gzip (budget ${BUDGET} B)`);
if (/\bzod\b/i.test(code.toString())) {
  console.error('zod must not be part of the widget bundle');
  process.exit(1);
}
if (size > BUDGET) {
  console.error('widget.js exceeds the 20 KB gzip budget');
  process.exit(1);
}
