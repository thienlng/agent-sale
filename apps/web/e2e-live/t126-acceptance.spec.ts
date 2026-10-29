import { randomUUID } from 'node:crypto';

import { type APIResponse, expect, type Page, test } from '@playwright/test';

/** Supporting acceptance uses only newly created synthetic businesses and real local APIs. */
const password = 'live e2e password 2026';
const stamp = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

type Subject = {
  email: string;
  token: string;
  workspaceId: string;
  workspaceName: string;
};
type Contact = { id: string; name: string; version: number; phone: string | null };
type Entitlements = {
  plan: { name: string };
  status: string;
  limits: Record<string, number | null>;
  aiIncludedMessages: { amount: number; periodDays: number } | null;
};

async function body<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} returned ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

async function subject(page: Page): Promise<Subject> {
  const suffix = stamp();
  const email = `t126-${suffix}@e2e.rapiz.test`;
  const workspaceName = `QA business ${suffix}`;
  const auth = await body<{ accessToken: string }>(
    await page.request.post('/api/v1/auth/signup', {
      data: { email, password, name: 'QA Owner', workspaceName, industry: 'fashion' },
    }),
  );
  const bootstrap = await body<{ memberships: Array<{ workspaceId: string }> }>(
    await page.request.get('/api/v1/bootstrap', {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    }),
  );
  return {
    email,
    token: auth.accessToken,
    workspaceId: bootstrap.memberships[0]?.workspaceId ?? '',
    workspaceName,
  };
}

function headers(owner: Subject, workspaceId = owner.workspaceId): Record<string, string> {
  return { authorization: `Bearer ${owner.token}`, 'x-workspace-id': workspaceId };
}

async function login(page: Page, owner: Subject): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/analytics/);
}

async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
}

