import { createHmac } from 'node:crypto';

import { expect, test } from '@playwright/test';

/**
 * Two-step verification through the UI against the real backend (ADM-04):
 * turn it on with an authenticator code, sign in again with a code, use a
 * recovery code, turn it off.
 */

const password = 'live e2e password 2026';
const email = `sec-${Date.now()}-${Math.round(Math.random() * 1e6)}@e2e.rapiz.test`;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, step: number): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = (h[h.length - 1] as number) & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const step = () => Math.floor(Date.now() / 30_000);

test('two-step verification: enable, sign in with a code, recovery code, disable', async ({
  page,
}) => {
  // The account comes from the API; everything about two-step verification goes through the UI.
  const signup = await page.request.post('/api/v1/auth/signup', {
    data: {
      name: 'Chủ shop Bảo mật',
      email,
      password,
      workspaceName: 'Shop Bảo mật',
      industry: 'fashion',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto('/app/settings/security');
  await page.getByRole('button', { name: 'Bật xác minh 2 bước' }).click();
  await page.getByLabel('1. Xác nhận mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Tiếp tục' }).click();

  const secret = (await page.locator('code').first().textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.getByAltText(/Mã QR/)).toBeVisible();
  await page.getByLabel('3. Nhập mã 6 số hiện trên ứng dụng').fill(totp(secret, step()));
  await page.getByRole('button', { name: 'Xác nhận' }).click();

  await expect(page.getByRole('heading', { name: 'Lưu các mã khôi phục' })).toBeVisible();
  const codes = await page.locator('li.font-mono, ul.font-mono li').allTextContents();
  expect(codes).toHaveLength(8);
  await page.getByRole('button', { name: 'Tôi đã lưu các mã' }).click();
  await expect(page.getByText('Đang bật')).toBeVisible();
  await expect(page.getByText('Còn 8 mã khôi phục')).toBeVisible();

  // Sign in again: password, then a code (the next step: the enabling one is burned).
  await page.evaluate(() => sessionStorage.clear());
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Xác minh 2 bước' })).toBeVisible();
  await page.getByLabel('Mã xác minh').fill('000000');
  await page.getByRole('button', { name: 'Xác minh' }).click();
  await expect(page.getByRole('alert')).toContainText('Mã không đúng');
  await page.getByLabel('Mã xác minh').fill(totp(secret, step() + 1));
  await page.getByRole('button', { name: 'Xác minh' }).click();
  await expect(page).toHaveURL(/\/app/);

  // Disable with a recovery code.
  await page.goto('/app/settings/security');
  await page.getByRole('button', { name: 'Tắt xác minh 2 bước' }).click();
  await page.getByLabel('Mật khẩu hiện tại').fill('wrong password here');
  await page.getByLabel('Mã xác minh hoặc mã khôi phục').fill(codes[0] ?? '');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByRole('alert')).toContainText('Mật khẩu không đúng');
  await page.getByLabel('Mật khẩu hiện tại').fill(password);
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText('Đang tắt')).toBeVisible();
});
