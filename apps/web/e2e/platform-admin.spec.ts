import { expect, test } from '@playwright/test';

import { mockApi } from './support/mock-api';
import { ADMIN_ACCOUNT_ID } from './support/mock-backoffice';

test('/admin opens the accounts list, and an account opens its detail', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/accounts$/);
  await expect(page.getByRole('heading', { name: 'Tài khoản' })).toBeVisible();
  for (const entry of ['Thanh toán', 'Gói cước', 'Cài đặt thanh toán', 'Mô hình AI'])
    await expect(page.getByRole('link', { name: entry, exact: true }).first()).toBeAttached();

  await page.getByRole('link', { name: /Phương Thảo 1$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/accounts/${ADMIN_ACCOUNT_ID}$`));
  await expect(page.getByText('Tin AI trong chu kỳ')).toBeVisible();

  // Every operator action asks for a reason before it can be confirmed.
  await page.getByRole('button', { name: 'Tạm khoá' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Tạm khoá' })).toBeDisabled();
  await dialog.getByLabel('Lý do').fill('unpaid invoice');
  await expect(dialog.getByRole('button', { name: 'Tạm khoá' })).toBeEnabled();
});

test('the plan editor is generated from the entitlement keys', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/plans');
  await page.getByRole('button', { name: 'Thêm gói' }).click();
  const dialog = page.getByRole('dialog');
  for (const label of ['Số thành viên', 'Số kênh', 'Chat trên website', 'Kênh Lazada'])
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Tạo gói' })).toBeDisabled();
});
