import { expect, test } from '@playwright/test';

import { makePng } from './support/png';

/** Shop profile, logo and the audit trail through the UI against the real backend (ADM-02). */

const password = 'live e2e password 2026';
const email = `profile-${Date.now()}-${Math.round(Math.random() * 1e6)}@e2e.rapiz.test`;

test('edit the profile, upload and remove a logo, see it in the audit trail', async ({ page }) => {
  const signup = await page.request.post('/api/v1/auth/signup', {
    data: {
      name: 'Chủ shop Hồ sơ',
      email,
      password,
      workspaceName: 'Shop Hồ sơ',
      industry: 'fashion',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto('/app/settings/profile');
  await page.getByLabel('Tên shop').fill('Cửa hàng Lan');
  await page.getByLabel('Tên công ty').fill('Công ty TNHH Lan');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin shop')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Tên công ty')).toHaveValue('Công ty TNHH Lan');

  // A rule-breaking file is explained, a good one is shown.
  await page
    .getByLabel('Chọn ảnh')
    .setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: makePng(300, 200) });
  await expect(page.getByText(/Ảnh phải là hình vuông/)).toBeVisible();
  await page
    .getByLabel('Chọn ảnh')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: makePng(256) });
  await expect(page.getByAltText('Logo của shop')).toBeVisible();
  await page.reload();
  await expect(page.getByAltText('Logo của shop')).toBeVisible();
  await page.getByRole('button', { name: 'Gỡ logo' }).click();
  // Exact: the icon picker's hint (T-129) also mentions "chưa có logo".
  await expect(page.getByText('Chưa có logo', { exact: true })).toBeVisible();

  await page.goto('/app/settings/audit');
  await expect(page.getByText('Cập nhật hồ sơ shop').first()).toBeVisible();
  await expect(page.getByText('Đổi logo').first()).toBeVisible();
  await expect(page.getByText('Gỡ logo').first()).toBeVisible();
});
