import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { mockApi } from './support/mock-api';

/**
 * Website chat journey (T-104) with every API mocked, like the other smoke specs: the real built
 * widget runs on a static host page, the dashboard runs on the vite preview, and one in-memory
 * "server" backs both. The backend side is covered by apps/backend/test/webchat.integration.spec.ts.
 */
const WIDGET = fileURLToPath(new URL('../../widget/dist/widget.js', import.meta.url));
const WIDGET_SRC = fileURLToPath(new URL('../../widget/src', import.meta.url));
/**
 * The widget polls every 3 s while it awaits a reply (4 s open), so a staff or bot answer needs up
 * to one cadence plus request time to appear; 10 s leaves a safe margin.
 */
const WIDGET_POLL_WAIT_MS = 10_000;
const SITE_KEY = 'wk_E2eKey123';
const HOST = 'http://host.test';
const API = `${HOST}/api/v1/webchat/v1/sites/${SITE_KEY}`;
const uuid = (n: number) => `0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c${String(n).padStart(4, '0')}`;
const CONVERSATION_ID = uuid(1);
const CHANNEL_ID = uuid(2);
const CONTACT_ID = uuid(3);
const PHONE = '0912345678';

interface Msg {
  id: string;
  role: 'customer' | 'agent';
  sender: 'customer' | 'bot' | 'human';
  text: string;
  clientMessageId: string | null;
  at: string;
}

