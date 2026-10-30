import { defaultOrderPolicy, OrderSource } from '@agent-sales/contracts';
import type { Page } from '@playwright/test';

import { crmRoute } from './mock-crm';
import { analyticsRoute } from './mock-analytics';
import { settingsRoute } from './mock-settings';

/** Deliberately long Vietnamese content: layout must wrap or truncate, never overflow. */
export const LONG =
  'Cửa hàng thời trang công sở cao cấp chuyên áo sơ mi, quần âu và phụ kiện cho dân văn phòng tại Thành phố Hồ Chí Minh';

const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'chu.cua.hang.thoi.trang.cong.so@mot-ten-mien-rat-dai.vn',
  name: 'Nguyễn Thị Thanh Hương Lan',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: true,
};
export const BOT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d30';
const now = '2026-10-24T08:00:00.000Z';
const settings = {
  mission: LONG,
  greeting: 'Dạ Shop xin chào ạ!',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  useCustomerName: true,
  fallbackMessage: 'Dạ em kiểm tra lại ạ.',
  handoffMessage: 'Dạ em chuyển nhân viên ạ.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  placeholders: { 'store.name': LONG, 'store.address': '' },
  profile: { fields: { displayName: LONG }, notes: '' },
};
const bot = {
  id: BOT_ID,
  name: LONG,
  industry: 'fashion',
  isActive: true,
  settings,
  createdAt: now,
  updatedAt: now,
};
const faq = (i: number) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d4${i}`,
  botId: BOT_ID,
  question: `${LONG} — câu hỏi số ${i}?`,
  answer: `Dạ ${LONG}. Địa chỉ: {{store.address}}. Liên hệ https://mot-duong-dan-rat-dai.example.com/khong-co-dau-cach-nao-ca/${'x'.repeat(40)}`,
  source: i % 2 ? 'seed' : 'manual',
  missingPlaceholders: ['store.address'],
  updatedAt: now,
});
const provider = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d50',
  name: 'vllm-cum-may-chu-noi-bo-so-1',
  kind: 'openai_compatible',
  baseUrl: 'http://10.0.0.5:8000/v1/a-very-long-path-segment-for-testing',
  hasApiKey: true,
  apiKeyHint: '9876',
  options: { structuredOutput: 'json_schema', sendReasoningEffort: false, timeoutMs: 20000 },
  isEnabled: true,
  updatedAt: now,
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** A logged-in platform admin with one bot full of long content. */
export async function mockApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem('rapiz.session', '1'));
  // The bot is stateful so a PATCH (e.g. the business profile form) survives a reload.
  const current = structuredClone(bot);
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/refresh')
      return route.fulfill(json({ accessToken: 't', expiresIn: 900, user }));
    if (path === '/bootstrap')
      return route.fulfill(
        json({
          user,
          memberships: [
            {
              workspaceId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20',
              workspaceName: LONG,
              role: 'owner',
            },
          ],
        }),
      );
    if (path === '/bots')
      return route.fulfill(
        json({ data: [current, { ...current, id: `${BOT_ID.slice(0, -1)}1`, isActive: false }] }),
      );
    if (path === `/bots/${BOT_ID}` && route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()?.settings?.profile ?? {};
      const profile = current.settings.profile;
      for (const [key, v] of Object.entries<string>(patch.fields ?? {})) {
        if (v === '') delete (profile.fields as Record<string, string>)[key];
        else (profile.fields as Record<string, string>)[key] = v;
      }
      if (typeof patch.notes === 'string') profile.notes = patch.notes;
      return route.fulfill(json(current));
    }
    if (path === `/bots/${BOT_ID}`) return route.fulfill(json(current));
    if (path === `/bots/${BOT_ID}/readiness`)
      return route.fulfill(
        json({
          ready: false,
          missingPlaceholders: ['store.address'],
          checks: [
            { key: 'mission', done: true },
            { key: 'faq', done: true },
            { key: 'profile', done: false, detail: '3' },
            { key: 'channel', done: false },
          ],
        }),
      );
    if (path === `/bots/${BOT_ID}/faqs`)
      return route.fulfill(json({ data: [1, 2, 3, 4].map(faq) }));
    if (path === '/admin/llm/providers') return route.fulfill(json({ data: [provider] }));
    if (path === '/admin/llm/tiers')
      return route.fulfill(
        json({
          data: [
            {
              tier: 'smart',
              primary: {
                providerId: provider.id,
                model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-FP8',
                effort: 'low',
              },
              fallback: null,
              updatedAt: now,
            },
          ],
        }),
      );
    const analyticsMock = analyticsRoute(
      path,
      route.request().postDataJSON() as Record<string, unknown> | null,
    );
    if (analyticsMock !== undefined) return route.fulfill(json(analyticsMock));
    const settingsMock = settingsRoute(path);
    if (settingsMock !== undefined) return route.fulfill(json(settingsMock));
    const crm = crmRoute(path);
    if (crm !== undefined) return route.fulfill(json(crm));
    const commerce = commerceRoute(path);
    if (commerce !== undefined) return route.fulfill(json(commerce));
    return route.fulfill(json({ error: { code: 'NOT_FOUND', message: 'not mocked' } }, 404));
  });
}

// ─── commerce fixtures (long Vietnamese content, large amounts) ───────────────

