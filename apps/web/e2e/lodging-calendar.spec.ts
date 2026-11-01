import { expect, type Page, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * Lodging calendar (T-160) layout guard: a hotel business with many long-named places
 * and a month of nights scrolls inside the grid, never the page, from phone to wide desktop.
 */
const VIEWPORTS = [375, 768, 1280, 1920];
const pad = (n: number) => String(n).padStart(2, '0');
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-${pad(n).padStart(12, '0')}`;

function calendar(from: string, to: string) {
  const start = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const count = Math.round(
    (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - start) / 86_400_000,
  );
  const nights = Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
  const prices = nights.map((night, i) => ({
    night,
    sell: 12_000_000 + (i % 3) * 1_000_000,
    label: i === 3 ? 'Tết Dương lịch' : '',
  }));
  return {
    from,
    to,
    today: from,
    properties: Array.from({ length: 25 }, (_, p) => ({
      id: uuid(100 + p),
      code: `A${p + 10}`,
      name: `Biệt thự nghỉ dưỡng hướng biển số ${p + 1} có hồ bơi riêng và sân nướng BBQ`,
      area: p % 2 ? 'Bãi Dài' : 'Dương Đông',
      sellMode: p % 5 === 0 ? 'rooms' : 'whole',
      standardAdults: 24,
      standardChildren: 8,
      wholePrices: prices,
      rows: (p % 5 === 0 ? [1, 2, 3] : [0]).map((r) => ({
        unitId: uuid(1000 + p * 10 + r),
        name: r ? `Phòng ${r}` : 'Nguyên căn',
        kind: r ? 'room' : 'whole',
        prices,
        segments: [
          {
            bookingId: uuid(5000 + p * 10 + r),
            code: `BK-${pad(p)}${r}`,
            kind: 'stay',
            status: p % 3 === 0 ? 'hold' : 'confirmed',
            from: nights[1 + (p % 4)],
            to: nights[4 + (p % 4)],
            guestName: 'Nguyễn Thị Thanh Hương Lan Anh',
            blockReason: '',
            holdExpiresAt: p % 3 === 0 ? new Date(Date.now() + 3_600_000).toISOString() : null,
            guestPhone: '0912345678',
            party: { adults: 20, childAges: [] },
            totalSell: 39_000_000,
            tags: ['Đoàn công ty'],
            note: '',
          },
        ],
      })),
      internalNote: p % 4 === 0 ? 'Chủ nhà nhận khách từ 15h.' : '',
      notes: [],
    })),
  };
}

async function mockHotel(page: Page) {
  await mockApi(page);
  await page.route('**/api/v1/workspaces/current', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20',
        name: 'Villas',
        industry: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '2026-11-01T00:00:00.000Z',
      }),
    }),
  );
  await page.route('**/api/v1/lodging/calendar**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        calendar(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? ''),
      ),
    });
  });
}

for (const width of VIEWPORTS) {
  test(`lodging calendar fits at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockHotel(page);
    await page.goto('/app/calendar');
    await expect(page.getByRole('heading', { name: 'Lịch' })).toBeVisible();
    if (width < 768)
      await expect(page.getByRole('button', { name: 'Tạo booking' }).first()).toBeVisible();
    else {
      await expect(page.getByRole('grid', { name: 'Lịch phòng' })).toBeVisible();
      await page.getByRole('radio', { name: 'Tháng' }).click();
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
