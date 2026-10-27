import { expect, test } from '@playwright/test';

/**
 * Statistics through the UI against the real backend: customers created in the CRM show up in the
 * numbers, a card opens exactly the rows it counts, the source filter is honest about what it
 * excludes, and filters survive a reload.
 */

const password = 'live e2e password 2026';
const email = `stat-${Date.now()}-${Math.round(Math.random() * 1e6)}@e2e.rapiz.test`;

test('numbers come from what was done in the CRM, and a card opens its own rows', async ({
  page,
}) => {
  const signup = await page.request.post('/api/v1/auth/signup', {
    data: {
      name: 'Chủ shop Thống kê',
      email,
      password,
      workspaceName: 'Shop Thống kê',
      industry: 'fashion',
    },
  });
  expect(signup.ok(), await signup.text()).toBe(true);
  const { accessToken } = (await signup.json()) as { accessToken: string };
  const boot = (await (
    await page.request.get('/api/v1/bootstrap', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  ).json()) as { memberships: Array<{ workspaceId: string }> };
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
  };
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`/api/v1${path}`, { headers, data });
    expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as { id: string };
  };

  const a = await post('/contacts', { name: 'Khách Một', phone: '0901234567' });
  await post('/contacts', { name: 'Khách Hai', phone: '0907654321' });
  await post('/contacts', { name: 'Khách Ba' });
  const tag = await post('/crm/tags', { name: 'VIP-E2E', type: 'classification' });
  await post(`/contacts/${a.id}/tags`, { tagId: tag.id });

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto('/app/analytics');
  const card = (name: string) =>
    page
      .getByRole('heading', { name, exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');

  // Three customers, two with a phone number, one tag added — all from the CRM ("Nhập tay").
  await expect(card('Khách hàng mới')).toContainText('3');
  await expect(card('Số điện thoại thu được')).toContainText('2');
  await page.getByRole('button', { name: 'Phân tích chi tiết', exact: true }).click();
  await expect(card('Nhãn được gắn')).toContainText('1');
  await expect(card('Nhãn bị gỡ')).toContainText('0');
  await expect(card('Khách đang có nhãn')).toContainText('1');
  await expect(page.getByText(/Múi giờ /)).toBeVisible();
  // A source that has no data feeds says so; it is not a 0.
  await expect(page.getByText('Chưa có nguồn dữ liệu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'VIP-E2E' }).first()).toBeVisible();

  // The card opens exactly the rows it counts.
  await page.getByRole('button', { name: /Chi tiết: Khách hàng mới/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('3 mục — bằng đúng số trên thẻ');
  for (const name of ['Khách Một', 'Khách Hai', 'Khách Ba']) {
    await expect(sheet.getByText(name)).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // The tag row narrows the drilldown to that tag's customer.
  await page.getByRole('button', { name: 'VIP-E2E' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Khách Một');
  await expect(page.getByRole('dialog')).not.toContainText('Khách Hai');
  await page.keyboard.press('Escape');

  // Only chat-channel customers: none exist yet, and the page says why instead of showing a bare 0.
  await page.getByRole('button', { name: 'Lọc thêm', exact: true }).click();
  await page.getByRole('button', { name: 'Nhập tay' }).click();
  await page.getByRole('button', { name: 'Nhập file' }).click();
  await expect(card('Khách hàng mới')).toContainText('0');
  await expect(page.getByText(/Chưa có khách nào từ kênh chat/)).toBeVisible();
  // The filter is in the URL, so a reload keeps it.
  await expect(page).toHaveURL(/origins/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Kênh chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Nhập tay' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(card('Khách hàng mới')).toContainText('0');

  // A bad range is explained and nothing is shown for it.
  await page.getByRole('button', { name: 'Chọn ngày', exact: true }).click();
  await page.getByLabel('Đến ngày').fill('2020-01-01');
  await expect(page.getByText('Ngày bắt đầu phải trước ngày kết thúc.')).toBeVisible();
});
