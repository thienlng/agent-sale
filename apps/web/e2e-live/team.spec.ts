import { execFileSync } from 'node:child_process';

import {
  type APIRequestContext,
  type Browser,
  expect,
  type Page,
  request as playwrightRequest,
  test,
} from '@playwright/test';

/**
 * Members and access against the real backend: an owner invites a Sales member
 * through the UI, the invitee joins through the link, sees only what a Sales
 * member may, and receives customers through the source's auto-assignment.
 */

const password = 'live e2e password 2026';
const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const ownerEmail = `team-owner-${stamp}@e2e.rapiz.test`;
const salesEmail = `team-sales-${stamp}@e2e.rapiz.test`;

let ownerApi: APIRequestContext;
let ownerPage: Page;
let salesPage: Page;
let link = '';

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

async function signUp(baseURL: string, email: string, name: string) {
  const anon = await playwrightRequest.newContext({ baseURL });
  const auth = await json<{ accessToken: string }>(
    await anon.post('/api/v1/auth/signup', {
      data: { name, email, password, workspaceName: `Shop ${name}`, industry: 'fashion' },
    }),
  );
  const boot = await json<{ memberships: Array<{ workspaceId: string }> }>(
    await anon.get('/api/v1/bootstrap', {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    }),
  );
  await anon.dispose();
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: {
      authorization: `Bearer ${auth.accessToken}`,
      'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
    },
  });
}

async function logIn(browser: Browser, email: string) {
  const page = await browser.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//);
  return page;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ baseURL, browser }) => {
  ownerApi = await signUp(baseURL ?? '', ownerEmail, 'Chủ shop Đội');
  // The Sales member already has an account (their own shop) before being invited.
  await (await signUp(baseURL ?? '', salesEmail, 'Sales Mai')).dispose();
  ownerPage = await logIn(browser, ownerEmail);
  salesPage = await logIn(browser, salesEmail);
});

test.afterAll(async () => {
  await ownerPage?.close();
  await salesPage?.close();
  await ownerApi?.dispose();
});

test('on the free plan the single seat is taken: inviting shows the quota gate, an upgrade opens it', async () => {
  await ownerPage.goto('/app/members');
  await expect(ownerPage.getByTestId('seat-meter')).toContainText('Thành viên 1/1');
  await ownerPage.getByRole('button', { name: 'Mời thành viên' }).click();
  await expect(
    ownerPage.getByRole('dialog').getByText('Đã dùng hết số thành viên của gói'),
  ).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Đã hiểu' }).click();

  // The operator puts the shop on a paid plan (until payment approval exists, T-059).
  execFileSync(
    'pnpm',
    ['--dir', '../backend', 'workspace-plan', 'set', ownerEmail, 'sales_smart', '3'],
    {
      stdio: 'pipe',
    },
  );
  await ownerPage.reload();
  await expect(ownerPage.getByTestId('seat-meter')).toContainText('Thành viên 1/5');
});

test('the owner invites a Sales member and gets a link to share', async () => {
  await ownerPage.goto('/app/members');
  await expect(
    ownerPage.getByRole('heading', { name: 'Thành viên & quyền truy cập' }),
  ).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Mời thành viên' }).click();
  const dialog = ownerPage.getByRole('dialog');
  await dialog.getByLabel('Email người được mời').fill(salesEmail);
  await dialog.getByRole('radio', { name: /^Sales/ }).click();
  await dialog.getByRole('button', { name: 'Tạo link mời' }).click();
  link = await dialog.getByLabel('Link mời').inputValue();
  expect(link).toMatch(/\/join\?token=/);
  await dialog.getByRole('button', { name: 'Xong' }).click();
  await expect(ownerPage.getByRole('row').filter({ hasText: salesEmail })).toContainText(
    'Đang chờ',
  );
});

test('the invitee joins through the link and sees only Sales tools', async () => {
  await salesPage.goto(new URL(link).pathname + new URL(link).search);
  await expect(
    salesPage.getByText(/Bạn được mời vào Shop Chủ shop Đội với vai trò Sales/),
  ).toBeVisible();
  await salesPage.getByRole('button', { name: 'Tham gia' }).click();
  await expect(salesPage).toHaveURL(/\/app\/contacts/);

  const nav = salesPage.getByRole('navigation', { name: 'Điều hướng chính' });
  // On a customers page the group is open.
  await expect(nav.getByRole('link', { name: 'Danh sách khách hàng' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Cài đặt khách hàng' })).toHaveCount(0);

  await ownerPage.reload();
  await expect(ownerPage.getByRole('row').filter({ hasText: 'Sales Mai' })).toContainText('Sales');
});

test('new customers from Facebook go to the Sales member, who sees only theirs', async () => {
  await ownerPage.goto('/app/crm-settings/distribution');
  const card = ownerPage.getByRole('listitem').filter({ hasText: 'Facebook' });
  await card.getByRole('switch').click();
  await card.getByRole('checkbox', { name: 'Sales Mai' }).click();
  await card.getByRole('button', { name: 'Lưu' }).click();
  await expect(ownerPage.getByText('Đã lưu cách phân chia')).toBeVisible();

  const sources = await json<{ data: Array<{ id: string; key: string | null }> }>(
    await ownerApi.get('/api/v1/crm/sources'),
  );
  const facebook = sources.data.find((s) => s.key === 'facebook')?.id;
  await json(
    await ownerApi.post('/api/v1/contacts', {
      data: { name: 'Khách Facebook mới', sourceId: facebook },
    }),
  );
  await json(await ownerApi.post('/api/v1/contacts', { data: { name: 'Khách của chủ' } }));
  const members = await json<{ data: Array<{ userId: string; role: string }> }>(
    await ownerApi.get('/api/v1/members'),
  );
  const ownerId = members.data.find((m) => m.role === 'owner')?.userId;
  await json(
    await ownerApi.post('/api/v1/contacts', {
      data: { name: 'Khách riêng của chủ', salesUserId: ownerId },
    }),
  );

  await salesPage.goto('/app/contacts');
  const rows = salesPage.getByRole('row');
  await expect(rows.filter({ hasText: 'Khách Facebook mới' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Khách của chủ' })).toHaveCount(1); // unassigned: can be picked up
  await expect(rows.filter({ hasText: 'Khách riêng của chủ' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Khách Facebook mới' })).toContainText('Sales Mai');
});

test('removing a member who owns customers asks where they go, then leaves them unassigned', async () => {
  await ownerPage.goto('/app/members');
  await ownerPage.getByRole('button', { name: 'Xoá khỏi shop: Sales Mai' }).click();
  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog.getByText(/đang phụ trách 1 khách \(Sales\)/)).toBeVisible();
  // Nothing chosen yet: removal is not possible.
  await expect(dialog.getByRole('button', { name: 'Xoá thành viên' })).toBeDisabled();
  await dialog.getByRole('radio', { name: /Bỏ phụ trách/ }).click();
  await dialog.getByRole('button', { name: 'Xoá thành viên' }).click();
  await expect(ownerPage.getByText('Đã xoá thành viên')).toBeVisible();

  const found = await json<{ data: Array<{ name: string; salesUserId: string | null }> }>(
    await ownerApi.post('/api/v1/contacts/query', { data: { q: 'Khách Facebook mới' } }),
  );
  expect(found.data[0]).toMatchObject({ name: 'Khách Facebook mới', salesUserId: null });
  await ownerPage.reload();
  await expect(ownerPage.getByRole('row').filter({ hasText: 'Sales Mai' })).toContainText('Đã rời');
});
