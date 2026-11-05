import { expect, type Page, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * Lodging Booking list, Căn hộ grid and property editor (T-160) layout guard: long Vietnamese
 * names and a 7-day price table stay inside their own scroll areas from phone to desktop.
 */
const VIEWPORTS = [375, 768, 1280, 1920];
const pad = (n: number) => String(n).padStart(12, '0');
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-${pad(n)}`;
const LONG_NAME = 'Biệt thự nghỉ dưỡng hướng biển có hồ bơi riêng, sân nướng BBQ và phòng karaoke';
const STAMP = '2026-11-01T00:00:00.000Z';

const unit = (n: number, kind: 'whole' | 'room', active = true) => ({
  id: uuid(1000 + n),
  kind,
  name: kind === 'whole' ? 'Nguyên căn' : `Phòng ${n} hướng biển tầng ${n}`,
  beds: '2 giường đôi',
  capacityAdults: 2,
  capacityChildren: 1,
  active,
  sortOrder: n,
});

function property(n: number) {
  const rooms = n % 3 === 0;
  return {
    id: uuid(100 + n),
    code: `A${n + 10}`,
    name: `${LONG_NAME} số ${n + 1}`,
    area: n % 2 ? 'Bãi Dài' : 'Dương Đông',
    address: '',
    description: '',
    sellMode: rooms ? 'rooms' : 'whole',
    status: 'active',
    standardAdults: 24,
    standardChildren: 8,
    maxGuests: null,
    childFreeBelow: 6,
    childAdultFrom: 12,
    amenities: ['Hồ bơi'],
    layout: [],
    policies: {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      deposit: '',
      cancellation: '',
      houseRules: '',
      other: '',
    },
    gallery: [],
    galleryCover: '',
    internalNote: '',
    units: rooms ? [unit(1, 'room'), unit(2, 'room', false), unit(3, 'room')] : [unit(0, 'whole')],
    surcharges: { extraAdult: { sell: 300_000, cost: 200_000 }, extraChild: null },
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const booking = (n: number) => ({
  id: uuid(5000 + n),
  code: `BK-${String(n).padStart(4, '0')}`,
  propertyId: uuid(100 + n),
  propertyCode: `A${n + 10}`,
  propertyName: LONG_NAME,
  kind: 'stay',
  whole: true,
  unitIds: [uuid(1000)],
  unitNames: ['Nguyên căn'],
  status: n % 2 ? 'hold' : 'confirmed',
  checkIn: '2026-11-06',
  checkOut: '2026-11-08',
  party: { adults: 20, childAges: [4, 9] },
  guestName: 'Nguyễn Thị Thanh Hương Lan Anh Phương',
  guestPhone: '0912345678',
  contactId: null,
  conversationId: null,
  source: 'messenger',
  holdExpiresAt: n % 2 ? new Date(Date.now() + 3_600_000).toISOString() : null,
  quote: null,
  adjustment: 0,
  adjustmentReason: '',
  totalSell: 27_000_000,
  totalCost: 22_000_000,
  note: '',
  tags: n % 3 ? [] : ['Đoàn công ty'],
  blockReason: '',
  reviewedAt: null,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockHotel(page: Page) {
  await mockApi(page);
  await page.route('**/api/v1/workspaces/current', (route) =>
    route.fulfill(
      json({
        id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20',
        name: 'Villas',
        industry: 'hotel',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: STAMP,
      }),
    ),
  );
  const list = Array.from({ length: 12 }, (_, n) => property(n));
  await page.route('**/api/v1/lodging/properties**', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const found = list.find((p) => p.id === id);
    if (found) {
      const rates = found.units.map((u) => ({
        id: uuid(9000 + found.units.indexOf(u)),
        unitId: found.sellMode === 'rooms' ? u.id : null,
        kind: 'weekday',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        dateFrom: null,
        dateTo: null,
        label: '',
        sell: 12_000_000,
        cost: 10_000_000,
        minNights: null,
      }));
      return route.fulfill(json({ ...found, rates }));
    }
    return route.fulfill(
      json({
        data: list.map((p) => ({
          ...p,
          today: 'free',
          weekdaySell: [12, 12, 12, 12, 14, 16, 14].map((m) => m * 1_000_000),
        })),
      }),
    );
  });
  await page.route('**/api/v1/lodging/calendar**', (route) =>
    route.fulfill(
      json({ from: '2026-11-01', to: '2026-11-08', today: '2026-11-01', properties: [] }),
    ),
  );
  await page.route('**/api/v1/lodging/settings', (route) =>
    route.fulfill(json({ holdMinutes: 120 })),
  );
  await page.route('**/api/v1/lodging/bookings**', (route) =>
    route.fulfill(
      json({ data: Array.from({ length: 30 }, (_, n) => booking(n)), nextOffset: 100 }),
    ),
  );
}

async function expectNoOverflow(page: Page, width: number) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
}

for (const width of VIEWPORTS) {
  test(`lodging bookings, places and editor fit at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockHotel(page);

    await page.goto('/app/bookings');
    await expect(page.getByRole('heading', { name: 'Booking' })).toBeVisible();
    await page.getByRole('tab', { name: 'Giữ chỗ' }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoOverflow(page, width);

    await page.goto('/app/properties');
    await expect(page.getByRole('article').first()).toBeVisible();
    await expectNoOverflow(page, width);

    await page.goto(`/app/properties/${uuid(100)}`);
    await page.getByRole('tab', { name: 'Giá' }).click();
    await expect(page.getByLabel('Giá bán Nguyên căn T2')).toBeVisible();
    await expectNoOverflow(page, width);
    await page.goto(`/app/properties/${uuid(103)}`);
    await page.getByRole('tab', { name: 'Phòng' }).click();
    await expect(page.getByText('Đang tắt', { exact: true })).toBeVisible();
    await expectNoOverflow(page, width);
    expect(errors).toEqual([]);
  });
}
