import { expect, test } from '@playwright/test';

import { BOT_ID, mockApi } from './support/mock-api';

test('business profile: fill a field, save, reload and the value is kept', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  await expect(page.getByRole('heading', { name: 'Thông tin doanh nghiệp' })).toBeVisible();
  await expect(page.getByText('Mẫu: Thời trang (theo business)')).toBeVisible();

  const save = page.getByRole('button', { name: 'Lưu thay đổi' });
  await expect(save).toBeDisabled();
  await page.getByLabel(/^Hotline/).fill('0901 234 567');
  await page.getByLabel(/^Bảng size/).fill('S: 45-52kg');
  await page.getByLabel(/^Ghi chú thêm/).fill('Nghỉ thứ Hai');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByText('Đã điền 3/11')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/^Hotline/)).toHaveValue('0901 234 567');
  await expect(page.getByLabel(/^Bảng size/)).toHaveValue('S: 45-52kg');
  await expect(page.getByLabel(/^Ghi chú thêm/)).toHaveValue('Nghỉ thứ Hai');
  await expect(page.getByRole('heading', { name: 'Câu hỏi thường gặp khác' })).toBeVisible();
});

test('business profile: leaving with unsaved changes asks first', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  await page.getByLabel(/^Hotline/).fill('0901');
  await page.getByRole('link', { name: 'Hướng dẫn trả lời' }).first().click();
  await expect(page.getByText('Rời trang sẽ mất các thay đổi chưa lưu.')).toBeVisible();
  await page.getByRole('button', { name: 'Ở lại' }).click();
  await expect(page.getByLabel(/^Hotline/)).toHaveValue('0901');
});
