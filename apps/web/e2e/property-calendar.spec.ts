import { expect, type Page, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * "Lịch căn" (`/app/calendar/$propertyId`) layout guard: each view (month, 3 months, year,
 * list) of a whole villa and of a rooms homestay renders on a wide desktop and on a phone
 * without horizontal page overflow; the view switch writes the URL.
 */
const VIEWPORTS = [1440, 390];
const VIEWS = ['month', 'quarter', 'year', 'list'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-${pad(n).padStart(12, '0')}`;
const VILLA = uuid(100);
const HOMESTAY = uuid(200);
const DAY = 86_400_000;
const LONG_NAME = 'Biệt thự nghỉ dưỡng hướng biển có hồ bơi riêng và sân nướng BBQ rất dài';

const utc = (night: string) =>
  Date.UTC(+night.slice(0, 4), +night.slice(5, 7) - 1, +night.slice(8, 10));
const night = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function segment(n: number, from: string, nights: number, status: string) {
  return {
    bookingId: uuid(5000 + n),
    code: `BK-${pad(n)}`,
    kind: status === 'active' ? 'block' : 'stay',
    status,
    from,
    to: night(utc(from) + nights * DAY),
    guestName: status === 'active' ? '' : 'Nguyễn Thị Thanh Hương Lan Anh',
    blockReason: status === 'active' ? 'Sửa hồ bơi' : '',
    holdExpiresAt: status === 'hold' ? new Date(Date.now() + 3_600_000).toISOString() : null,
    guestPhone: '0912345678',
    party: { adults: 6, childAges: [] },
    totalSell: 39_000_000,
    tags: [],
    note: '',
    packageNames: [],
  };
}

/** Bookings every ~9 days through the window, so every month and week has bars. */
function calendar(id: string, from: string, to: string) {
  const count = Math.round((utc(to) - utc(from)) / DAY);
  const nights = Array.from({ length: count }, (_, i) => night(utc(from) + i * DAY));
  const prices = nights.map((n, i) => ({
    night: n,
    sell: 12_000_000 + (i % 3) * 1_000_000,
    label: n.endsWith('-01-01') ? 'Tết Dương lịch' : '',
  }));
  const statuses = ['confirmed', 'hold', 'checked_in', 'active'];
  const segments = (offset: number) =>
    nights
      .filter((_, i) => (i + offset) % 9 === 0)
      .map((n, k) => segment(offset * 100 + k, n, 3, statuses[k % statuses.length] ?? 'confirmed'));
  const rooms = id === HOMESTAY;
  return {
    from,
    to,
    today: '2026-11-07',
    properties: [
      {
        id,
        code: rooms ? 'H1' : 'A17',
        name: LONG_NAME,
        area: 'Bãi Dài',
        sellMode: rooms ? 'rooms' : 'whole',
        standardAdults: 24,
        standardChildren: 8,
        wholePrices: prices,
        rows: (rooms ? [1, 2, 3] : [0]).map((r) => ({
          unitId: uuid(1000 + (rooms ? 10 : 0) + r),
          name: r ? `Phòng ${r}` : 'Nguyên căn',
          kind: r ? 'room' : 'whole',
          prices,
          segments: segments(r),
        })),
        internalNote: 'Chủ nhà nhận khách từ 15h.',
        notes: [{ id: uuid(9000), unitId: null, night: '2026-11-12', text: 'Sửa điện' }],
      },
    ],
  };
}

const booking = (n: number, source: string, conversation: boolean) => ({
  id: uuid(5000 + n),
  code: `BK-${pad(n)}`,
  propertyId: VILLA,
  propertyCode: 'A17',
  propertyName: LONG_NAME,
  kind: 'stay',
  whole: true,
  unitIds: [uuid(1000)],
  unitNames: ['Nguyên căn'],
  packageIds: [],
  packageNames: n % 2 ? ['5PN'] : [],
  status: n % 2 ? 'hold' : 'confirmed',
  checkIn: night(utc('2026-11-08') + n * 4 * DAY),
  checkOut: night(utc('2026-11-10') + n * 4 * DAY),
  party: { adults: 6, childAges: [] },
  guestName: 'Nguyễn Thị Thanh Hương Lan Anh',
  guestPhone: '0912345678',
  contactId: null,
  conversationId: conversation ? uuid(7000 + n) : null,
  source,
  holdExpiresAt: n % 2 ? new Date(Date.now() + 3_600_000).toISOString() : null,
  quote: null,
  adjustment: 0,
  adjustmentReason: '',
  totalSell: 39_000_000,
  totalCost: 30_000_000,
  note: '',
  tags: [],
  blockReason: '',
  reviewedAt: null,
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

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
        calendar(
          url.searchParams.get('propertyIds') || VILLA,
          url.searchParams.get('from') ?? '',
          url.searchParams.get('to') ?? '',
        ),
      ),
    });
  });
  await page.route('**/api/v1/lodging/bookings?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: Array.from({ length: 6 }, (_, n) => booking(n, n % 3 ? 'phone' : 'bot', n % 2 === 0)),
        nextOffset: null,
      }),
    }),
  );
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow: ${label}`).toBeLessThanOrEqual(0);
}

for (const width of VIEWPORTS) {
  for (const id of [VILLA, HOMESTAY]) {
    const code = id === VILLA ? 'A17' : 'H1';
    test(`property calendar of ${code} fits every view at ${width}px`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      await mockHotel(page);
      await page.goto(`/app/calendar/${id}?from=2026-11-01`);
      await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
      for (const view of VIEWS) {
        await page
          .getByRole('radiogroup', { name: 'Kiểu xem' })
          .getByRole('radio', {
            name: { month: 'Tháng', quarter: '3 tháng', year: 'Năm', list: 'Danh sách' }[view],
            exact: true,
          })
          .click();
        if (view !== 'month') await expect(page).toHaveURL(new RegExp(`view=${view}`));
        await expect(page.getByTestId(`pcal-${view}`)).toBeVisible();
        if (view === 'month')
          await expect(page.getByTestId('pcal-period')).toHaveText('Tháng 11/2026');
        if (view === 'list') await expect(page.getByText('Bot tạo').first()).toBeVisible();
        await expectNoOverflow(page, `${code} ${view} at ${width}px`);
      }
      if (id === HOMESTAY) {
        await page.getByRole('radio', { name: 'Tháng', exact: true }).click();
        await page.getByRole('radio', { name: 'Phòng 2' }).click();
        await expect(page).toHaveURL(new RegExp(`unit=${uuid(1012)}`));
        await expectNoOverflow(page, `${code} room at ${width}px`);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('the Lịch row header opens the property calendar and Back returns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockHotel(page);
  // Lịch asks for every property; the mock answers with the villa.
  await page.goto('/app/calendar');
  await page.getByRole('link', { name: 'Mở lịch căn A17' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/calendar/${VILLA}`));
  await expect(page.getByTestId('pcal-month')).toBeVisible();
  await page.getByRole('radio', { name: 'Năm' }).click();
  const fourth = page.getByTestId('pcal-year').locator('[data-month]').nth(3);
  const month = (await fourth.getAttribute('data-month')) ?? '';
  await fourth.click();
  await expect(page).toHaveURL(new RegExp(`from=${month}`));
  await expect(page.getByTestId('pcal-period')).toHaveText(
    `Tháng ${month.slice(5, 7)}/${month.slice(0, 4)}`,
  );
  await page.goBack();
  await expect(page).toHaveURL(/view=year/);
});
