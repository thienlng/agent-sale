import { expect, type Page, test } from '@playwright/test';
import { BOT_ID, mockApi, ORDER_ID, PRODUCT_ID } from './support/mock-api';
import { CONTACT_ID } from './support/mock-crm';

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
    notes: [] as Array<Record<string, unknown>>,
  }));
  await page.route('**/api/v1/conversations**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const conversation = conversations.find((item) => path.endsWith(item.id));
    if (path.endsWith('/conversations'))
      return route.fulfill({
        json: {
          data: conversations,
          counts: { all: conversations.length, unread: 0, waiting: 0 },
        },
      });
    if (path.endsWith('/notes') && route.request().method() === 'POST') {
      const owner = conversations.find((item) => path.includes(item.id));
      const note = {
        id: id(90 + (owner?.notes.length ?? 0)),
        authorId: null,
        authorName: 'Bạn',
        text: route.request().postDataJSON().text,
        createdAt: fixedNow,
      };
      owner?.notes.push(note);
      return route.fulfill({ json: note });
    }
    if (path.endsWith('/contact') && route.request().method() === 'PUT') {
      // Staff link the conversation to a CRM customer (T-088).
      const owner = conversations.find((item) => path.includes(item.id));
      Object.assign(owner ?? {}, {
        contactId: route.request().postDataJSON().contactId,
        contactLinkedBy: 'staff',
      });
      return route.fulfill({ json: owner });
    }
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
            botId: BOT_ID,
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
  await expect(page.getByRole('heading', { name: new RegExp(names[index] ?? '') })).toBeVisible();
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
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await openPanel(page);
    await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
    await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
    await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
    await expect(
      page
        .getByRole('region', { name: 'Đơn hàng', exact: true })
        .getByText('Áo sơ mi linen dáng rộng', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const aside = page
      .locator('aside')
      .filter({ has: page.getByRole('region', { name: 'Đơn hàng', exact: true }) });
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

test('draft survives switching customers and notes are added to the timeline', async ({ page }) => {
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
  // The thread header toggle (the panel has its own collapse arrow too).
  await page
    .locator('header')
    .getByRole('button', { name: 'Thu gọn thông tin', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Giới thiệu', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Giới thiệu', exact: true })).toBeVisible();
  const notes = page.getByRole('region', { name: 'Ghi chú', exact: true });
  await notes.getByRole('textbox').fill('Khách cần size M');
  await notes.getByRole('textbox').press('Enter');
  await expect(notes.getByText('Khách cần size M', { exact: true })).toBeVisible();
  await expect(notes.getByRole('textbox')).toHaveValue('');
  await notes.getByRole('textbox').fill('Giao thứ bảy');
  await notes.getByRole('textbox').press('Enter');
  await expect(notes.getByRole('listitem').first()).toContainText('Giao thứ bảy');
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
  await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
  await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
  await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
  await page.locator('#of-c-phone').fill('0912345678');
  await openCustomer(page, 1);
  await openCustomer(page);
  await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Đơn hàng', exact: true })
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
  await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
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
  await page.getByRole('button', { name: 'Tạo đơn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tạo đơn khác', exact: true })).toBeVisible();
  expect(page.url()).toContain('/app/inbox');
  expect(requests).toBe(1);
});

test('follow-up survives reload and shows one line again once cleared', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  await openCustomer(page);
  await page.getByRole('button', { name: /Hẹn chăm sóc lại/ }).click();
  await page.getByRole('button', { name: 'Đặt lịch', exact: true }).click();
  await page.getByLabel('Thời gian chăm sóc', { exact: true }).fill('2026-10-24T09:00');
  await page.getByLabel('Việc cần làm', { exact: true }).fill('Gọi lại về size M');
  await page.getByRole('button', { name: 'Lưu lịch', exact: true }).click();
  await expect(page.getByText('Gọi lại về size M', { exact: true })).toBeVisible();
  await page.reload();
  await openCustomer(page);
  await expect(page.getByText('Gọi lại về size M', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/t070-follow-up.png', fullPage: true });
  await test
    .info()
    .attach('follow-up-due', { path: '/tmp/t070-follow-up.png', contentType: 'image/png' });
  await page.getByRole('button', { name: 'Xóa lịch', exact: true }).click();
  await expect(page.getByText('Chưa đặt lịch chăm sóc', { exact: true })).toBeVisible();
});

test('device saved views restore filters without retaining customer search text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  await page.getByRole('button', { name: 'Lọc', exact: true }).click();
  await page.getByRole('tab', { name: 'Ai đang trả lời', exact: true }).click();
  await page.getByRole('radio', { name: 'Người', exact: true }).click();
  // The advanced filter is a draft until applied.
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  await page.locator('input[type=search]').fill('Nguyễn');
  await page.getByRole('button', { name: 'Bộ lọc đã lưu', exact: true }).click();
  await page.getByLabel('Tên bộ lọc', { exact: true }).fill('Cần chăm sóc');
  await page.getByRole('button', { name: 'Lưu bộ lọc hiện tại', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cần chăm sóc', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/t070-saved-views.png', fullPage: true });
  await test
    .info()
    .attach('saved-views', { path: '/tmp/t070-saved-views.png', contentType: 'image/png' });
  await page.reload();
  await page.getByRole('button', { name: 'Bộ lọc đã lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Cần chăm sóc', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bỏ lọc Người trả lời', exact: true }),
  ).toBeVisible();
  await expect(page.locator('input[type=search]')).toHaveValue('');
  await page.getByRole('button', { name: 'Bộ lọc đã lưu', exact: true }).click();
  await page.getByRole('button', { name: 'Xóa Cần chăm sóc', exact: true }).click();
  await expect(page.getByText('Chưa có bộ lọc đã lưu.', { exact: true })).toBeVisible();
});

test('product sharing prepares a draft and keyboard shortcuts respect the editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  let sends = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/messages')) sends += 1;
  });
  await page.goto('/app/inbox');
  await openCustomer(page);
  await page.keyboard.press('r');
  const composer = page.getByRole('textbox', { name: 'Soạn tin nhắn…', exact: true });
  await expect(composer).toBeFocused();
  await composer.fill('Chị xem mẫu này: ');
  await page.getByRole('button', { name: 'Sản phẩm', exact: true }).click();
  await page.getByPlaceholder('Tìm sản phẩm theo tên hoặc mã').fill('linen');
  await page.getByRole('option', { name: /Áo sơ mi linen/ }).click();
  await expect(composer).toHaveValue(/Chị xem mẫu này: Áo sơ mi linen dáng rộng · Trắng \/ M/);
  await expect(composer).toHaveValue(/250.000/);
  expect(sends).toBe(0);
  await composer.focus();
  await page.keyboard.press('j');
  await expect(page.getByRole('heading', { name: new RegExp(names[0]) })).toBeVisible();
  await page.getByRole('heading', { name: new RegExp(names[0]) }).click();
  await page.keyboard.press('j');
  await expect(page.getByRole('heading', { name: new RegExp(names[1]) })).toBeVisible();
  await page.getByRole('heading', { name: new RegExp(names[1]) }).click();
  await page.keyboard.press('e');
  // Done: the header action turns into "reopen" and the composer offers it too.
  await expect(
    page.locator('header').getByRole('button', { name: 'Mở lại', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Mở lại để trả lời' }).getByRole('button'),
  ).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.locator('input[type=search]')).toBeFocused();
});