test('invalid login recovers, protected deep links stay scoped and logout removes access', async ({
  page,
}, info) => {
  const owner = await subject(page);
  await page.goto('/app/contacts');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('an intentionally incorrect password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/contacts$/);
  await expect(page.getByRole('heading', { name: 'Khách hàng', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Khách hàng', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('authenticated-contacts-desktop.png') });
  await page.getByRole('button', { name: 'Tài khoản của QA Owner' }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/app/contacts');
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test('business switching isolates source records and survives reload on desktop and phone', async ({
  page,
}, info) => {
  const owner = await subject(page);
  const second = await body<{ id: string; name: string }>(
    await page.request.post('/api/v1/workspaces', {
      headers: headers(owner),
      data: { name: `QA second ${stamp()}`, industry: 'spa' },
    }),
  );
  const firstContact = await body<Contact>(
    await page.request.post('/api/v1/contacts', {
      headers: headers(owner),
      data: { name: 'QA first-business contact' },
    }),
  );
  const secondContact = await body<Contact>(
    await page.request.post('/api/v1/contacts', {
      headers: headers(owner, second.id),
      data: { name: 'QA second-business contact' },
    }),
  );
  const crossRead = await page.request.get(`/api/v1/contacts/${secondContact.id}`, {
    headers: headers(owner),
  });
  expect(crossRead.status()).toBe(404);
  const crossWrite = await page.request.patch(`/api/v1/contacts/${firstContact.id}`, {
    headers: headers(owner, second.id),
    data: { name: 'should not change', expectedVersion: firstContact.version },
  });
  expect(crossWrite.status()).toBe(404);
  await login(page, owner);
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page.getByRole('button', { name: owner.workspaceName, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    owner.workspaceName,
  );
  await page.goto('/app/contacts');
  await expect(page.getByRole('button', { name: firstContact.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: secondContact.name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Chọn business', exact: true }).click();
  await page.getByRole('button', { name: second.name, exact: true }).click();
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    second.name,
  );
  await page.goto('/app/contacts');
  await expect(page.getByRole('button', { name: secondContact.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: firstContact.name, exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: secondContact.name, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('contacts-mobile.png') });
  const unchanged = await body<Contact>(
    await page.request.get(`/api/v1/contacts/${firstContact.id}`, { headers: headers(owner) }),
  );
  expect(unchanged.name).toBe(firstContact.name);
});

test('the account panel reflects real entitlements and restores focus without business duplication', async ({
  page,
}, info) => {
  const owner = await subject(page);
  const entitlement = await body<Entitlements>(
    await page.request.get('/api/v1/billing/entitlements', { headers: headers(owner) }),
  );
  await login(page, owner);
  const avatar = page.getByRole('button', { name: 'Tài khoản của QA Owner' });
  await avatar.click();
  await expect(page.getByRole('menu')).toContainText(owner.email);
  await expect(page.getByRole('menu').getByRole('button', { name: 'Chọn business' })).toHaveCount(
    0,
  );
  await page.getByRole('menuitem', { name: 'Gói và thanh toán', exact: true }).click();
  const plan = page.getByRole('dialog');
  await expect(plan).toContainText(entitlement.plan.name);
  for (const [key, label] of [
    ['members.max', 'Thành viên'],
    ['channels.max', 'Kênh kết nối'],
    ['contacts.max', 'Khách hàng'],
    ['knowledge_items.max', 'Mục kiến thức cho bot'],
  ]) {
    if (key && label && key in entitlement.limits) {
      const amount = entitlement.limits[key];
      const row = plan.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) });
      await expect(row.locator('dd')).toHaveText(
        amount === null ? 'Không giới hạn' : new Intl.NumberFormat('vi-VN').format(amount ?? 0),
      );
    }
  }
  await plan.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(avatar).toBeFocused();
  await avatar.click();
  await page.getByRole('menuitem', { name: 'Màn hình và ngôn ngữ', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click();
  await expect(page.getByRole('menu')).toContainText('Display and language');
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('menuitem', { name: 'Bảo mật tài khoản', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(avatar).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  await avatar.click();
  await page.getByRole('menuitem', { name: 'Gói và thanh toán', exact: true }).click();
  await expect(plan).toContainText(entitlement.plan.name);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('plan-mobile.png') });
});

test('same-name customers remain distinct and stale or invalid writes cannot corrupt sources', async ({
  page,
}, info) => {
  const owner = await subject(page);
  const idempotencyKey = randomUUID();
  const create = () =>
    page.request.post('/api/v1/contacts', {
      headers: headers(owner),
      data: { name: 'QA duplicate display name', clientRequestId: idempotencyKey },
    });
  const first = await body<Contact>(await create());
  const repeated = await body<Contact>(await create());
  expect(repeated.id).toBe(first.id);
  const second = await body<Contact>(
    await page.request.post('/api/v1/contacts', {
      headers: headers(owner),
      data: { name: first.name, phone: '0900000126' },
    }),
  );
  expect(second.id).not.toBe(first.id);
  const invalid = await page.request.patch(`/api/v1/contacts/${first.id}`, {
    headers: headers(owner),
    data: { phone: 'not a phone', expectedVersion: first.version },
  });
  expect(invalid.status()).toBe(400);
  const saved = await body<Contact>(
    await page.request.patch(`/api/v1/contacts/${first.id}`, {
      headers: headers(owner),
      data: { address: 'Synthetic QA address', expectedVersion: first.version },
    }),
  );
  const stale = await page.request.patch(`/api/v1/contacts/${first.id}`, {
    headers: headers(owner),
    data: { name: 'should not overwrite', expectedVersion: first.version },
  });
  expect(stale.status()).toBe(409);
  const confirmed = await body<Contact>(
    await page.request.get(`/api/v1/contacts/${first.id}`, { headers: headers(owner) }),
  );
  expect(confirmed.name).toBe(first.name);
  expect(confirmed.phone).toBeNull();
  expect(confirmed.version).toBe(saved.version);
  await login(page, owner);
  await page.goto('/app/contacts');
  await expect(page.getByRole('button', { name: first.name, exact: true })).toHaveCount(2);
  await page.goto(`/app/contacts?contact=${first.id}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('heading', { name: first.name })).toBeVisible();
  await page.screenshot({ path: info.outputPath('same-name-contact-desktop.png') });
});