export const ORDER_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d60';
export const PRODUCT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d70';
const WAREHOUSE_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d80';
const warehouse = {
  id: WAREHOUSE_ID,
  name: `Kho tổng ${LONG}`,
  phone: '0901234567',
  province: 'Thành phố Hồ Chí Minh',
  ward: 'Phường Bến Nghé',
  addressDetail: LONG,
  isDefault: true,
};
const variant = (i: number) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d7${i}`,
  sku: `SKU-RAT-DAI-${'X'.repeat(20)}-${i}`,
  name: `Màu xanh ngọc bích / Size XXXL / ${i}`,
  price: 123_456_789,
  cost: 99_000_000,
  weightGram: 1200,
  stock: [{ warehouseId: WAREHOUSE_ID, onHand: 12_345, reserved: 345, available: 12_000 }],
});
const product = {
  id: PRODUCT_ID,
  code: 'SP-0001-RAT-DAI',
  name: LONG,
  description: LONG,
  category: 'Thời trang công sở',
  status: 'active',
  visibleToBot: true,
  variants: [variant(1), variant(2)],
  priceMin: 123_456_789,
  priceMax: 123_456_789,
  available: 24_000,
  createdAt: now,
  updatedAt: now,
};
const amounts = {
  itemQty: 12,
  subtotal: 1_481_481_468,
  discountType: 'percent',
  discountValue: 10,
  discountAmount: 148_148_147,
  afterDiscount: 1_333_333_321,
  shippingFee: 35_000,
  shippingFeeCharged: 30_000,
  freeShipping: false,
  surcharge: 10_000,
  gross: 1_481_521_468,
  total: 1_333_373_321,
  transferAmount: 500_000_000,
  paid: 500_000_000,
  remaining: 833_373_321,
  cod: 833_373_321,
};
const summary = {
  id: ORDER_ID,
  code: 'DH000123',
  status: 'awaiting_handover',
  source: 'facebook',
  customer: { name: user.name, phone: '0912 345 678' },
  recipient: {
    name: user.name,
    phone: '0912 345 678',
    address: LONG,
    ward: 'Phường Bến Nghé',
    province: 'TP. Hồ Chí Minh',
  },
  carrier: 'Giao Hàng Tiết Kiệm',
  trackingCode: 'GHTK-1234567890-ABCDEFGH',
  noteInternal: LONG,
  amounts,
  itemsPreview: [
    { name: `${LONG} – Màu xanh ngọc bích / Size XXXL`, qty: 6 },
    { name: LONG, qty: 6 },
  ],
  createdByName: user.name,
  placedAt: now,
};
const order = {
  ...summary,
  warehouseId: WAREHOUSE_ID,
  warehouseName: warehouse.name,
  expectedDeliveryAt: now,
  notePrint: LONG,
  items: [1, 2].map((i) => ({
    id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d9${i}`,
    variantId: variant(i).id,
    productName: LONG,
    variantName: variant(i).name,
    sku: variant(i).sku,
    qty: 6,
    unitPrice: 123_456_789,
    lineTotal: 740_740_734,
  })),
  history: [
    { fromStatus: null, toStatus: 'new', note: null, actorName: user.name, at: now },
    { fromStatus: 'new', toStatus: 'awaiting_handover', note: LONG, actorName: user.name, at: now },
  ],
  stockState: 'reserved',
  createdAt: now,
  updatedAt: now,
};
const series = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, '0')}`,
  sales: 98_765_432_1 * (i % 5),
  revenue: 87_654_321 * (i % 4),
  profit: 12_345_678 * (i % 3),
  closedOrders: i,
  productQty: i * 3,
}));

/** Response for a commerce path, or undefined when the path is not a commerce endpoint. */
function commerceRoute(path: string): unknown {
  if (path === '/warehouses')
    return {
      data: [warehouse, { ...warehouse, id: `${WAREHOUSE_ID.slice(0, -1)}1`, isDefault: false }],
    };
  if (path === '/products')
    return {
      data: [product, product].map((p, i) => ({ ...p, id: `${PRODUCT_ID.slice(0, -1)}${i}` })),
      total: 45,
      page: 1,
      pageSize: 20,
    };
  if (path === `/products/${PRODUCT_ID}`) return product;
  if (path === '/product-variants') return { data: [] };
  if (path === '/orders')
    return {
      data: [summary, { ...summary, id: `${ORDER_ID.slice(0, -1)}1`, status: 'cancelled' }],
      total: 87,
      page: 1,
      pageSize: 20,
      counts: { all: 87, new: 12, awaiting_handover: 9_999, cancelled: 3 },
      totals: {
        itemQty: 123_456,
        shippingFeeCharged: 98_765_432,
        cod: 9_876_543_210,
        gross: 99_765_432_109,
        total: 98_765_432_109,
      },
      facets: {
        creators: [{ id: user.id, name: user.name }],
        carriers: ['Giao Hàng Nhanh', 'Viettel Post'],
      },
    };
  if (path === `/orders/${ORDER_ID}`) return order;
  if (path === '/orders/overview')
    return {
      from: '2026-10-01',
      to: '2026-10-31',
      timezone: 'Asia/Ho_Chi_Minh',
      kpis: {
        sales: 98_765_432_109,
        revenue: 87_654_321_098,
        profit: -1_234_567_890,
        closedOrders: 12_345,
        avgOrderValue: 7_100_000,
        productQty: 456_789,
        avgProductsPerOrder: 37.1,
        avgProfitPerOrder: -100_000,
      },
      closed: { amount: 87_654_321_098, productQty: 456_789 },
      returned: { amount: 1_234_567_890, productQty: 1_234 },
      series,
      today: {
        revenue: 1_234_567_890,
        closedOrders: 123,
        created: 456,
        cancelled: 7,
        productQty: 890,
        byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: hour * 12_345_678 })),
      },
      generatedAt: now,
    };
  if (path === '/order-settings')
    return {
      extraStatuses: ['awaiting_print', 'printed'],
      requireNoteStatuses: ['cancelled'],
      policies: OrderSource.options.map(defaultOrderPolicy),
      version: 3,
    };
  return undefined;
}