test('selected CRM profile can change status and open tag controls directly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  await page.goto('/app/inbox');
  const contact = await page.evaluate(
    async (contactId) => (await fetch(`/api/v1/contacts/${contactId}`)).json(),
    CONTACT_ID,
  );
  let expectedVersion: number | undefined;
  await page.route(`**/api/v1/contacts/${CONTACT_ID}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      expectedVersion = body.expectedVersion;
      Object.assign(contact, body, { version: contact.version + 1 });
    }
    await route.fulfill({ json: contact });
  });
  await openCustomer(page);
  // Choosing the customer links it to the conversation (T-088), hence the label.
  await page.getByLabel('Gắn khách hàng CRM', { exact: true }).fill('0912');
  await page
    .getByRole('button', { name: /Nguyễn Thị Thanh Hương Lan Anh Phương Thảo Ngọc Bích/ })
    .first()
    .click();
  await expect(page.getByText('Trạng thái khách hàng', { exact: true })).toBeVisible();
  const originalVersion = contact.version;
  await page.locator(`#inbox-contact-status-${CONTACT_ID}`).click();
  await page.getByRole('option', { name: 'Trial', exact: true }).click();
  await expect(page.locator(`#inbox-contact-status-${CONTACT_ID}`)).toContainText('Trial');
  expect(expectedVersion).toBe(originalVersion);
  await page.getByRole('button', { name: 'Gắn tag', exact: true }).click();
  await expect(page.getByPlaceholder('Tìm tag', { exact: true })).toBeVisible();
});

test('reply mode sends different requests for temporary and permanent takeover', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await inboxApi(page);
  const bodies: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/conversations/'))
      bodies.push(request.postDataJSON());
  });
  await page.goto('/app/inbox');
  await openCustomer(page);
  await page.getByRole('button', { name: /Chế độ trả lời/ }).click();
  await page.getByRole('menuitemradio', { name: /Tiếp quản tạm thời/ }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ mode: 'human', takeover: 'temporary' });
  await page.getByRole('button', { name: /Chế độ trả lời/ }).click();
  await page.getByRole('menuitemradio', { name: /Tiếp quản hẳn/ }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ mode: 'human', takeover: 'permanent' });
});
