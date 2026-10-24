import {
  type APIRequestContext,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test';

/**
 * Customers against the real backend (CRM-01..04, BA cases C01–C11): create,
 * edit source/status/address, notes, tags and filters, each checked after a
 * reload. One new shop per run, so nothing needs cleaning up.
 */

const password = 'live e2e password 2026';
const email = `crm-${Date.now()}-${Math.round(Math.random() * 1e6)}@e2e.razpi.test`;
const NAME = `BA CRM ${Date.now()} KHONG LIEN HE`;

let api: APIRequestContext;
let page: Page;

type Contact = {
  id: string;
  address: string | null;
  sourceId: string | null;
  statusId: string | null;
  profileNote: string;
  tags: Array<{ tagId: string }>;
};

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}
const list = async (body: object = {}) =>
  json<{ total: number; data: Contact[] }>(
    await api.post('/api/v1/contacts/query', { data: body }),
  );
const option = async (kind: 'sources' | 'statuses', key: string) =>
  (
    await json<{ data: Array<{ id: string; key: string | null }> }>(
      await api.get(`/api/v1/crm/${kind}`),
    )
  ).data.find((o) => o.key === key);
const row = () => page.getByRole('row').filter({ hasText: NAME });

/** Picks an option from a shadcn Select by its label. */
async function choose(label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ baseURL, browser }) => {
  const anon = await playwrightRequest.newContext({ baseURL: baseURL ?? '' });
  const auth = await json<{ accessToken: string }>(
    await anon.post('/api/v1/auth/signup', {
      data: {
        name: 'Chủ shop CRM',
        email,
        password,
        workspaceName: 'Shop CRM E2E',
        industry: 'fashion',
      },
    }),
  );
  const boot = await json<{ memberships: Array<{ workspaceId: string }> }>(
    await anon.get('/api/v1/bootstrap', {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    }),
  );
  await anon.dispose();
  api = await playwrightRequest.newContext({
    baseURL: baseURL ?? '',
    extraHTTPHeaders: {
      authorization: `Bearer ${auth.accessToken}`,
      'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
    },
  });

  page = await browser.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
});

test.afterAll(async () => {
  await page?.close();
  await api?.dispose();
});

test('a name-only customer is created once and survives a reload (C01)', async () => {
  await page.goto('/app/contacts');
  await expect(page.getByRole('heading', { name: 'Khách hàng', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Thêm khách hàng' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Họ và tên').fill(NAME);
  // Double click: the form's request id makes it one customer.
  await dialog.getByRole('button', { name: 'Thêm', exact: true }).dblclick();
  await expect(page.getByText('Đã thêm khách hàng')).toBeVisible();
  // The new customer opens in the drawer; close it to see the list.
  await expect(page.getByRole('dialog').getByRole('heading', { name: NAME })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(row()).toHaveCount(1);
  expect((await list({ q: NAME })).total).toBe(1);
});

test('source, status and address are saved on the profile and shown in the list (C02–C05)', async () => {
  await page.goto('/app/contacts');
  await row().getByRole('button', { name: NAME }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Chi tiết' }).click();
  await sheet.getByLabel('Địa chỉ', { exact: true }).fill('12 Lê Lợi, Quận 1');
  await choose('Nguồn khách hàng', 'Hotline');
  await choose('Trạng thái', 'Trial');
  await sheet.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu khách hàng')).toBeVisible();

  const [hotline, trial] = await Promise.all([
    option('sources', 'hotline'),
    option('statuses', 'trial'),
  ]);
  const saved = (await list({ q: NAME })).data[0];
  expect(saved).toMatchObject({
    address: '12 Lê Lợi, Quận 1',
    sourceId: hotline?.id,
    statusId: trial?.id,
  });

  await page.keyboard.press('Escape');
  await page.reload();
  await expect(row()).toContainText('Trial');
  await expect(row()).toContainText('Hotline');
});

test('a note keeps author and time and does not touch the profile note (C06)', async () => {
  await page.goto('/app/contacts');
  await row().getByRole('button', { name: NAME }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Trao đổi nội bộ').fill('Gọi lại chiều mai');
  await sheet.getByRole('button', { name: 'Thêm ghi chú' }).click();
  await expect(sheet.getByText('Gọi lại chiều mai')).toBeVisible();
  await expect(sheet.getByText('Chủ shop CRM').first()).toBeVisible();

  // The open customer is in the URL: a reload reopens the drawer.
  await page.reload();
  await expect(page.getByRole('dialog').getByText('Gọi lại chiều mai')).toBeVisible();
  expect((await list({ q: NAME })).data[0]?.profileNote).toBe('');

  await page.getByRole('dialog').getByRole('tab', { name: 'Lịch sử' }).click();
  await expect(page.getByRole('dialog').getByText('Thêm ghi chú', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Đổi trạng thái', { exact: true })).toBeVisible();
});

test('a classification tag is created, attached and found after a reload (C11)', async () => {
  const tagName = `BA-LAB-${Date.now()}`;
  await page.goto('/app/crm-settings/tags');
  await page.getByRole('button', { name: 'Tạo tag' }).click();
  await page.getByRole('dialog').getByLabel('Tên tag').fill(tagName);
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText(`Đã tạo tag ${tagName}`)).toBeVisible();

  await page.goto('/app/contacts');
  await row().getByRole('button', { name: NAME }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Chi tiết' }).click();
  await sheet.getByRole('button', { name: 'Gắn tag' }).click();
  await page.getByRole('option', { name: new RegExp(tagName) }).click();
  await expect(page.getByText('Đã gắn tag')).toBeVisible();

  // A fresh load of the list (no customer open) shows the chip in the row.
  await page.goto('/app/contacts');
  await expect(row()).toContainText(tagName);
  expect((await list({ q: NAME })).data[0]?.tags).toHaveLength(1);
});

test('the filter builder finds the customer by name and by "any" rules (C07–C08)', async () => {
  await api.post('/api/v1/contacts', { data: { name: 'Người khác hẳn', phone: '0912345678' } });
  await page.goto('/app/contacts');
  await page.getByRole('button', { name: /^Lọc/ }).click();
  await page.getByRole('button', { name: 'Thêm điều kiện' }).click();
  await page.getByLabel('Giá trị 1').fill('BA CRM');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(row()).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Người khác hẳn' })).toHaveCount(0);

  // The filter lives in the URL: a reload keeps it.
  await page.reload();
  await expect(row()).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Người khác hẳn' })).toHaveCount(0);

  // Any: name contains BA CRM OR phone is set → both customers.
  await page.getByRole('button', { name: /^Lọc/ }).click();
  await page.getByRole('button', { name: 'Thêm điều kiện' }).click();
  await choose('Trường 2', 'Số điện thoại');
  await choose('Phép so sánh 2', 'có giá trị');
  await page.getByRole('radio', { name: 'Thoả một trong' }).click();
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Người khác hẳn' })).toHaveCount(1);
  await expect(row()).toHaveCount(1);
});
