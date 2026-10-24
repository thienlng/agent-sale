import { expect, type Page, test } from '@playwright/test';

const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'lan@shop.vn',
  name: 'Nguyễn Lan',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};
const workspaceId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20';

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** Logged-out visitor: the refresh cookie is missing. */
async function loggedOut(page: Page) {
  await page.route('**/api/v1/auth/refresh', (r) =>
    r.fulfill(json({ error: { code: 'UNAUTHENTICATED', message: 'no session' } }, 401)),
  );
}

/** Logged-in owner with one workspace and no bots yet (session hint + refresh cookie). */
async function loggedIn(page: Page) {
  await page.addInitScript(() => localStorage.setItem('razpi.session', '1'));
  await page.route('**/api/v1/auth/refresh', (r) =>
    r.fulfill(json({ accessToken: 'token', expiresIn: 900, user })),
  );
  await page.route('**/api/v1/bootstrap', (r) =>
    r.fulfill(
      json({ user, memberships: [{ workspaceId, workspaceName: 'Shop Lan', role: 'owner' }] }),
    ),
  );
  await page.route('**/api/v1/bots', (r) => r.fulfill(json({ data: [] })));
}

test('login renders in Vietnamese and in English', async ({ page }) => {
  await loggedOut(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập vào Rapiz' })).toBeVisible();

  await page.evaluate(() => localStorage.setItem('razpi.locale', 'en'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Log in to Rapiz' })).toBeVisible();
});

test('the dashboard requires a session', async ({ page }) => {
  await loggedOut(page);
  await page.goto('/app/bots');
  await expect(page).toHaveURL(/\/login\?redirect=/);
});

test('sidebar navigation is client-side (no page reload)', async ({ page }) => {
  await loggedIn(page);
  await page.goto('/app/bots');
  await expect(page.getByRole('heading', { name: 'Bot của bạn' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  for (const label of ['Đào tạo Bot', 'Tin nhắn đa kênh', 'Tích hợp nền tảng']) {
    await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
  }
  // Customers and orders are groups: their buttons open the sub-pages.
  await nav.getByRole('button', { name: 'Khách hàng' }).click();
  await expect(nav.getByRole('link', { name: 'Danh sách khách hàng' })).toBeVisible();
  await nav.getByRole('button', { name: 'Đơn hàng' }).click();
  await expect(nav.getByRole('link', { name: 'Danh sách đơn' })).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __marker: boolean }).__marker = true;
  });
  await nav.getByRole('link', { name: /Tin nhắn đa kênh/ }).click();
  await expect(page).toHaveURL(/\/app\/inbox$/);
  await expect(page.getByRole('heading', { name: 'Tin nhắn đa kênh' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker)).toBe(
    true,
  );
});

test('the admin area is hidden from non-admins', async ({ page }) => {
  await loggedIn(page);
  await page.goto('/admin/llm');
  await expect(page.getByText('404')).toBeVisible();
});
