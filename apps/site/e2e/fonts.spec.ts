import { expect, test } from '@playwright/test';

/** Fonts are self-hosted (no third-party requests), licensed, and render Vietnamese (T-123). */

test('text renders in Space Grotesk and labels in JetBrains Mono, all self-hosted', async ({
  page,
  baseURL,
}) => {
  const fontRequests: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'font') fontRequests.push(r.url());
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const fonts = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
    label: getComputedStyle(document.querySelector('.hero-label')!).fontFamily,
    grotesk: document.fonts.check('700 48px "Space Grotesk Variable"', 'Thêm một trợ lý'),
    mono: document.fonts.check('13px "JetBrains Mono Variable"', 'CHÀO BẠN'),
  }));
  expect(fonts.h1).toContain('Space Grotesk');
  expect(fonts.label).toContain('JetBrains Mono');
  expect(fonts.grotesk).toBe(true);
  expect(fonts.mono).toBe(true);
  // Vietnamese text pulls the Vietnamese subset; every font comes from this origin.
  expect(fontRequests.some((u) => u.includes('vietnamese'))).toBe(true);
  expect(fontRequests.every((u) => u.startsWith(baseURL!))).toBe(true);
});

test('the font licences are published with the site', async ({ request }) => {
  for (const name of ['space-grotesk', 'jetbrains-mono']) {
    const res = await request.get(`/licenses/${name}-OFL.txt`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('SIL Open Font License');
  }
});
