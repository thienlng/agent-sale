import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Fitness functions (docs/ARCHITECTURE.md §5): every module keeps the fixed
 * shape. dependency-cruiser covers imports; this covers structure.
 */
const modulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules');
const modules = readdirSync(modulesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('module structure', () => {
  it.each(modules)('%s has MODULE.md, api/ and <name>.module.ts', (name) => {
    const dir = path.join(modulesDir, name);
    expect(existsSync(path.join(dir, 'MODULE.md')), `${name}/MODULE.md`).toBe(true);
    expect(existsSync(path.join(dir, 'api')), `${name}/api/`).toBe(true);
    expect(existsSync(path.join(dir, `${name}.module.ts`)), `${name}/${name}.module.ts`).toBe(true);
  });

  it.each(modules)('%s MODULE.md documents purpose, public API and invariants', (name) => {
    const md = readFileSync(path.join(modulesDir, name, 'MODULE.md'), 'utf8');
    for (const heading of ['Purpose', 'Public API', 'Invariants', 'Do not']) {
      expect(md, `${name}/MODULE.md must mention "${heading}"`).toContain(heading);
    }
  });

  it.each(modules)('%s domain/ never imports frameworks or infrastructure packages', (name) => {
    const domain = path.join(modulesDir, name, 'domain');
    if (!existsSync(domain)) return;
    const banned = [
      '@nestjs/',
      'drizzle-orm',
      'bullmq',
      'fastify',
      '@agent-sales/db',
      '@agent-sales/queue',
      '@agent-sales/ai-core',
    ];
    for (const file of walk(domain)) {
      const src = readFileSync(file, 'utf8');
      for (const b of banned)
        expect(src, `${path.relative(modulesDir, file)} imports ${b}`).not.toContain(`from '${b}`);
    }
  });
});

describe('dependency injection', () => {
  // tsx/esbuild (dev runtime) does not emit decorator metadata, so class-typed
  // constructor injection silently becomes `undefined`. Every constructor
  // parameter of a Nest class must use @Inject(TOKEN) (docs/ARCHITECTURE.md).
  const files = walk(path.join(modulesDir, '..')).filter((f) => !f.endsWith('.spec.ts'));
  it.each(files.map((f) => [path.relative(path.join(modulesDir, '..'), f), f]))(
    '%s injects every constructor dependency with @Inject',
    (_rel, file) => {
      const src = readFileSync(file, 'utf8');
      if (!/@(Injectable|Controller)\(/.test(src)) return;
      const ctor = /constructor\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*\{/s.exec(src);
      if (!ctor?.[1]?.trim()) return;
      const params = ctor[1]
        .split(/,(?![^(]*\))/)
        .map((p) => p.trim())
        .filter(Boolean);
      for (const p of params)
        expect(p, `${file}: "${p}" must use @Inject(TOKEN)`).toMatch(/^@Inject\(/);
    },
  );
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}
