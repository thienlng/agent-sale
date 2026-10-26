import { expect, test } from '@playwright/test';
import { BOT_ID, mockApi } from './support/mock-api';

const id = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a${String(n).padStart(2, '0')}`;
const now = '2026-10-26T08:00:00.000Z';
const settings = {
  mission: '',
  greeting: '',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  useCustomerName: true,
  fallbackMessage: '',
  handoffMessage: '',
  creativity: 'balanced',
  modelTier: 'basic',
  language: 'vi',
  placeholders: {},
};
const bot = {
  id: BOT_ID,
  name: 'Shop test',
  industry: 'retail',
  isActive: true,
  settings,
  createdAt: now,
  updatedAt: now,
};

test('bot switch persists and training destinations explain their different purposes', async ({
  page,
}) => {
  await mockApi(page);
  const state = { ...bot };
  await page.route('**/api/v1/bots', (route) => route.fulfill({ json: { data: [state] } }));
  await page.route(`**/api/v1/bots/${BOT_ID}`, (route) => {
    if (route.request().method() === 'PATCH') Object.assign(state, route.request().postDataJSON());
    return route.fulfill({ json: state });
  });
  await page.goto('/app/bots');
  const toggle = page.getByRole('switch', { name: 'Bật hoặc tắt bot Shop test' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await page.screenshot({ path: '/tmp/lane-b-bot-list.png' });
  await page.goto(`/app/bots/${BOT_ID}/knowledge`);
  await expect(page.getByRole('heading', { name: 'Bot cần biết thông tin gì?' })).toBeVisible();
  await page.screenshot({ path: '/tmp/lane-b-training-facts.png' });
  await page.getByRole('link', { name: 'Thiết lập cách bot trả lời' }).click();
  await expect(page.getByRole('heading', { name: 'Bot cần trả lời như thế nào?' })).toBeVisible();
  await page.getByRole('link', { name: 'Fanpage và kênh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quản lý fanpage và kênh' })).toBeVisible();
  await page.getByRole('link', { name: 'Xem tất cả trang và bot' }).click();
  await expect(page).toHaveURL(/\/app\/channels$/);
  await expect(
    page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Tích hợp nền tảng', exact: true }),
  ).toHaveCount(1);
});

test('attribute tag values persist across reload and removal keeps the accurate state', async ({
  page,
}) => {
  await mockApi(page);
  const conversation = {
    id: id(1),
    channelId: id(2),
    provider: 'facebook',
    customerId: 'synthetic-customer',
    customerName: 'Khách kiểm thử tag',
    mode: 'human',
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: '',
    revision: 1,
    lastMessage: 'Xin chào',
    lastInboundAt: now,
    updatedAt: now,
  };
  const tag = {
    id: id(3),
    name: 'Event',
    color: '#16a34a',
    type: 'attribute',
    description: '',
    fields: [
      {
        key: 'event_name',
        label: 'Tên sự kiện',
        type: 'text',
        required: true,
        options: [],
        archived: false,
      },
    ],
    schemaVersion: 1,
    isSystem: false,
    archived: false,
    createdByName: null,
    activeCount: 0,
    version: 1,
    updatedAt: now,
  };
  const assignment = {
    id: id(4),
    tagId: tag.id,
    scope: 'conversation',
    entityId: conversation.id,
    values: { event_name: '' },
    schemaVersion: 1,
    assignedAt: now,
    assignedByName: null,
    removedAt: null,
    version: 1,
    tag: { id: tag.id, name: tag.name, color: tag.color },
  };
  let applied = false;
  await page.route('**/api/v1/crm/tags', (route) => route.fulfill({ json: { data: [tag] } }));
  await page.route('**/api/v1/conversations**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tags')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (!body.values?.event_name)
          return route.fulfill({
            status: 422,
            json: { error: { code: 'VALIDATION_FAILED', message: 'Required values' } },
          });
        expect(body).toEqual({ tagId: tag.id, values: { event_name: 'Khai trương' } });
        assignment.values = body.values;
        applied = true;
        return route.fulfill({ status: 201, json: assignment });
      }
      return route.fulfill({ json: { data: applied ? [assignment] : [] } });
    }
    if (path.endsWith('/read')) return route.fulfill({ json: { ...conversation, unreadCount: 0 } });
    if (path.endsWith(conversation.id))
      return route.fulfill({ json: { conversation, messages: [] } });
    return route.fulfill({
      json: { data: [conversation], counts: { all: 1, unread: 0, waiting: 0 } },
    });
  });
  await page.route('**/api/v1/tag-assignments/*/remove', (route) => {
    applied = false;
    return route.fulfill({ json: { ...assignment, removedAt: now } });
  });
  await page.goto('/app/inbox');
  await page.getByText('Khách kiểm thử tag', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Gắn tag Event', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Tên sự kiện *', { exact: true }).fill('Khai trương');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Gỡ tag Event', exact: true })).toBeVisible();
  await page.reload();
  await page.getByText('Khách kiểm thử tag', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Gỡ tag Event', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/lane-b-inbox-tag.png' });
  await page.getByRole('button', { name: 'Gỡ tag Event', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gắn tag Event', exact: true })).toBeVisible();
});

test('root not-found recovery remains keyboard accessible', async ({ page }) => {
  await mockApi(page);
  await page.goto('/a-route-that-does-not-exist');
  const home = page.getByRole('link', { name: 'Về trang chính' });
  await expect(home).toBeVisible();
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/bots$/);
});
