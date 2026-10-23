import type { Page } from '@playwright/test';

/** Deliberately long Vietnamese content: layout must wrap or truncate, never overflow. */
export const LONG =
  'Cửa hàng thời trang công sở cao cấp chuyên áo sơ mi, quần âu và phụ kiện cho dân văn phòng tại Thành phố Hồ Chí Minh';

const user = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d10',
  email: 'chu.cua.hang.thoi.trang.cong.so@mot-ten-mien-rat-dai.vn',
  name: 'Nguyễn Thị Thanh Hương Lan',
  phone: null,
  emailVerified: true,
  locale: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  isPlatformAdmin: true,
};
export const BOT_ID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d30';
const now = '2026-10-24T08:00:00.000Z';
const settings = {
  mission: LONG,
  greeting: 'Dạ Shop xin chào ạ!',
  selfPronoun: 'em',
  customerPronoun: 'anh/chị',
  useCustomerName: true,
  fallbackMessage: 'Dạ em kiểm tra lại ạ.',
  handoffMessage: 'Dạ em chuyển nhân viên ạ.',
  creativity: 'balanced',
  modelTier: 'smart',
  language: 'vi',
  placeholders: { 'store.name': LONG, 'store.address': '' },
};
const bot = {
  id: BOT_ID,
  name: LONG,
  industry: 'fashion',
  isActive: true,
  settings,
  createdAt: now,
  updatedAt: now,
};
const faq = (i: number) => ({
  id: `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d4${i}`,
  botId: BOT_ID,
  question: `${LONG} — câu hỏi số ${i}?`,
  answer: `Dạ ${LONG}. Địa chỉ: {{store.address}}. Liên hệ https://mot-duong-dan-rat-dai.example.com/khong-co-dau-cach-nao-ca/${'x'.repeat(40)}`,
  source: i % 2 ? 'seed' : 'manual',
  missingPlaceholders: ['store.address'],
  updatedAt: now,
});
const provider = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d50',
  name: 'vllm-cum-may-chu-noi-bo-so-1',
  kind: 'openai_compatible',
  baseUrl: 'http://10.0.0.5:8000/v1/a-very-long-path-segment-for-testing',
  hasApiKey: true,
  apiKeyHint: '9876',
  options: { structuredOutput: 'json_schema', sendReasoningEffort: false, timeoutMs: 20000 },
  isEnabled: true,
  updatedAt: now,
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** A logged-in platform admin with one bot full of long content. */
export async function mockApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem('razpi.session', '1'));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/refresh')
      return route.fulfill(json({ accessToken: 't', expiresIn: 900, user }));
    if (path === '/bootstrap')
      return route.fulfill(
        json({
          user,
          memberships: [
            {
              workspaceId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d20',
              workspaceName: LONG,
              role: 'owner',
            },
          ],
        }),
      );
    if (path === '/bots')
      return route.fulfill(
        json({ data: [bot, { ...bot, id: `${BOT_ID.slice(0, -1)}1`, isActive: false }] }),
      );
    if (path === `/bots/${BOT_ID}`) return route.fulfill(json(bot));
    if (path === `/bots/${BOT_ID}/readiness`)
      return route.fulfill(
        json({
          ready: false,
          missingPlaceholders: ['store.address'],
          checks: [
            { key: 'mission', done: true },
            { key: 'faq', done: true },
            { key: 'placeholders', done: false },
            { key: 'channel', done: false },
          ],
        }),
      );
    if (path === `/bots/${BOT_ID}/faqs`)
      return route.fulfill(json({ data: [1, 2, 3, 4].map(faq) }));
    if (path === '/admin/llm/providers') return route.fulfill(json({ data: [provider] }));
    if (path === '/admin/llm/tiers')
      return route.fulfill(
        json({
          data: [
            {
              tier: 'smart',
              primary: {
                providerId: provider.id,
                model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-FP8',
                effort: 'low',
              },
              fallback: null,
              updatedAt: now,
            },
          ],
        }),
      );
    return route.fulfill(json({ error: { code: 'NOT_FOUND', message: 'not mocked' } }, 404));
  });
}
