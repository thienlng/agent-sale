import { expect, type Page, test } from '@playwright/test';
import { mockApi, ORDER_ID, PRODUCT_ID } from './support/mock-api';

const id = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f${String(n).padStart(2, '0')}`;
const names = ['Nguyễn Minh Anh', 'Trần Hoàng Nam'] as const;
const fixedNow = '2026-10-25T10:00:00Z';
async function inboxApi(page: Page) {
  await mockApi(page);
  await page.clock.setFixedTime(new Date(fixedNow));
  const conversations = names.map((customerName, index) => ({
    id: id(index + 1),
    channelId: id(10),
    provider: 'facebook',
    customerId: `meta-${index}`,
    customerName,
    mode: 'human',
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: 'Khách muốn nhận hàng cuối tuần',
    revision: 1,
    lastMessage: 'Áo này còn size M không shop?',
    lastInboundAt: fixedNow,
    updatedAt: fixedNow,
  }));
  await page.route('**/api/v1/conversations**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const conversation = conversations.find((item) => path.endsWith(item.id));
    if (path.endsWith('/conversations')) return route.fulfill({ json: { data: conversations } });
    if (!conversation) return route.fallback();
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      if (body.expectedRevision !== undefined && body.expectedRevision !== conversation.revision)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'Stale conversation' } },
        });
      Object.assign(conversation, body, { revision: conversation.revision + 1 });
      return route.fulfill({ json: conversation });
    }
    return route.fulfill({
      json: {
        conversation,
        messages: Array.from({ length: 18 }, (_, i) => ({
          id: id(20 + i),
          conversationId: conversation.id,
          direction: i % 2 ? 'outbound' : 'inbound',
          sender: i % 2 ? 'human' : 'customer',
          text:
            i % 2
              ? 'Dạ size M còn hàng, em gửi thông tin cho chị nhé.'
              : 'Áo này còn size M không shop?',
          attachments: [],
          status: i % 2 ? 'sent' : 'received',
          failureCode: null,
          externalId: null,
          createdAt: fixedNow,
        })),
      },
    });
  });
  await page.route('**/api/v1/channels', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: id(10),
            provider: 'facebook',
            externalId: 'page',
            name: 'Thời trang Nhà Mây',
            status: 'connected',
            botId: null,
            expiresAt: null,
            createdAt: fixedNow,
          },
        ],
        providers: [],
      },
    }),
  );
  await page.route('**/api/v1/product-variants?**', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            variantId: id(70),
            productId: PRODUCT_ID,
            productCode: 'SHIRT',
            productName: 'Áo sơ mi linen dáng rộng',
            variantName: 'Trắng / M',
            sku: 'LINEN-M',
            price: 250000,
            available: 12,
          },
        ],
      },
    }),
  );
  return conversations;
}
async function openCustomer(page: Page, index: 0 | 1 = 0) {
  await page.getByRole('button', { name: new RegExp(names[index] ?? '') }).click();
  await expect(page.getByRole('heading', { name: names[index], exact: true })).toBeVisible();
}
async function openPanel(page: Page) {
  const details = page.getByRole('button', { name: 'Chi tiết', exact: true });
  if (await details.isVisible()) await details.click();
}

for (const width of [375, 1280, 1440]) {
  test(`inbox and filled order fit at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await inboxApi(page);
    await page.goto('/app/inbox');
    await openCustomer(page);
    await openPanel(page);
    await page.getByRole('tab', { name: 'Tạo đơn', exact: true }).click();
    await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
    await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
    await expect(
      page
        .getByRole('tabpanel', { name: 'Tạo đơn', exact: true })
        .getByText('Áo sơ mi linen dáng rộng', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const aside = page
      .locator('aside')
      .filter({ has: page.getByRole('tab', { name: 'Tạo đơn', exact: true }) });
    await page.screenshot({ path: `/tmp/t068-inbox-order-${width}.png`, fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
    ).toBeLessThanOrEqual(0);
    const overflowing = await aside.evaluate((element) =>
      [...element.querySelectorAll('*')]
        .filter(
          (child) =>
            child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1,
        )
        .map(
          (child) =>
            `${child.tagName}.${child.className}: ${Math.round(child.getBoundingClientRect().width)}`,
        )
        .slice(0, 12),
    );
    expect(
      await aside.evaluate((element) => element.scrollWidth - element.clientWidth),
      JSON.stringify(overflowing),
    ).toBeLessThanOrEqual(0);
    await test.info().attach(`inbox-order-${width}`, {
      path: `/tmp/t068-inbox-order-${width}.png`,
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
}

test('draft survives switching customers and internal notes save twice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  await openCustomer(page);
  const composer = page.getByRole('textbox', { name: 'Soạn tin nhắn…', exact: true });
  await composer.fill('Em đang kiểm tra tồn kho cho chị');
  await openCustomer(page, 1);
  await expect(composer).toHaveValue('');
  await openCustomer(page);
  await expect(composer).toHaveValue('Em đang kiểm tra tồn kho cho chị');
  await page.getByRole('button', { name: 'Thu gọn thông tin', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Khách hàng', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Khách hàng', exact: true })).toBeVisible();
  const note = page.locator('textarea[id^="note-"]');
  await note.fill('Khách cần size M');
  await page.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
  await expect(note).toHaveValue('Khách cần size M');
  await expect(page.getByRole('button', { name: 'Lưu ghi chú', exact: true })).toBeDisabled();
  await note.fill('Khách cần size M, giao thứ bảy');
  await page.getByRole('button', { name: 'Lưu ghi chú', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lưu ghi chú', exact: true })).toBeDisabled();
  await page.screenshot({ path: '/tmp/t068-inbox-customer.png', fullPage: true });
  await test
    .info()
    .attach('customer-context', { path: '/tmp/t068-inbox-customer.png', contentType: 'image/png' });
});

test('order draft fields survive switching conversations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  await openCustomer(page);
  await page.getByRole('tab', { name: 'Tạo đơn', exact: true }).click();
  await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
  await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
  await page.locator('#of-c-phone').fill('0912345678');
  await openCustomer(page, 1);
  await openCustomer(page);
  await page.getByRole('tab', { name: 'Tạo đơn', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Tạo đơn', exact: true })
      .getByText('Áo sơ mi linen dáng rộng', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('#of-c-phone')).toHaveValue('0912345678');
  await page.getByRole('button', { name: 'Mở rộng chi tiết đơn', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết đơn hàng', exact: true });
  await expect(dialog.locator('#of-c-phone')).toHaveValue('0912345678');
  await dialog.getByRole('textbox', { name: 'SL', exact: true }).fill('2');
  await page.screenshot({ path: '/tmp/t068-inbox-order-details.png', fullPage: true });
  await test.info().attach('expanded-order', {
    path: '/tmp/t068-inbox-order-details.png',
    contentType: 'image/png',
  });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'SL', exact: true })).toHaveValue('2');
});

test('creates an order without leaving chat and records completion after switching customers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  const order = await page.evaluate(
    async (orderId) => (await fetch(`/api/v1/orders/${orderId}`)).json(),
    ORDER_ID,
  );
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let requests = 0;
  await page.route('**/api/v1/orders', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests += 1;
    await gate;
    await route.fulfill({ json: { ...order, code: 'DH-INBOX-001' } });
  });
  await openCustomer(page);
  await page.getByRole('tab', { name: 'Tạo đơn', exact: true }).click();
  await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
  await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
  await page.locator('#of-c-phone').fill('0912345678');
  await page.locator('#of-r-address').fill('123 Đường Kiểm Thử');
  await page.getByRole('button', { name: 'Tạo đơn (F2)', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await openCustomer(page, 1);
  finish();
  await expect(page.getByText('Đã tạo đơn DH-INBOX-001').first()).toBeVisible();
  await openCustomer(page);
  await page.getByRole('tab', { name: 'Tạo đơn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo đơn khác', exact: true })).toBeVisible();
  expect(page.url()).toContain('/app/inbox');
  expect(requests).toBe(1);
});
