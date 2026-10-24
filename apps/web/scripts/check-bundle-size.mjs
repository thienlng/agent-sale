// Bundle budget (docs/16 §1): the JavaScript + CSS the browser must download
// before /login can render — index.html's entry script, its static imports
// (modulepreload) and stylesheets — must stay ≤ 250 KB gzip. Lazy route
// chunks are excluded: they load on navigation (preloaded on intent).
import { readFileSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const assets = [
  ...html.matchAll(/<script[^>]+src="\/([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet)"[^>]+href="\/([^"]+)"/g),
].map((m) => m[1]);

let total = 0;
for (const file of new Set(assets)) {
  const kb = gzipSync(readFileSync(path.join(dist, file))).length / 1024;
  total += kb;
  process.stdout.write(`${kb.toFixed(1).padStart(7)} KB  ${file}\n`);
}
process.stdout.write(
  `${total.toFixed(1).padStart(7)} KB  total initial (gzip), budget ${BUDGET_KB} KB\n`,
);
if (total > BUDGET_KB) {
  process.stderr.write(`Initial bundle exceeds the ${BUDGET_KB} KB budget (docs/16 §1).\n`);
  process.exit(1);
}
