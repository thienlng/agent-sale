import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

/** Ported from the standalone repo's verify-fonts script: self-hosted, licensed, untampered. */

interface FontManifest {
  families: Record<string, { licenseFile: string }>;
  files: Array<{ family: string; path: string; sha256: string; bytes: number }>;
}

const publicDir = join(import.meta.dirname, '..', 'public');
const manifest = JSON.parse(
  readFileSync(join(publicDir, 'fonts', 'SOURCES.json'), 'utf8'),
) as FontManifest;

test('every font file matches its recorded checksum and has its licence', () => {
  for (const file of manifest.files) {
    const bytes = readFileSync(join(publicDir, file.path));
    expect(bytes.length, file.path).toBe(file.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(file.sha256);
  }
  for (const [family, { licenseFile }] of Object.entries(manifest.families)) {
    expect(readFileSync(join(publicDir, 'fonts', licenseFile), 'utf8'), family).toContain(
      'SIL OPEN FONT LICENSE',
    );
  }
});

test('text renders from the self-hosted fonts without any remote font request', async ({
  page,
}) => {
  const remote: string[] = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    remote.push(route.request().url());
    return route.abort();
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // The whole landing page is set in Fraunces (docs/designs/T-121); Plus Jakarta Sans is only
  // declared for parity with the dashboard and must not be preloaded unused.
  expect(await page.evaluate(() => document.fonts.check('16px "Fraunces"', 'Tiếng Việt'))).toBe(
    true,
  );
  await expect(page.locator('link[rel=preload][href*="plus-jakarta"]')).toHaveCount(0);
  const h1Font = await page.locator('h1').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(h1Font).toContain('Fraunces');
  expect(remote).toEqual([]);
});
