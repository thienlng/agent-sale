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
