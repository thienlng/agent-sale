import { expect, test } from '@playwright/test';

/** Fonts are self-hosted (no third-party requests), licensed, and render Vietnamese (T-123). */

test('text and headings render in Inter, display moments in Inter Tight, all self-hosted', async ({
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
    inter: document.fonts.check('700 48px "Inter Variable"', 'Thêm một trợ lý'),
    display: document.fonts.check('italic 900 48px "Inter Tight Variable"', '24/7'),
  }));
  expect(fonts.h1).toContain('Inter');
  expect(fonts.label).toContain('Inter');
  expect(fonts.inter).toBe(true);
  expect(fonts.display).toBe(true);
  // Vietnamese text pulls the Vietnamese subset; every font comes from this origin.
  expect(fontRequests.some((u) => u.includes('vietnamese'))).toBe(true);
  expect(fontRequests.every((u) => u.startsWith(baseURL!))).toBe(true);
});

test('the font licences are published with the site', async ({ request }) => {
  for (const name of ['inter', 'inter-tight']) {
    const res = await request.get(`/licenses/${name}-OFL.txt`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('SIL Open Font License');
  }
});
