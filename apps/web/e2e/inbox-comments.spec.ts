import { expect, test, type Page } from '@playwright/test';

import { mockApi } from './support/mock-api';

/**
 * T-106: Facebook comments inside Inbox, against the production build with the API mocked.
 * Synthetic customers only; no request leaves the browser.
 */
const PAGE_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9f01';
const BASE = `/channels/${PAGE_ID}/fanpage`;
const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

interface Recorded {
  id: string;
  kind: string;
  status: string;
  text: string;
  reason: string;
  externalId: string | null;
  actorId: string | null;
  recipientId: string | null;
  failureCode: string | null;
  createdAt: string;
}
const comments = Array.from({ length: 42 }, (_, i) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-${String(i).padStart(12, '0')}`,
  connectionId: PAGE_ID,
  postId: i % 4 ? '123_10' : '123_77',
  commentId: `10_${100 + i}`,
  parentId: i === 1 ? '10_999' : null,
  authorId: `5550000${String(i).padStart(3, '0')}`,
  text:
    i === 41
      ? 'Bình luận cũ nhất về size XL'
      : `Áo sơ mi công sở cao cấp màu xanh còn size M không shop ơi, giao Hà Nội mất mấy ngày ${i}`,
  occurredAt: iso(i * 5),
  version: `v${i}`,
  deleted: false,
  needsReview: i === 2,
  context: null,
  actions: [] as Recorded[],
}));

async function mockComments(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await mockApi(page);
  await page.route('**/api/v1/conversations**', (route) =>
    route.fulfill({ json: { data: [], counts: { all: 0, unread: 0, waiting: 0 } } }),
  );
  await page.route('**/api/v1/channels**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    if (path === '/channels')
      return route.fulfill({
        json: {
          data: [
            {
              id: PAGE_ID,
              provider: 'facebook',
              externalId: '123',
              name: 'Thời trang công sở Lan Hương',
              status: 'connected',
              botId: null,
              expiresAt: null,
              createdAt: iso(10_000),
            },
          ],
          providers: [],
        },
      });
    if (path === `${BASE}/comment-posts`)
      return route.fulfill({
        json: {
          data: [
            { postId: '123_10', comments: 31, lastActivityAt: iso(0), text: null, permalink: null },
            { postId: '123_77', comments: 11, lastActivityAt: iso(1), text: null, permalink: null },
          ],
        },
      });
    if (path === `${BASE}/posts`)
      return route.fulfill({
        json: {
          data: [
            {
              id: '123_10',
              text: 'Áo sơ mi xanh 250k — freeship nội thành',
              permalink: 'https://www.facebook.com/123/posts/10',
              media: [],
              fetchedAt: iso(0),
            },
          ],
        },
      });
    if (path === `${BASE}/comments`) {
      const q = url.searchParams.get('q');
      const postId = url.searchParams.get('postId');
      const rows = comments.filter(
        (c) =>
          (!q || c.text.toLowerCase().includes(q.toLowerCase())) &&
          (!postId || c.postId === postId),
      );
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return route.fulfill({
        json: {
          data: rows.slice(start, start + limit),
          nextCursor: start + limit < rows.length ? String(start + limit) : null,
        },
      });
    }
    const detail = path.match(/\/comments\/(\d+_\d+)$/);
    if (detail && method === 'GET')
      return route.fulfill({
        json: { data: comments.find((c) => c.commentId === detail[1]), parent: null },
      });
    if (path.endsWith('/source')) {
      const id = path.split('/').at(-2);
      const c = comments.find((x) => x.commentId === id)!;
      return route.fulfill({
        json:
          c.postId === '123_77'
            ? { status: 'unavailable', reason: 'missing' }
            : {
                status: 'fresh',
                post: {
                  id: '123_10',
                  text: 'Áo sơ mi xanh 250k — freeship nội thành',
                  permalink: 'https://www.facebook.com/123/posts/10',
                  media: [],
                  fetchedAt: iso(0),
                },
                parentText: c.parentId ? 'Shop ơi còn hàng không?' : '',
                commentText: c.text,
                matchesStored: true,
              },
      });
    }
    if (path.endsWith('/actions') && method === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      sent.push(body);
      const id = path.split('/').at(-2);
      const action: Recorded = {
        id: String(body.requestId),
        kind: String(body.kind),
        status: 'sent',
        text: String(body.text ?? ''),
        reason: 'Manual staff action',
        externalId: '1_2',
        actorId: 'staff',
        recipientId: null,
        failureCode: null,
        createdAt: new Date().toISOString(),
      };
      comments.find((c) => c.commentId === id)!.actions.push(action);
      return route.fulfill({ status: 201, json: { action } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: path } } });
  });
  return sent;
}

async function openComments(page: Page) {
  await page.goto('/app/inbox');
  await page.getByRole('tab', { name: 'Bình luận trên Facebook' }).click();
  return page.getByRole('list', { name: 'Bình luận Facebook' });
}
const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('desktop: browse stored comments, read the source and reply publicly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await mockComments(page);
  const list = await openComments(page);
  await expect(list.getByRole('button')).toHaveCount(30);
  await page.getByRole('button', { name: 'Tải thêm bình luận cũ hơn' }).click();
  await expect(list.getByRole('button')).toHaveCount(42);
  const detail = page.getByRole('article', { name: 'Bình luận đang chọn' });
  // A post outside Facebook's latest posts: still listed, honest about the missing source.
  await list.getByRole('button', { name: /ngày 4$/ }).click();
  await expect(detail.getByText(/có thể đã bị xóa/)).toBeVisible();
  await expect(page.getByRole('option', { name: 'Bài viết #77' })).toBeAttached();
  await list.getByRole('button', { name: /ngày 1$/ }).click();
  await expect(detail.getByText('Shop ơi còn hàng không?')).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Bài viết gốc' })).toContainText('freeship');
  await detail.getByRole('textbox').fill('Dạ còn size M ạ, shop inbox mình nhé');
  await detail.getByRole('button', { name: 'Gửi công khai' }).click();
  await expect(detail.getByText('Đã đăng trả lời công khai.')).toBeVisible();
  await expect(detail.getByRole('textbox')).toHaveValue('');
  expect(sent).toEqual([
    expect.objectContaining({
      kind: 'public_reply',
      version: 'v1',
      text: 'Dạ còn size M ạ, shop inbox mình nhé',
    }),
  ]);
  await expect(detail.getByRole('region', { name: 'Thao tác Rapiz đã ghi nhận' })).toContainText(
    'đã gửi',
  );
  // Search runs on the server and reaches the oldest record.
  await page.getByRole('searchbox').fill('size xl');
  await expect(list.getByRole('button')).toHaveCount(1);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('390px: list → comment → back keeps the filter and the draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockComments(page);
  const list = await openComments(page);
  await page.getByRole('searchbox').fill('size m');
  await list.getByRole('button').first().click();
  const detail = page.getByRole('article', { name: 'Bình luận đang chọn' });
  await expect(list).toBeHidden();
  await detail.getByRole('button', { name: 'Nhắn riêng' }).click();
  await detail.getByRole('textbox').fill('Nháp tin riêng');
  expect(await noHorizontalOverflow(page)).toBe(true);
  await detail.getByRole('button', { name: 'Danh sách' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('size m');
  await list.getByRole('button').first().click();
  await detail.getByRole('button', { name: 'Nhắn riêng' }).click();
  await expect(detail.getByRole('textbox')).toHaveValue('Nháp tin riêng');
});

test('keyboard and dark mode: rows, mode switch and send are reachable and labelled', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('rapiz.pref.theme_mode', 'dark'));
  await page.setViewportSize({ width: 1280, height: 800 });
  const sent = await mockComments(page);
  const list = await openComments(page);
  await list.getByRole('button').first().focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('article', { name: 'Bình luận đang chọn' });
  const privateMode = detail.getByRole('button', { name: 'Nhắn riêng' });
  await privateMode.focus();
  await page.keyboard.press('Space');
  await expect(privateMode).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByText(/Gửi riêng vào Messenger/)).toBeVisible();
  // Changing mode sent nothing; Enter in the composer is a new line.
  await detail.getByRole('textbox').focus();
  await page.keyboard.type('Dòng 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dòng 2');
  await expect(detail.getByRole('textbox')).toHaveValue('Dòng 1\nDòng 2');
  expect(sent).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  // The selected mode is announced by aria-pressed and a filled style, not by color alone.
  await expect(detail.getByRole('button', { name: 'Trả lời công khai' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});
