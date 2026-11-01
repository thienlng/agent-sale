import { expect, type Page, test } from '@playwright/test';

import { LONG, mockApi } from './support/mock-api';

/**
 * KiotViet order push on the orders pages (spec §7): the list shows the three push states, "Thử lại"
 * on a failed push calls the retry route and the order moves back to "Đang đẩy"; the order page
 * explains the failure. No horizontal overflow at 375 and 1280 px.
 */
const now = new Date().toISOString();
const id = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e0${n}`;
const PENDING = id(1);
const PUSHED = id(2);
const FAILED = id(3);

const amounts = {
  itemQty: 2,
  subtotal: 1_200_000,
  discountType: 'amount',
  discountValue: 0,
  discountAmount: 0,
  afterDiscount: 1_200_000,
  shippingFee: 30_000,
  shippingFeeCharged: 30_000,
  freeShipping: false,
  surcharge: 0,
  gross: 1_230_000,
  total: 1_230_000,
  transferAmount: 0,
  paid: 0,
  remaining: 1_230_000,
  cod: 1_230_000,
};

type External = {
  state: 'pending' | 'pushed' | 'failed';
  code: string | null;
  status: string | null;
  error: { code: string; params?: Record<string, string> } | null;
};

const summary = (orderId: string, code: string, external: External) => ({
  id: orderId,
  code,
  status: 'new',
  source: 'facebook',
  customer: { name: 'Nguyễn Thị Lan', phone: '0912 345 678' },
  recipient: { name: 'Nguyễn Thị Lan', phone: '0912 345 678', address: '12 Lý Thường Kiệt' },
  carrier: null,
  trackingCode: null,
  noteInternal: '',
  amounts,
  itemsPreview: [
    {
      name: 'Áo thun cổ tròn',
      variantName: 'Trắng / M',
      qty: 2,
      unitPrice: 600_000,
      imageUrl: null,
    },
  ],
  itemCount: 1,
  createdByName: 'Ngọc Anh',
  createdByKind: 'agent',
  reviewState: null,
  reviewedByName: null,
  reviewedAt: null,
  conversationId: null,
  external,
  placedAt: now,
});

const detail = (s: ReturnType<typeof summary>) => ({
  ...s,
  warehouseId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e10',
  warehouseName: 'Kho chính',
  expectedDeliveryAt: null,
  notePrint: '',
  items: [
    {
      id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e11',
      variantId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e12',
      productName: 'Áo thun cổ tròn',
      variantName: 'Trắng / M',
      sku: 'AT-TRANG-M',
      qty: 2,
      unitPrice: 600_000,
      lineTotal: 1_200_000,
    },
  ],
  history: [{ fromStatus: null, toStatus: 'new', note: null, actorName: 'Ngọc Anh', at: now }],
  stockState: s.external.state === 'pushed' ? 'external' : 'reserved',
  createdAt: now,
  updatedAt: now,
});

/** Orders whose push states change: "Thử lại" turns the failed one back to pending. */
async function mockOrders(page: Page) {
  const retries: string[] = [];
  const orders = [
    summary(PENDING, 'DH000101', { state: 'pending', code: null, status: null, error: null }),
    summary(PUSHED, 'DH000102', {
      state: 'pushed',
      code: 'DHKV000987',
      status: 'confirmed',
      error: null,
    }),
    summary(FAILED, 'DH000103', {
      state: 'failed',
      code: null,
      status: null,
      // A long product name must wrap, not widen the page.
      error: { code: 'unlinked_product', params: { name: LONG } },
    }),
  ];
  await page.route('**/api/v1/orders**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/orders')
      return route.fulfill({
        json: {
          data: orders,
          total: orders.length,
          page: 1,
          pageSize: 20,
          counts: { all: orders.length, new: orders.length },
          totals: {
            itemQty: 6,
            shippingFeeCharged: 90_000,
            cod: 3_690_000,
            gross: 3_690_000,
            total: 3_690_000,
          },
          facets: { creators: [], carriers: [] },
        },
      });
    const one = orders.find((o) => path === `/orders/${o.id}`);
    if (one) return route.fulfill({ json: detail(one) });
    return route.fallback();
  });
  await page.route('**/api/v1/integrations/kiotviet/orders/*/push', (route) => {
    const orderId = new URL(route.request().url()).pathname.split('/').at(-2) ?? '';
    retries.push(`${route.request().method()} ${orderId}`);
    const o = orders.find((x) => x.id === orderId);
    if (!o || o.external.state !== 'failed')
      return route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'x' } } });
    o.external = { state: 'pending', code: null, status: null, error: null };
    return route.fulfill({ status: 202, body: '' });
  });
  return retries;
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
}

test('the orders list shows the push states and "Thử lại" queues the push again', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page);
  const retries = await mockOrders(page);

  await page.goto('/app/orders');
  const table = page.getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'KiotViet' })).toBeVisible();
  await expect(table.getByText('Đang đẩy')).toBeVisible();
  await expect(table.getByText('Đã đẩy · DHKV000987')).toBeVisible();
  await expect(table.getByText('Lỗi', { exact: true })).toBeVisible();
  await expectNoOverflow(page, 'list @1280');

  await table.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Đã gửi lại đơn sang KiotViet.')).toBeVisible();
  expect(retries).toEqual([`POST ${FAILED}`]);
  // Still on the list (the row click did not fire), now with two pushes pending.
  await expect(page).toHaveURL(/\/app\/orders$/);
  await expect(table.getByText('Đang đẩy')).toHaveCount(2);
  await expect(table.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [375, 1280]) {
  test(`the order page explains a failed push and retries it at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    const retries = await mockOrders(page);

    await page.goto('/app/orders');
    await expect(page.locator('text=DH000103 >> visible=true').first()).toBeVisible();
    await expectNoOverflow(page, `list @${width}`);

    await page.goto(`/app/orders/${PUSHED}`);
    await expect(page.getByRole('heading', { name: 'KiotViet' })).toBeVisible();
    await expect(page.getByText('Đã đẩy · DHKV000987')).toBeVisible();
    await expect(
      page.getByText('Đơn đã ở KiotViet — cập nhật trạng thái trên KiotViet'),
    ).toBeVisible();
    await expectNoOverflow(page, `pushed order @${width}`);

    await page.goto(`/app/orders/${FAILED}`);
    await expect(page.getByText(`Sản phẩm ${LONG} không có trên KiotViet`)).toBeVisible();
    await expectNoOverflow(page, `failed order @${width}`);
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByText('Đã gửi lại đơn sang KiotViet.')).toBeVisible();
    await expect(page.getByText('Đang đẩy')).toBeVisible();
    expect(retries).toEqual([`POST ${FAILED}`]);
    expect(errors).toEqual([]);
  });
}
