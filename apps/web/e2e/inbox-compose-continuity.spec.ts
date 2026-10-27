import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './support/mock-api';

const channelId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e10';
const now = '2026-10-27T10:00:00.000Z';
const conversations = ['Draft customer A', 'Draft customer B'].map((customerName, index) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e0${index + 1}`,
  channelId,
  provider: 'facebook',
  customerId: `synthetic-${index}`,
  customerName,
  mode: 'human',
  autoResumeAt: null,
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 1,
  lastMessage: 'Synthetic message',
  lastInboundAt: now,
  updatedAt: now,
}));

async function setup(page: Page) {
  await mockApi(page);
  await page.clock.setFixedTime(new Date(now));
  let sends = 0;
  await page.route('**/api/v1/conversations**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/conversations'))
      return route.fulfill({
        json: { data: conversations, counts: { all: 2, unread: 0, waiting: 0 } },
      });
    const conversation = conversations.find((item) => path.includes(item.id));
    if (!conversation) return route.fallback();
    if (path.endsWith('/messages') && route.request().method() === 'POST') {
      sends++;
      return route.fulfill({
        json: {
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          direction: 'outbound',
          sender: 'human',
          text: route.request().postDataJSON().text,
          attachments: [],
          status: 'sent',
          failureCode: null,
          externalId: 'synthetic-outbound',
          createdAt: now,
        },
      });
    }
    if (path.endsWith('/read')) return route.fulfill({ json: { ...conversation, isRead: true } });
    return route.fulfill({ json: { conversation, messages: [] } });
  });
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: null }));
  return () => sends;
}

test('restores DM text after reload and keeps Enter settings personal without automatic sends', async ({
  page,
}) => {
  const sends = await setup(page);
  await page.goto('/app/inbox');
  await page.getByText('Draft customer A', { exact: true }).first().click();
  const editor = page.locator('[data-inbox-composer] textarea');
  await editor.fill('Keep this draft after refresh');
  await page.reload();
  await page.getByText('Draft customer B', { exact: true }).first().click();
  await expect(editor).toHaveValue('');
  await page.getByText('Draft customer A', { exact: true }).first().click();
  await expect(editor).toHaveValue('Keep this draft after refresh');
  expect(sends()).toBe(0);

  await page.getByRole('button', { name: 'Tùy chọn soạn tin' }).click();
  await page.getByRole('switch', { name: 'Enter để gửi' }).click();
  await page.keyboard.press('Escape');
  await editor.fill('First line');
  await editor.press('Enter');
  await editor.pressSequentially('Second line');
  await expect(editor).toHaveValue('First line\nSecond line');
  expect(sends()).toBe(0);
  await page.reload();
  await page.getByText('Draft customer A', { exact: true }).first().click();
  await expect(editor).toHaveValue('First line\nSecond line');
  await page.getByRole('button', { name: 'Tùy chọn soạn tin' }).click();
  await expect(page.getByRole('switch', { name: 'Enter để gửi' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  await expect(editor).toHaveValue('');
  expect(sends()).toBe(1);

  await editor.fill('Erase at logout');
  await page.getByRole('button', { name: /Nguyễn Thị Thanh Hương Lan/ }).click();
  await page.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login/);
  const privateKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('rapiz.private.')),
  );
  expect(privateKeys).toEqual([]);
});

test('coordinates two tabs without duplicate sends, lost text, or a stale authenticated composer', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  const sends = await setup(page);
  await setup(other);
  await page.goto('/app/inbox');
  await page.getByText('Draft customer A', { exact: true }).first().click();
  const editor = page.locator('[data-inbox-composer] textarea');
  const otherEditor = other.locator('[data-inbox-composer] textarea');
  await other.goto('/app/inbox');
  await other.getByText('Draft customer A', { exact: true }).first().click();
  await expect(otherEditor).toHaveValue('');
  await editor.fill('Shared draft');
  await expect(otherEditor).toHaveValue('Shared draft');
  await page.getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
  await expect(editor).toHaveValue('');
  await expect(otherEditor).toHaveValue('');
  expect(sends()).toBe(1);

  await editor.fill('Edited in first tab');
  await expect(otherEditor).toHaveValue('Edited in first tab');
  await otherEditor.fill('Edited in second tab');
  await expect(page.getByText('Bản nháp đã thay đổi ở tab khác.', { exact: false })).toBeVisible();
  await expect(editor).toHaveValue('Edited in first tab');
  await expect(page.getByRole('button', { name: 'Gửi tin nhắn', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Dùng bản nháp mới' }).click();
  await expect(editor).toHaveValue('Edited in second tab');

  await other.getByRole('button', { name: /Nguyễn Thị Thanh Hương Lan/ }).click();
  await other.getByRole('menuitem', { name: 'Đăng xuất' }).click();
  await expect(other).toHaveURL(/\/login/);
  await expect(page).toHaveURL(/\/login/);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('rapiz.private.')),
    ),
  ).toEqual([]);
});

test('keeps compose options and conflict-safe controls usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/app/inbox');
  await page.getByText('Draft customer A', { exact: true }).first().click();
  await page.locator('[data-inbox-composer] textarea').fill('Mobile draft');
  await page.getByRole('button', { name: 'Tùy chọn soạn tin' }).click();
  await expect(page.getByRole('switch', { name: 'Enter để gửi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/t107-compose-mobile.png' });
});
