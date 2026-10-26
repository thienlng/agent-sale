import { expect, test } from '@playwright/test';
import { mockApi, BOT_ID } from './support/mock-api';
const ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d71';
const COMMENT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d72';
const at = '2026-10-25T10:00:00.000Z';
for (const width of [375, 768, 1280, 1920]) {
  test(`post context and moderation work at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await mockApi(page);
    const settings = {
      publicReplies: false,
      privateReplies: false,
      hideComments: false,
      hideKeywords: [] as string[],
      excludedPostIds: [] as string[],
    };
    const post = {
      id: '123_10',
      text: 'Áo sơ mi xanh chất liệu cotton cao cấp, giá 250.000đ. Ưu đãi áp dụng cho mẫu trong bài viết này.',
      permalink: 'https://www.facebook.com/123_10',
      media: [],
      fetchedAt: at,
    };
    const comment = {
      id: COMMENT_ID,
      connectionId: ID,
      postId: post.id,
      commentId: '10_20',
      parentId: null,
      authorId: '999',
      text: 'Mẫu này bao nhiêu tiền? Có còn hàng không?',
      occurredAt: at,
      version: 'v1',
      deleted: false,
      needsReview: true,
      context: { ...post, pageId: '123', commentId: '10_20', parentText: '' },
      actions: [] as unknown[],
    };
    await page.route('**/api/v1/channels**', async (route) => {
      const url = new URL(route.request().url()),
        method = route.request().method();
      let body: unknown;
      if (url.pathname.endsWith('/channels'))
        body = {
          data: [
            {
              id: ID,
              provider: 'facebook',
              externalId: '123',
              name: 'Cửa hàng thử nghiệm ' + 'thời trang '.repeat(6),
              status: 'connected',
              botId: BOT_ID,
              expiresAt: null,
              createdAt: at,
            },
          ],
          providers: [{ provider: 'facebook', configured: true }],
        };
      else if (url.pathname.endsWith('/settings')) {
        if (method === 'PATCH') Object.assign(settings, route.request().postDataJSON());
        body = settings;
      } else if (url.pathname.endsWith('/posts')) body = { data: [post] };
      else if (url.pathname.endsWith('/comments')) body = { data: [comment] };
      else if (url.pathname.endsWith('/actions')) {
        const input = route.request().postDataJSON();
        const action = {
          id: input.requestId,
          kind: input.kind,
          status: 'sent',
          text: input.text,
          reason: 'Manual staff action',
          externalId: '10_20',
          recipientId: null,
          actorId: null,
          failureCode: null,
          createdAt: at,
        };
        comment.actions.push(action);
        body = { action };
      } else return route.fallback();
      return route.fulfill({
        status: method === 'POST' ? 201 : 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('/app/channels');
    await expect(
      page.getByRole('heading', { name: 'Bài viết và bình luận Facebook' }),
    ).toBeVisible();
    await expect(page.getByText(comment.text)).toBeVisible();
    await expect(page.getByRole('blockquote')).toHaveText(post.text);
    await page.getByRole('switch', { name: 'Tự động nhắn tin riêng cho người bình luận' }).click();
    await page.getByRole('switch', { name: 'Bật tự động cho bài viết 123_10' }).click();
    await page.getByRole('button', { name: 'Lưu thiết lập và lựa chọn bài viết' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã lưu' })).toBeVisible();
    expect(settings.privateReplies).toBe(true);
    expect(settings.excludedPostIds).toEqual(['123_10']);
    await page.getByRole('button', { name: 'Hiện lại', exact: true }).click();
    await expect(page.getByText('Hiện lại · Đã gửi')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (width === 1280)
      await page.screenshot({ path: testInfo.outputPath('fanpage-context.png'), fullPage: true });
  });
}