/** Newest mtime of any file under a directory. */
const newest = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((max, entry) => {
    const path = `${dir}/${entry.name}`;
    return Math.max(max, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }, 0);

test.beforeAll(() => {
  // Rebuild when the bundle is missing or older than any widget source file.
  if (!existsSync(WIDGET) || statSync(WIDGET).mtimeMs < newest(WIDGET_SRC))
    execFileSync('pnpm', ['--filter', '@agent-sales/widget', 'build'], { stdio: 'inherit' });
});

test('visitor chats, staff answers from the inbox, visitor leaves a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // The in-memory server.
  const messages: Msg[] = [];
  let counter = 10;
  let phone: string | null = null;
  let capturedAt: string | null = null;
  let seenAt: string | null = null;
  let lastPage = { url: '', title: '' };
  const push = (role: Msg['role'], sender: Msg['sender'], text: string, cmid: string | null) => {
    const m: Msg = {
      id: uuid(counter++),
      role,
      sender,
      text,
      clientMessageId: cmid,
      at: new Date().toISOString(),
    };
    messages.push(m);
    return m;
  };
  const wire = (m: Msg) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    imageUrl: null,
    clientMessageId: m.clientMessageId,
    at: m.at,
  });

  // ─── Visitor side: a static host page with the built widget ────────────────────────────────
  const host = await context.newPage();
  await host.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify(body),
      });
    if (route.request().method() === 'OPTIONS') return json({});
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta charset="utf-8" /><title>Áo sơ mi linen</title></head><body><h1>Shop</h1>
          <script src="/widget.js?key=${SITE_KEY}" async></script></body></html>`,
      });
    if (url.pathname === '/widget.js')
      return route.fulfill({
        contentType: 'application/javascript',
        body: readFileSync(WIDGET, 'utf8'),
      });
    if (url.pathname === `/api/v1/webchat/v1/sites/${SITE_KEY}`)
      return json({
        color: '#F97316',
        position: 'right',
        agentName: 'Tư vấn viên',
        avatarUrl: null,
        greeting: 'Chào anh/chị, em có thể hỗ trợ gì ạ?',
        phonePrompt: 'Để lại số điện thoại nhé.',
        phoneChipText: 'Gửi số điện thoại để được gọi lại',
        language: 'vi',
      });
    if (url.pathname === `${new URL(API).pathname}/messages`) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          clientMessageId: string;
          text: string;
          page: { url: string; title: string };
        };
        lastPage = body.page;
        const m = push('customer', 'customer', body.text, body.clientMessageId);
        // The stubbed AI answers right away.
        push('agent', 'bot', 'Dạ, áo còn size M ạ. Anh/chị cần em tư vấn thêm không?', null);
        return json({ visitorToken: 'visitor-token', message: wire(m) });
      }
      return json({
        messages: messages.map(wire),
        botTyping: false,
        phoneCaptured: phone !== null,
        phoneRequired: false,
      });
    }
    if (url.pathname === `${new URL(API).pathname}/phone`) {
      const body = route.request().postDataJSON() as { phone: string };
      phone = body.phone;
      capturedAt = new Date().toISOString();
      return json({ phoneCaptured: true });
    }
    return json({ error: 'not_found' }, 404);
  });

  await host.goto(`${HOST}/`);
  await host.getByRole('button', { name: 'Mở chat' }).click();
  await expect(host.getByText('Chào anh/chị, em có thể hỗ trợ gì ạ?')).toBeVisible();
  const input = host.getByRole('textbox', { name: 'Nhập tin nhắn...' });
  await input.fill('Áo này còn size M không shop?');
  await input.press('Enter');
  // The visitor's message and the bot answer (picked up by polling) are both shown.
  await expect(host.getByText('Áo này còn size M không shop?')).toBeVisible();
  await expect(host.getByText('Dạ, áo còn size M ạ.')).toBeVisible({
    timeout: WIDGET_POLL_WAIT_MS,
  });

  // ─── Staff side: the dashboard inbox ─────────────────────────────────────────────────────────
  const dash = await context.newPage();
  await mockApi(dash);
  const conversation = () => ({
    id: CONVERSATION_ID,
    channelId: CHANNEL_ID,
    provider: 'website',
    customerId: 'visitor-1',
    customerName: 'Khách website #1',
    mode: 'human',
    autoResumeAt: null,
    status: 'open',
    assigneeId: null,
    note: '',
    revision: 1,
    unreadCount: seenAt ? 0 : messages.filter((m) => m.role === 'customer').length,
    lastMessage: messages.at(-1)?.text ?? '',
    lastInboundAt: messages.find((m) => m.role === 'customer')?.at ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lead: phone && capturedAt ? { contactId: CONTACT_ID, phone, capturedAt, seenAt } : null,
  });
  const inboxMessage = (m: Msg) => ({
    id: m.id,
    conversationId: CONVERSATION_ID,
    direction: m.role === 'customer' ? 'inbound' : 'outbound',
    sender: m.sender,
    senderName: m.sender === 'human' ? 'Bạn' : null,
    text: m.text,
    attachments: [],
    status: m.role === 'customer' ? 'received' : 'sent',
    failureCode: null,
    externalId: null,
    createdAt: m.at,
  });
  await dash.route('**/api/v1/channels', (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: CHANNEL_ID,
            provider: 'website',
            externalId: SITE_KEY,
            name: 'Shop Hoa',
            status: 'connected',
            botId: null,
            expiresAt: null,
            createdAt: new Date().toISOString(),
            settings: {},
          },
        ],
        providers: [],
      },
    }),
  );
  await dash.route('**/api/v1/webchat/conversations/*/visitor', (route) =>
    route.fulfill({
      json: {
        firstUrl: 'https://shop.vn/ao-so-mi',
        referrer: 'https://www.google.com/',
        lastUrl: lastPage.url || 'https://shop.vn/ao-so-mi',
        lastTitle: lastPage.title || 'Áo sơ mi linen',
        phone,
        contactId: phone ? CONTACT_ID : null,
        createdAt: new Date().toISOString(),
      },
    }),
  );
  await dash.route('**/api/v1/conversations**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/conversations'))
      return route.fulfill({
        json: {
          data: [conversation()],
          counts: { all: 1, unread: seenAt ? 0 : 1, waiting: 0 },
        },
      });
    if (path.endsWith('/read') && method === 'POST') {
      seenAt = new Date().toISOString();
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/messages') && method === 'POST') {
      const body = route.request().postDataJSON() as { text: string };
      return route.fulfill({ json: inboxMessage(push('agent', 'human', body.text, null)) });
    }
    if (path.endsWith(CONVERSATION_ID))
      return route.fulfill({
        json: { conversation: conversation(), messages: messages.map(inboxMessage) },
      });
    return route.fallback();
  });

  await dash.goto('/app/inbox');
  const row = dash.getByRole('button', { name: /Khách website #1/ });
  await expect(row).toBeVisible();
  // The visitor has not left a number yet: no lead badge.
  await expect(row.getByText('Số mới')).toHaveCount(0);
  await row.click();
  await expect(dash.getByText('Áo này còn size M không shop?').first()).toBeVisible();
  // Visitor panel: where they came from and what they look at.
  await expect(dash.getByText('shop.vn/ao-so-mi').first()).toBeVisible();
  await expect(dash.getByText('Áo sơ mi linen').first()).toBeVisible();

  // Staff answers; the visitor's next poll shows it.
  const composer = dash.getByRole('textbox', { name: 'Soạn tin nhắn…', exact: true });
  await composer.fill('Em gửi anh bảng size ngay nhé.');
  await composer.press('Enter');
  await expect(host.getByText('Em gửi anh bảng size ngay nhé.')).toBeVisible({
    timeout: WIDGET_POLL_WAIT_MS,
  });

  // The visitor leaves a number through the chip.
  await host.getByRole('button', { name: 'Gửi số điện thoại để được gọi lại' }).click();
  await host.getByRole('textbox', { name: 'Số điện thoại của bạn' }).fill(PHONE);
  await host.getByRole('button', { name: 'Gửi số', exact: true }).click();
  await expect.poll(() => phone).toMatch(/^(\+84|0)912345678$/);

  // The dashboard sees the new lead: badge in the list and the number in the visitor panel.
  // The "Số mới" badge is forced through the mock (seenAt reset): a render check only, not backend behaviour.
  seenAt = null;
  await dash.reload();
  const row2 = dash.getByRole('button', { name: /Khách website #1/ });
  await expect(row2.getByText('Số mới')).toBeVisible();
  await row2.click();
  await expect(dash.getByRole('link', { name: /912345678/ })).toBeVisible();
  await context.close();
});

test('dashboard creates a website, shows the embed code and saves widget settings', async ({
  page,
}) => {
  await mockApi(page);
  const now = new Date().toISOString();
  const settings = {
    enabled: true,
    domains: ['shop.vn'],
    color: '#F97316',
    position: 'right',
    agentName: 'Tư vấn viên',
    avatarUrl: null,
    greeting: 'Xin chào!',
    phonePrompt: 'Để lại số điện thoại nhé.',
    phoneChipText: 'Gửi số điện thoại',
    requirePhoneAfter: 0,
  };
  const sites: unknown[] = [];
  let patch: unknown = null;
  await page.route('**/api/v1/channels**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/channels/website') && method === 'POST') {
      const body = route.request().postDataJSON() as { name: string; domains: string[] };
      const site = {
        id: uuid(50),
        provider: 'website',
        externalId: SITE_KEY,
        name: body.name,
        status: 'connected',
        botId: null,
        expiresAt: null,
        createdAt: now,
        settings: { ...settings, domains: body.domains },
      };
      sites.push(site);
      return route.fulfill({ status: 201, json: site });
    }
    if (path.endsWith('/website') && method === 'PATCH') {
      patch = route.request().postDataJSON();
      return route.fulfill({ json: sites[0] });
    }
    if (path.endsWith('/channels')) return route.fulfill({ json: { data: sites, providers: [] } });
    return route.fallback();
  });
  await page.goto('/app/channels');
  await page.getByRole('button', { name: 'Website' }).click();
  await page.getByRole('button', { name: 'Thêm website' }).click();
  await page.getByLabel('Tên website').fill('Shop Hoa');
  await page.getByLabel('Tên miền').fill('shop.vn');
  await page.getByRole('button', { name: 'Tạo website' }).click();
  await expect(page.getByLabel('Mã nhúng')).toContainText(`?key=${SITE_KEY}" async></script>`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Cài đặt/ }).click();
  const color = page.getByLabel('Màu chủ đạo');
  await color.fill('#000000');
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect.poll(() => patch).toEqual({ color: '#000000' });
});
