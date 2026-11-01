import { expect, type Page, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * KiotViet connect flow (spec §6.3): hub → credentials → branches → preview → start. The API is
 * stateful: after connect the list answers "syncing" once, then "connected", so the page moves from
 * the wizard to the connection view on its own polling.
 */
const BRANCHES = [
  { id: 11, name: 'Chi nhánh Cầu Giấy', address: '12 Trần Thái Tông, Cầu Giấy, Hà Nội' },
  { id: 12, name: 'Chi nhánh Quận 1 — Nguyễn Thị Minh Khai', address: null },
];

function connection(status: 'syncing' | 'connected') {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01',
    provider: 'kiotviet',
    status,
    retailer: 'shopabc',
    clientIdMasked: 'abcd••••wxyz',
    settings: { saleBranchIds: [11], orderBranchId: 11, pushOrders: true, syncCustomers: true },
    branches: BRANCHES,
    counts: { products: status === 'connected' ? 1240 : 0, customers: 0, ordersPushed: 0 },
    progress: status === 'syncing' ? { phase: 'products', done: 300, total: 1240 } : null,
    lastSyncAt: status === 'connected' ? new Date().toISOString() : null,
    lastError: null,
    version: status === 'connected' ? 2 : 1,
  };
}

const list = (conn: ReturnType<typeof connection> | null) => ({
  providers: ['kiotviet', 'sapo', 'haravan', 'pancake_pos'].map((provider) => ({
    provider,
    available: provider === 'kiotviet',
    connection: provider === 'kiotviet' ? conn : null,
  })),
});

interface Calls {
  test: unknown[];
  connect: unknown[];
}

/** Routes registered after `mockApi` win, so this overrides its not-connected `/integrations`. */
async function mockIntegrations(page: Page): Promise<Calls> {
  const calls: Calls = { test: [], connect: [] };
  let connected = false;
  let listReadsSinceConnect = 0;
  await page.route('**/api/v1/integrations**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/integrations' && method === 'GET') {
      if (!connected) return route.fulfill({ json: list(null) });
      listReadsSinceConnect += 1;
      return route.fulfill({
        json: list(connection(listReadsSinceConnect === 1 ? 'syncing' : 'connected')),
      });
    }
    if (path === '/integrations/kiotviet/test' && method === 'POST') {
      calls.test.push(request.postDataJSON());
      return route.fulfill({
        json: {
          retailer: 'shopabc',
          branches: BRANCHES,
          preview: { matched: 120, created: 30, rapizOnly: 5, scanned: 155, total: 155 },
        },
      });
    }
    if (path === '/integrations/kiotviet' && method === 'POST') {
      calls.connect.push(request.postDataJSON());
      connected = true;
      return route.fulfill({ status: 201, json: connection('syncing') });
    }
    if (path === '/integrations/kiotviet/log' && method === 'GET')
      return route.fulfill({
        json: {
          entries: connected
            ? [
                {
                  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f10',
                  level: 'info',
                  code: 'connected',
                  // What the backend logs (`SyncLogParams['connected']`).
                  params: { retailer: 'shopabc', branches: 1 },
                  at: new Date().toISOString(),
                },
              ]
            : [],
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'not mocked' } },
    });
  });
  return calls;
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
}

for (const width of [375, 768, 1280]) {
  test(`connects KiotViet and follows the first sync at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    const calls = await mockIntegrations(page);

    await page.goto('/app/integrations');
    await expect(page.getByRole('heading', { name: 'Tích hợp PMS', level: 1 })).toBeVisible();
    await expect(page.getByText('Sắp có')).toHaveCount(3);
    await expectNoOverflow(page, `hub @${width}`);
    await page.getByRole('link', { name: 'Kết nối KiotViet' }).click();

    // Step 1: credentials.
    await expect(page.getByText('Bước 1/3')).toBeVisible();
    await page.getByLabel('Tên gian hàng').fill('https://shopabc.kiotviet.vn');
    await page.getByLabel('Client ID', { exact: true }).fill('client-id-1234');
    await page.getByLabel('Mã bảo mật', { exact: true }).fill('secret-value');
    await expectNoOverflow(page, `credentials @${width}`);
    await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();

    // Step 2: branches. Ticking one branch also makes it the order branch.
    await expect(page.getByText('Bước 2/3')).toBeVisible();
    await page.getByRole('checkbox', { name: /Chi nhánh Cầu Giấy/ }).click();
    await expectNoOverflow(page, `branches @${width}`);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // Step 3: preview and start.
    await expect(page.getByText('Bước 3/3')).toBeVisible();
    await expect(
      page.getByText(
        '120 sản phẩm khớp theo mã · 30 sản phẩm mới · 5 sản phẩm chỉ có trên Rapiz (giữ nguyên)',
      ),
    ).toBeVisible();
    await expectNoOverflow(page, `preview @${width}`);
    await page.getByRole('button', { name: 'Bắt đầu đồng bộ' }).click();

    // Connected: syncing first, then connected on the next poll.
    await expect(page.getByRole('heading', { name: 'shopabc' })).toBeVisible();
    await expect(page.getByText('Đang nhập sản phẩm 300/1.240')).toBeVisible();
    await expectNoOverflow(page, `syncing @${width}`);
    await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Đang nhập sản phẩm 300/1.240')).toHaveCount(0);
    await expect(page.getByText('Đã kết nối gian hàng shopabc')).toBeVisible();
    await expectNoOverflow(page, `connected @${width}`);

    expect(calls.test).toEqual([
      {
        retailer: 'https://shopabc.kiotviet.vn',
        clientId: 'client-id-1234',
        clientSecret: 'secret-value',
      },
    ]);
    expect(calls.connect).toEqual([
      {
        retailer: 'https://shopabc.kiotviet.vn',
        clientId: 'client-id-1234',
        clientSecret: 'secret-value',
        settings: { saleBranchIds: [11], orderBranchId: 11, pushOrders: true, syncCustomers: true },
      },
    ]);
    expect(errors).toEqual([]);
  });
}
