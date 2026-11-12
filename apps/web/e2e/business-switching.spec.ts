import { expect, test, type Page } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * Choosing, creating and losing a business (T-079), through the account layer (T-126): without a
 * chosen business the user lands on the overview, whose sidebar lists businesses by account.
 * The API is mocked; see mock-api.ts.
 */
const X = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const Y = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02';
const A = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20';
const B = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d21';
const C = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d22';
const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'hoa@example.test',
  name: 'Hoa',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: false,
};
const business = (
  workspaceId: string,
  workspaceName: string,
  accountId: string,
  accountName: string,
  role = 'owner',
) => ({
  workspaceId,
  workspaceName,
  role,
  industry: 'fashion',
  accountId,
  accountName,
});
const lost = {
  error: {
    code: 'NOT_FOUND',
    message: 'Workspace not found',
    details: { reason: 'workspace_access' },
  },
};

/** Bootstrap answers with the current `memberships`; tests change them as the server would. */
async function setup(page: Page, initial: ReturnType<typeof business>[]) {
  const state = { memberships: initial };
  await mockApi(page);
  await page.route('**/api/v1/bootstrap', (route) =>
    route.fulfill({
      json: {
        user,
        accounts: [{ accountId: X, name: 'Hoa Group', role: 'owner' }],
        memberships: state.memberships,
      },
    }),
  );
  return state;
}

test('a user with several businesses chooses one from the gallery after login', async ({
  page,
}) => {
  await setup(page, [
    business(A, 'Hoa Fashion', X, 'Hoa Group'),
    business(B, 'Minh English', Y, 'Minh', 'sales'),
  ]);
  // A deep link without a chosen business goes to the account overview first.
  await page.goto('/app/bots');
  await expect(page).toHaveURL(/\/app\/overview$/);
  // "My businesses" opens the gallery; a business of someone else's account names that account.
  await page
    .getByRole('navigation', { name: 'Điều hướng tài khoản' })
    .getByRole('link', { name: /Business của tôi/ })
    .click();
  await expect(page).toHaveURL(/\/app\/businesses$/);
  const gallery = page.getByRole('main');
  await expect(gallery.getByRole('button', { name: 'Mở business Hoa Fashion' })).toBeVisible();
  await expect(gallery.getByText('Thuộc tài khoản Minh')).toBeVisible();
  await expect(gallery.getByText('Thuộc tài khoản Hoa Group')).toHaveCount(0);
  await gallery.getByRole('button', { name: 'Mở business Minh English' }).click();
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Minh English',
  );

  // Remembered on reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Minh English',
  );
});

test('a user without a business creates one and lands in it', async ({ page }) => {
  const state = await setup(page, []);
  let created: unknown;
  await page.route('**/api/v1/workspaces', async (route) => {
    created = route.request().postDataJSON();
    state.memberships = [business(C, 'Hoa Spa', X, 'Hoa Group')];
    await route.fulfill({
      status: 201,
      json: {
        id: C,
        name: 'Hoa Spa',
        industry: 'retail',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '2026-10-28T08:00:00.000Z',
      },
    });
  });
  await page.goto('/app/analytics');
  await expect(page).toHaveURL(/\/app\/businesses\/new$/);
  await expect(page.getByRole('heading', { name: 'Tạo business đầu tiên' })).toBeVisible();
  await page.getByLabel('Tên business').fill('Hoa Spa');
  await page.getByRole('button', { name: 'Tạo business' }).click();
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Hoa Spa',
  );
  expect(created).toEqual({ name: 'Hoa Spa', industry: 'retail' });
});

test('losing the current business mid-session lands on the overview with a notice', async ({
  page,
}) => {
  const state = await setup(page, [
    business(A, 'Hoa Fashion', X, 'Hoa Group'),
    business(B, 'Minh English', Y, 'Minh', 'sales'),
    business(C, 'Hoa Spa', X, 'Hoa Group'),
  ]);
  await page.addInitScript((id) => localStorage.setItem('rapiz.workspace', id), B);
  await page.goto('/app/analytics');
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Minh English',
  );

  // Minh removes Hoa: every request for B now answers with the guard's reason.
  state.memberships = state.memberships.filter((m) => m.workspaceId !== B);
  await page.route('**/api/v1/**', (route) =>
    route.request().headers()['x-workspace-id'] === B
      ? route.fulfill({ status: 404, json: lost })
      : route.fallback(),
  );
  // The next request for B loses it: this click, or a background refresh of the statistics page
  // (Today's counts) that can win the race and unmount the sidebar first.
  await page
    .getByRole('navigation', { name: 'Điều hướng chính' })
    .getByRole('link', { name: /Đào tạo Bot/ })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
  await expect(page).toHaveURL(/\/app\/overview\?lost=true$/);
  await expect(page.getByRole('alert')).toContainText('Bạn không còn quyền truy cập business đó');
  await page
    .getByRole('navigation', { name: 'Điều hướng tài khoản' })
    .getByRole('link', { name: /Business của tôi/ })
    .click();
  const gallery = page.getByRole('main');
  await expect(gallery.getByRole('button', { name: 'Mở business Hoa Spa' })).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Mở business Minh English' })).toHaveCount(0);
  await gallery.getByRole('button', { name: 'Mở business Hoa Spa' }).click();
  await expect(page.getByRole('button', { name: 'Chọn business', exact: true })).toContainText(
    'Hoa Spa',
  );
});
