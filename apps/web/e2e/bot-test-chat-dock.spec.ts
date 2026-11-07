import { expect, test } from '@playwright/test';

import { BOT_ID, mockApi } from './support/mock-api';

const chat = 'Đoạn chat thử nghiệm';

test('test chat: collapsing leaves an icon that brings it back (wide screen)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  const dock = page.getByRole('region', { name: chat });
  await expect(dock).toBeVisible();

  await page.getByRole('button', { name: 'Ẩn chat thử' }).click();
  await expect(dock).toBeHidden();
  await page.getByRole('button', { name: 'Mở chat thử' }).click();
  await expect(dock).toBeVisible();
});

test('test chat: the edge icon opens it as a sheet on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  await expect(page.getByRole('region', { name: chat })).toBeHidden();

  await page.getByRole('button', { name: 'Mở chat thử' }).click();
  await expect(page.getByRole('dialog').getByRole('region', { name: chat })).toBeVisible();
});

test('test chat: a wide bot picture opens inside a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/wide.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200"><rect width="2000" height="1200" fill="#c96"/></svg>',
    }),
  );
  await page.route('**/api/v1/bots/*/playground', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        runId: '01a1882e-232d-78ef-9fcd-ed1c7faf5344',
        reply: 'Dạ ảnh phòng ngủ ạ',
        outcome: 'answered',
        guardrail: null,
        sources: [],
        images: [1, 2].map((i) => ({
          url: `${new URL(page.url()).origin}/wide.svg?${i}`,
          label: `Phòng ngủ ${i} có tên dài để thử cắt chữ ở tiêu đề ảnh`,
        })),
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        provider: 'p',
        model: 'm',
        latencyMs: 5,
      }),
    }),
  );
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  await page.getByRole('button', { name: 'Mở chat thử' }).click();
  const box = page.getByRole('dialog').getByRole('textbox');
  await box.fill('cho xem ảnh');
  await box.press('Enter');
  await page.getByRole('button', { name: /Phòng ngủ 1/ }).click();

  const lightbox = page.getByRole('dialog', { name: /Phòng ngủ 1/ });
  const picture = lightbox.getByRole('img', { name: /Phòng ngủ 1/ });
  await expect(picture).toBeVisible();
  for (const el of [lightbox, picture]) {
    const rect = (await el.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  }
});
