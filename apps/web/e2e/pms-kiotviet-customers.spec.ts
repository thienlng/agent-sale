import { expect, type Page, test } from '@playwright/test';

import { mockApi } from './support/mock-api';
import { CONTACT_ID, crmRoute } from './support/mock-crm';

/**
 * KiotViet customers (PR 3): linked customers carry a "KiotViet" badge in the CRM list and the
 * drawer, the KiotViet-owned fields carry a hint and stay editable, and the connection view turns
 * customer sync on with `syncCustomers: true`. No horizontal overflow at 375 and 1280 px.
 */
const HINT = 'Đồng bộ từ KiotViet — sửa trên KiotViet để giữ thay đổi';
const link = { source: 'kiotviet', id: '5001' };

/** The CRM fixtures with the first customer linked to KiotViet (routes after `mockApi` win). */
async function mockLinkedContacts(page: Page) {
  await page.route('**/api/v1/contacts/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/contacts/query') {
      const page1 = crmRoute(path) as { data: Array<{ id: string }> };
      return route.fulfill({
        json: {
          ...page1,
          data: page1.data.map((c) => ({ ...c, external: c.id === CONTACT_ID ? link : null })),
        },
      });
    }
    if (path === `/contacts/${CONTACT_ID}`)
      return route.fulfill({ json: { ...(crmRoute(path) as object), external: link } });
    return route.fallback();
  });
}

function connection(syncCustomers: boolean, version: number) {
  return {
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01',
    provider: 'kiotviet',
    status: 'connected',
    retailer: 'shopabc',
    clientIdMasked: 'abcd••••wxyz',
    settings: { saleBranchIds: [11], orderBranchId: 11, pushOrders: true, syncCustomers },
    branches: [{ id: 11, name: 'Chi nhánh Cầu Giấy', address: null }],
    counts: { products: 1240, customers: 356, ordersPushed: 12 },
    progress: null,
    lastSyncAt: new Date().toISOString(),
    lastError: null,
    version,
  };
}

/** A connection with customer sync off; PATCH records its body and answers the saved settings. */
async function mockConnection(page: Page) {
  const patches: unknown[] = [];
  let current = connection(false, 3);
  await page.route('**/api/v1/integrations**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/integrations' && method === 'GET')
      return route.fulfill({
        json: {
          providers: ['kiotviet', 'sapo', 'haravan', 'pancake_pos'].map((provider) => ({
            provider,
            available: provider === 'kiotviet',
            connection: provider === 'kiotviet' ? current : null,
          })),
        },
      });
    if (path === '/integrations/kiotviet' && method === 'PATCH') {
      patches.push(request.postDataJSON());
      current = connection(true, 4);
      return route.fulfill({ json: current });
    }
    if (path === '/integrations/kiotviet/log' && method === 'GET')
      return route.fulfill({ json: { entries: [] } });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'not mocked' } },
    });
  });
  return patches;
}

async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: horizontal overflow (px)`).toBeLessThanOrEqual(0);
}

for (const width of [375, 1280]) {
  test(`linked customers show the KiotViet badge and field hint at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    await mockLinkedContacts(page);

    await page.goto('/app/contacts');
    // One linked customer among the eight on the page (cards on phones, the table otherwise).
    await expect(page.locator('text=KiotViet >> visible=true')).toHaveCount(1);
    await expectNoOverflow(page, `list @${width}`);

    await page.goto(`/app/contacts?contact=${CONTACT_ID}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('KiotViet', { exact: true })).toBeVisible();
    await drawer.getByRole('tab', { name: 'Chi tiết' }).click();
    await expect(drawer.getByText(HINT)).toBeVisible();
    const name = drawer.getByLabel('Họ và tên');
    await expect(name).toBeEditable();
    await expect(name).toHaveAccessibleDescription(HINT);
    await expectNoOverflow(page, `drawer @${width}`);
    expect(errors).toEqual([]);
  });

  test(`turning customer sync on saves syncCustomers: true at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    const patches = await mockConnection(page);

    await page.goto('/app/integrations/kiotviet');
    await expect(page.getByText('356')).toBeVisible();
    await expect(page.getByText('Sắp có')).toHaveCount(0);
    const customers = page.getByRole('switch', { name: 'Đồng bộ khách hàng' });
    await expect(customers).not.toBeChecked();
    await customers.click();
    await page.getByRole('button', { name: 'Lưu' }).click();
    await expect(page.getByText('Đã lưu cài đặt đồng bộ.')).toBeVisible();
    expect(patches).toEqual([
      {
        settings: { saleBranchIds: [11], orderBranchId: 11, pushOrders: true, syncCustomers: true },
        version: 3,
      },
    ]);
    await expect(customers).toBeChecked();
    await expectNoOverflow(page, `connection @${width}`);
    expect(errors).toEqual([]);
  });
}
