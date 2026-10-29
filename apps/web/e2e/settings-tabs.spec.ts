import { expect, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

/** The tab strips must not scroll vertically (native up/down arrows on Windows Chrome). */
for (const width of [1280, 375]) {
  for (const path of [
    '/app/settings/profile',
    '/app/crm-settings/statuses',
    '/app/order-settings/statuses',
  ]) {
    test(`tab strip of ${path} has no vertical overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockApi(page);
      await page.goto(path);
      const nav = page.locator('main nav, [data-slot="sidebar-inset"] nav').first();
      await expect(nav).toBeVisible();
      const sizes = await nav.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));
      expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.clientHeight);
      expect(sizes.overflowY).toBe('hidden');
      const active = nav.locator('[data-status="active"]');
      await expect(active).toBeVisible();
      const underline = await active.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.borderBottomWidth, color: style.borderBottomColor };
      });
      expect(underline.width).toBe('2px');
      expect(underline.color).not.toBe('rgba(0, 0, 0, 0)');
    });
  }
}
