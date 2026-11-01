import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Vitest runs from apps/web.
const ROUTES_DIR = resolve(process.cwd(), 'src/routes');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe('route files', () => {
  // The router plugin writes a `Hello "/path"!` placeholder for a route file it
  // finds empty; one silently replaced the bot products page in a merge.
  it('contain no generated placeholder component', () => {
    const stubs = routeFiles(ROUTES_DIR).filter((file) =>
      readFileSync(file, 'utf8').includes('<div>Hello "/'),
    );
    expect(stubs).toEqual([]);
  });
});
