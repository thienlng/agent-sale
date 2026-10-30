import { expect, test } from '@playwright/test';

import { BOT_ID, mockApi } from './support/mock-api';

for (const width of [375, 1280]) {
  for (const navbar of ['sticky', 'scroll']) {
    test(`profile save stays visible at ${width}px with ${navbar} header`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockApi(page);
      await page.addInitScript((style) => {
        localStorage.setItem('rapiz.pref.navbar_style', style);
      }, navbar);
      await page.goto(`/app/bots/${BOT_ID}/knowledge`);
      const firstField = page.getByLabel(/Tên gọi với khách/);
      await firstField.scrollIntoViewIfNeeded();
      const save = page.getByRole('button', { name: 'Lưu thay đổi', exact: true });
      await expect(save).toBeInViewport({ ratio: 1 });
      await firstField.fill('Demo profile edit');
      await expect(save).toBeEnabled();
      const notes = page.getByLabel(/Ghi chú thêm/);
      await notes.scrollIntoViewIfNeeded();
      await notes.fill('Demo notes');
      await expect(save).toBeInViewport({ ratio: 1 });
      const bounds = await save.boundingBox();
      expect(bounds?.y).toBeGreaterThanOrEqual(navbar === 'sticky' ? 52 : 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
      await expect(save).toBeDisabled();
    });
  }
}
