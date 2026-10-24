import { expect, test } from '@playwright/test';

import { mockApi } from './support/mock-api';

const CONVERSATION_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e01';
const CHANNEL_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e02';
const NOW = Date.parse('2026-10-24T08:00:00.000Z');

const conversation = {
  id: CONVERSATION_ID,
  channelId: CHANNEL_ID,
  provider: 'facebook',
  customerId: 'psid-1',
  customerName: 'Khách thử',
  mode: 'human',
  autoResumeAt: null,
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 1,
  lastMessage: 'Tin nhắn cuối',
  lastInboundAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
};

/** A long thread: it must scroll inside its own box, never stretch the page. */
const messages = Array.from({ length: 80 }, (_, i) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-${String(i).padStart(12, '0')}`,
  conversationId: CONVERSATION_ID,
  direction: i % 2 ? 'outbound' : 'inbound',
  sender: i % 2 ? 'bot' : 'customer',
  text: `Tin nhắn số ${i} — nội dung đủ dài để chiếm nhiều dòng trong khung chat của khách hàng.`,
  attachments: [],
  status: 'sent',
  failureCode: null,
  externalId: `m${i}`,
  createdAt: new Date(NOW - (80 - i) * 60_000).toISOString(),
}));

for (const width of [1280, 900, 480]) {
  test(`a long inbox thread scrolls inside its box at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mockApi(page);
    await page.route('**/api/v1/conversations**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith(CONVERSATION_ID)
        ? { conversation: conversation, messages }
        : { data: [conversation] };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('/app/inbox');
    await page.getByText('Khách thử').first().click();
    await expect(page.getByText('Tin nhắn số 79', { exact: false })).toBeVisible();

    const { viewport, page: pageHeight } = await page.evaluate(() => ({
      viewport: window.innerHeight,
      page: document.documentElement.scrollHeight,
    }));
    expect(pageHeight).toBeLessThanOrEqual(viewport);
  });
}
