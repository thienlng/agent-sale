import { expect, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

const NEW_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d31';
const ACCOUNT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';

test('signup on one page: the emailed code before the account, then the first business', async ({
  page,
}) => {
  await mockApi(page);
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
  const memberships: unknown[] = [];
  const accounts: unknown[] = [];
  const posted: Record<string, unknown> = {};
  const auth = () => ({ accessToken: 'token', expiresIn: 900, user });
  let signedUp = false;

  await page.route('**/api/v1/auth/signup/code', (route) => {
    posted['code'] = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/auth/signup', (route) => {
    const body = route.request().postDataJSON() as { code: string };
    posted['signup'] = body;
    if (body.code !== '123456') {
      return route.fulfill({
        status: 400,
        json: {
          error: { code: 'VALIDATION_FAILED', message: 'bad', details: { reason: 'code_invalid' } },
        },
      });
    }
    signedUp = true;
    return route.fulfill({ status: 201, json: auth() });
  });
  await page.route('**/api/v1/auth/refresh', (route) =>
    signedUp
      ? route.fulfill({ json: auth() })
      : route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'no' } } }),
  );
  await page.route('**/api/v1/bootstrap', (route) =>
    route.fulfill({ json: { user, memberships, accounts } }),
  );
  await page.route('**/api/v1/auth/signup/business', (route) => {
    posted['business'] = route.request().postDataJSON();
    accounts.push({ accountId: ACCOUNT, name: 'Shop Lan', role: 'owner' });
    memberships.push({
      workspaceId: NEW_ID,
      workspaceName: 'Shop Lan',
      role: 'owner',
      industry: 'retail',
      accountId: ACCOUNT,
      accountName: 'Shop Lan',
    });
    return route.fulfill({ status: 201, json: { workspaceId: NEW_ID } });
  });

  await page.goto('/signup');
  await expect(page.getByLabel('Lĩnh vực')).toHaveCount(0);
  await page.getByLabel('Họ và tên').fill('Nguyễn Lan');
  await page.getByLabel('Email').fill('lan@shop.vn');
  await page.getByLabel('Mật khẩu').fill('a-strong-password');
  // No account without the code.
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page.getByRole('alert')).toContainText('Gửi mã');
  expect(posted['signup']).toBeUndefined();

  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByRole('status')).toContainText('lan@shop.vn');
  expect(posted['code']).toEqual({ email: 'lan@shop.vn', name: 'Nguyễn Lan' });
  await expect(page.getByRole('button', { name: /Gửi lại mã sau/ })).toBeDisabled();

  await page.getByLabel('Mã xác minh').fill('000000');
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page.getByRole('alert')).toContainText('Mã không đúng');

  await page.getByLabel('Mã xác minh').fill('123456');
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  expect(posted['signup']).toEqual({
    name: 'Nguyễn Lan',
    email: 'lan@shop.vn',
    password: 'a-strong-password',
    code: '123456',
    client: 'web',
  });

  await expect(page).toHaveURL(/\/app\/businesses\/new/);
  await page.getByLabel('Tên business').fill('Shop Lan');
  await page.getByRole('button', { name: 'Tạo business', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/analytics/);
  expect(posted['business']).toEqual({ workspaceName: 'Shop Lan', industry: 'retail' });
});

test('signup refuses an email that already has an account before sending a code', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'no' } } }),
  );
  await page.route('**/api/v1/auth/signup/code', (route) =>
    route.fulfill({ status: 409, json: { error: { code: 'CONFLICT', message: 'taken' } } }),
  );
  await page.goto('/signup');
  await page.getByLabel('Email').fill('lan@shop.vn');
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByRole('alert')).toContainText('đã có tài khoản');
});

test('forgot password: the email, then the code and a new password', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'no' } } }),
  );
  const posted: unknown[] = [];
  await page.route('**/api/v1/auth/password/*', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });

  await page.goto('/login');
  await page.getByRole('link', { name: 'Quên mật khẩu?' }).click();
  await page.getByLabel('Email').fill('lan@shop.vn');
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await page.getByLabel('Mã xác minh').fill('654321');
  await page.getByLabel('Mật khẩu mới').fill('another-password');
  await page.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();

  await expect(page).toHaveURL(/\/login/);
  expect(posted).toEqual([
    { email: 'lan@shop.vn' },
    { email: 'lan@shop.vn', code: '654321', password: 'another-password' },
  ]);
});
