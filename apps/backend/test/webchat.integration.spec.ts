import {
  BotDto,
  ContactListResponse,
  ConversationDetailDto,
  CrmOptionList,
  ConversationListResponse,
  ChannelConnectionDto,
  WebsiteVisitorDto,
  WidgetConfigDto,
  WidgetPollResponse,
  WidgetSendResponse,
  WidgetUploadResponse,
} from '@agent-sales/contracts';
import { schema, eq, withTenant, type Database } from '@agent-sales/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_TENANT } from '../src/common/db/db.module.js';
import { AI_FACADE, type AiFacade } from '../src/modules/ai/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../src/modules/crm/api/index.js';
import {
  CONVERSATION_RUNNER,
  type ConversationRunner,
} from '../src/modules/conversation/api/index.js';
import {
  WEBCHAT_UPLOAD_STORAGE,
  type WebchatUploadStorage,
} from '../src/modules/webchat/application/ports/upload-storage.js';
import { WebchatService } from '../src/modules/webchat/application/webchat.service.js';
import { startHarness, type Harness, type TestUser } from './support/harness.js';

/** Website chat end to end on a real Postgres: public widget API → queue → inbox pipeline → poll. */
const ORIGIN = 'https://shop.test';
let hx: Harness;
let owner: TestUser;
let stranger: TestUser;
let site: ChannelConnectionDto;
let runner: ConversationRunner;
let ai: AiFacade;
const base = () => `/api/v1/webchat/v1/sites/${site.externalId}`;

let addresses = 0;
const nextIp = () => `10.7.${Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`;
const server = () => hx.app.getHttpAdapter().getInstance();

function pub(
  method: 'GET' | 'POST' | 'OPTIONS',
  path: string,
  opts: {
    origin?: string | null;
    token?: string;
    payload?: object | Buffer;
    headers?: Record<string, string>;
    ip?: string;
  } = {},
) {
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  return server().inject({
    method,
    url: `${base()}${path}`,
    remoteAddress: opts.ip ?? nextIp(),
    headers: {
      ...(origin ? { origin } : {}),
      ...(opts.token ? { authorization: `Visitor ${opts.token}` } : {}),
      ...opts.headers,
    },
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
}

const page = { url: 'https://shop.test/ao-thun?utm_source=fb', title: 'Áo thun' };
const sendBody = (text: string, over: Record<string, unknown> = {}) => ({
  clientMessageId: crypto.randomUUID(),
  text,
  page,
  firstUrl: 'https://shop.test/?gclid=abc',
  referrer: 'https://www.google.com/',
  ...over,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function tick() {
  // Events become claimable after a short quiet period (burst merge).
  await sleep(900);
  await runner.tick();
}

beforeAll(async () => {
  hx = await startHarness();
  owner = await hx.user('chat-owner@shop.vn', 'Chủ shop');
  stranger = await hx.user('chat-stranger@shop.vn', 'Người lạ');
  const bot = BotDto.parse(
    (await hx.call(owner.h, 'POST', '/bots', { name: 'Bot web', industry: 'fashion' })).json(),
  );
  if (!bot.isActive) await hx.call(owner.h, 'PATCH', `/bots/${bot.id}`, { isActive: true });
  const created = await hx.call(owner.h, 'POST', '/channels/website', {
    name: 'Shop site',
    domains: ['shop.test'],
    botId: bot.id,
  });
  expect(created.statusCode).toBe(201);
  site = ChannelConnectionDto.parse(created.json());
  runner = hx.app.get<ConversationRunner>(CONVERSATION_RUNNER, { strict: false });
  ai = hx.app.get<AiFacade>(AI_FACADE, { strict: false });
  vi.spyOn(ai, 'reply').mockImplementation(async () => ({
    runId: crypto.randomUUID(),
    reply: 'Dạ shop còn áo thun ạ.',
    outcome: 'answered' as const,
    guardrail: null,
    sources: [],
    images: [],
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    provider: 'fake',
    model: 'fake',
    latencyMs: 1,
  }));
});
afterAll(async () => {
  vi.restoreAllMocks();
  await hx?.stop();
});

describe('public widget API', () => {
  it('serves the config to an allowed origin with CORS for that origin only', async () => {
    const res = await pub('GET', '');
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['vary']).toContain('Origin');
    const config = WidgetConfigDto.parse(res.json());
    expect(config).toMatchObject({ position: 'right', language: 'vi' });
    expect(res.body).not.toMatch(/domains|shop\.test|botId/);
    const sub = await pub('GET', '', { origin: 'https://www.shop.test' });
    expect(sub.headers['access-control-allow-origin']).toBe('https://www.shop.test');
  });

  it('answers 404 NOT_FOUND for another origin, a missing origin and an unknown key', async () => {
    for (const origin of ['https://evil.test', 'https://shop.test.evil.test', null]) {
      const res = await pub('GET', '', { origin });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'NOT_FOUND' });
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    }
    const unknown = await server().inject({
      method: 'GET',
      url: '/api/v1/webchat/v1/sites/wk_unknownunknownunknown00',
      headers: { origin: ORIGIN },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('answers the CORS preflight for an allowed origin only and leaves other routes alone', async () => {
    const ok = await pub('OPTIONS', '/messages', {
      headers: { 'access-control-request-method': 'POST' },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-headers']).toContain('Authorization');
    expect(ok.headers['access-control-allow-methods']).toContain('POST');
    const evil = await pub('OPTIONS', '/messages', { origin: 'https://evil.test' });
    expect(evil.statusCode).toBe(404);
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const dashboard = await server().inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://evil.test' },
    });
    expect(dashboard.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('turns a disabled site into 404 and back on after re-enabling', async () => {
    const off = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, { enabled: false });
    expect(off.statusCode).toBe(200);
    hx.app.get(WebchatService, { strict: false }).clearSiteCache();
    expect((await pub('GET', '')).statusCode).toBe(404);
    expect((await pub('POST', '/messages', { payload: sendBody('hi') })).statusCode).toBe(404);
    await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, { enabled: true });
    hx.app.get(WebchatService, { strict: false }).clearSiteCache();
    expect((await pub('GET', '')).statusCode).toBe(200);
  });

  it('never fails a preflight with a malformed percent escape (400 from Fastify, 404 from the hook)', async () => {
    const res = await server().inject({
      method: 'OPTIONS',
      url: '/api/v1/webchat/v1/sites/%E0%A4%A/messages',
      headers: { origin: ORIGIN },
    });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('rejects a visitor token signed for another site (401)', async () => {
    const other = ChannelConnectionDto.parse(
      (
        await hx.call(owner.h, 'POST', '/channels/website', {
          name: 'Other',
          domains: ['shop.test'],
        })
      ).json(),
    );
    const sent = await server().inject({
      method: 'POST',
      url: `/api/v1/webchat/v1/sites/${other.externalId}/messages`,
      remoteAddress: nextIp(),
      headers: { origin: ORIGIN },
      payload: sendBody('hi'),
    });
    const foreignToken = WidgetSendResponse.parse(sent.json()).visitorToken;
    const res = await pub('GET', '/messages', { token: foreignToken });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'INVALID_VISITOR' });
  });

  it('rejects polls without or with a forged token', async () => {
    expect((await pub('GET', '/messages')).statusCode).toBe(401);
    expect((await pub('GET', '/messages', { token: 'v1.nope.nope' })).json()).toEqual({
      error: 'INVALID_VISITOR',
    });
    expect((await pub('POST', '/phone', { payload: { phone: '0912345678' } })).statusCode).toBe(
      401,
    );
  });
});

describe('a visitor conversation through the inbox pipeline', () => {
  const clientMessageId = crypto.randomUUID();
  let token = '';
  let conversationId = '';
  let cursor: string | undefined;

  it('accepts the first message, creates the visitor and deduplicates a retry', async () => {
    const body = sendBody('Shop còn áo thun không?', { clientMessageId });
    const res = await pub('POST', '/messages', { payload: body });
    expect(res.statusCode).toBe(202);
    const sent = WidgetSendResponse.parse(res.json());
    token = sent.visitorToken;
    expect(sent.message).toMatchObject({ id: clientMessageId, clientMessageId, role: 'customer' });

    const retry = await pub('POST', '/messages', { token, payload: body });
    expect(retry.statusCode).toBe(202);
    const rows = await hx.owner.db
      .select()
      .from(schema.channelWebhookEvents)
      .where(eq(schema.channelWebhookEvents.connectionId, site.id));
    expect(rows.filter((r) => r.externalId.endsWith(`:${clientMessageId}`))).toHaveLength(1);
    const visitors = await hx.owner.db
      .select()
      .from(schema.webchatVisitors)
      .where(eq(schema.webchatVisitors.connectionId, site.id));
    expect(visitors).toHaveLength(1);
    expect(visitors[0]).toMatchObject({
      firstUrl: 'https://shop.test/?gclid=abc',
      referrer: 'https://www.google.com/',
      lastUrl: page.url,
      lastTitle: 'Áo thun',
    });
  });

  it('shows the visitor typing while the message is queued, then the customer message and the bot answer', async () => {
    const queued = WidgetPollResponse.parse((await pub('GET', '/messages', { token })).json());
    expect(queued.botTyping).toBe(true);
    await tick();
    const res = await pub('GET', '/messages', { token });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    const poll = WidgetPollResponse.parse(res.json());
    expect(poll.botTyping).toBe(false);
    expect(poll.messages.map((m) => [m.role, m.text])).toEqual([
      ['customer', 'Shop còn áo thun không?'],
      ['agent', 'Dạ shop còn áo thun ạ.'],
    ]);
    expect(poll.messages[0]?.clientMessageId).toBe(clientMessageId);
    expect(poll.messages[1]?.clientMessageId).toBeNull();
    cursor = poll.messages.at(-1)?.id;
    expect(
      WidgetPollResponse.parse((await pub('GET', `/messages?after=${cursor}`, { token })).json())
        .messages,
    ).toEqual([]);
  });

  it('lists the conversation in the inbox as a website conversation', async () => {
    const list = ConversationListResponse.parse(
      (await hx.call(owner.h, 'GET', '/conversations')).json(),
    );
    const c = list.data.find((x) => x.channelId === site.id);
    expect(c).toMatchObject({ provider: 'website', mode: 'bot' });
    expect(c?.customerName).toMatch(/^Khách website [0-9a-f]{4}$/);
    conversationId = c?.id ?? '';
    expect(conversationId).not.toBe('');
  });

  it('delivers a staff reply to the visitor on the next poll, without the staff identity', async () => {
    const send = await hx.call(owner.h, 'POST', `/conversations/${conversationId}/messages`, {
      text: 'Em là nhân viên, anh/chị cần gì ạ?',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(send.statusCode).toBe(201);
    const poll = WidgetPollResponse.parse(
      (await pub('GET', `/messages?after=${cursor}`, { token })).json(),
    );
    expect(poll.messages).toHaveLength(1);
    expect(poll.messages[0]).toMatchObject({
      role: 'agent',
      text: 'Em là nhân viên, anh/chị cần gì ạ?',
    });
    expect(JSON.stringify(poll)).not.toContain('Chủ shop');
  });

  it('never shows internal notes to the visitor', async () => {
    await hx.call(owner.h, 'POST', `/conversations/${conversationId}/notes`, {
      text: 'khách khó tính',
    });
    const poll = await pub('GET', '/messages', { token });
    expect(poll.body).not.toContain('khách khó tính');
  });

  it('gives staff the visitor details and hides them from other workspaces', async () => {
    const res = await hx.call(owner.h, 'GET', `/webchat/conversations/${conversationId}/visitor`);
    expect(res.statusCode).toBe(200);
    expect(WebsiteVisitorDto.parse(res.json())).toMatchObject({
      firstUrl: 'https://shop.test/?gclid=abc',
      referrer: 'https://www.google.com/',
      lastUrl: page.url,
      lastTitle: 'Áo thun',
      phone: null,
    });
    const other = await hx.call(
      stranger.h,
      'GET',
      `/webchat/conversations/${conversationId}/visitor`,
    );
    expect(other.statusCode).toBe(404);
    const anon = await server().inject({
      method: 'GET',
      url: `/api/v1/webchat/conversations/${conversationId}/visitor`,
    });
    expect(anon.statusCode).toBe(401);
  });

  it('keeps visitor rows invisible to another workspace (RLS)', async () => {
    const db = hx.app.get<Database>(DB_TENANT, { strict: false });
    const own = await withTenant(db, owner.ownWorkspace as never, (tx) =>
      tx.select().from(schema.webchatVisitors),
    );
    const foreign = await withTenant(db, stranger.ownWorkspace as never, (tx) =>
      tx.select().from(schema.webchatVisitors),
    );
    expect(own.length).toBeGreaterThan(0);
    expect(foreign).toEqual([]);
  });

  it('links the conversation to the visitor lazily on the first poll that finds it', async () => {
    const [row] = await hx.owner.db
      .select()
      .from(schema.webchatVisitors)
      .where(eq(schema.webchatVisitors.connectionId, site.id));
    expect(row?.conversationId).toBe(conversationId);
  });
});

describe('uploads and rate limits', () => {
  function multipart(content: Buffer, filename = 'image.jpg') {
    const boundary = '----rapizboundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`,
    );
    return {
      payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }
  async function visitorToken() {
    const res = await pub('POST', '/messages', { payload: sendBody('ảnh') });
    return WidgetSendResponse.parse(res.json()).visitorToken;
  }

  it('rejects a forged token and, without object storage, answers 503 UNAVAILABLE', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const forged = await pub('POST', '/uploads', { token: 'forged', ...multipart(jpeg) });
    expect(forged.statusCode).toBe(401);
    const noToken = await pub('POST', '/uploads', multipart(jpeg));
    expect(noToken.statusCode).toBe(503);
    const res = await pub('POST', '/uploads', { token: await visitorToken(), ...multipart(jpeg) });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'UNAVAILABLE' });
  });

  it('stores a real image through multipart, rejects non-images and oversized files, and accepts the stored url', async () => {
    const storage = hx.app.get<WebchatUploadStorage>(WEBCHAT_UPLOAD_STORAGE, { strict: false });
    const spies: Array<{ mockRestore(): void }> = [
      vi.spyOn(storage, 'available').mockReturnValue(true),
      vi.spyOn(storage, 'publicPrefix').mockReturnValue('https://cdn.test'),
    ];
    const put = vi
      .spyOn(storage, 'put')
      .mockImplementation(async (key: string) => `https://cdn.test/${key}`);
    spies.push(put);
    const token = await visitorToken();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const ok = await pub('POST', '/uploads', { token, ...multipart(png) });
    expect(ok.statusCode).toBe(200);
    const { url } = WidgetUploadResponse.parse(ok.json());
    expect(url).toMatch(
      new RegExp(
        `^https://cdn\\.test/webchat/${owner.ownWorkspace}/${site.id}/[0-9a-f-]{36}\\.png$`,
      ),
    );
    expect(put).toHaveBeenCalledTimes(1);
    const html = await pub('POST', '/uploads', {
      token,
      ...multipart(Buffer.from('<html>x</html>')),
    });
    expect(html.statusCode).toBe(415);
    const big = await pub('POST', '/uploads', {
      token,
      ...multipart(Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)])),
    });
    expect(big.statusCode).toBe(413);
    expect(put).toHaveBeenCalledTimes(1);
    const sent = await pub('POST', '/messages', {
      token,
      payload: sendBody('', { text: undefined, attachmentUrl: url }),
    });
    expect(sent.statusCode).toBe(202);
    expect(WidgetSendResponse.parse(sent.json()).message.imageUrl).toBe(url);
    for (const spy of spies) spy.mockRestore();
  });

  it('starts the visitor from an image sent as the very first action', async () => {
    const storage = hx.app.get<WebchatUploadStorage>(WEBCHAT_UPLOAD_STORAGE, { strict: false });
    const spies: Array<{ mockRestore(): void }> = [
      vi.spyOn(storage, 'available').mockReturnValue(true),
      vi.spyOn(storage, 'publicPrefix').mockReturnValue('https://cdn.test'),
      vi.spyOn(storage, 'put').mockImplementation(async (key: string) => `https://cdn.test/${key}`),
    ];
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const query = new URLSearchParams({
      firstUrl: 'https://shop.test/first-image',
      referrer: 'https://www.bing.com/',
      pageUrl: 'https://shop.test/p/2',
      pageTitle: 'Trang ảnh',
    });
    const up = await pub('POST', `/uploads?${query}`, multipart(png));
    expect(up.statusCode).toBe(200);
    const { url, visitorToken } = WidgetUploadResponse.parse(up.json());
    const token = visitorToken as string;
    expect(token).toBeTruthy();
    const rows = await hx.owner.db
      .select()
      .from(schema.webchatVisitors)
      .where(eq(schema.webchatVisitors.firstUrl, 'https://shop.test/first-image'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      referrer: 'https://www.bing.com/',
      lastUrl: 'https://shop.test/p/2',
      lastTitle: 'Trang ảnh',
    });
    const sent = await pub('POST', '/messages', {
      token,
      payload: sendBody('', { text: undefined, attachmentUrl: url }),
    });
    expect(sent.statusCode).toBe(202);
    expect(WidgetSendResponse.parse(sent.json()).visitorToken).toBe(token);
    const again = await pub('POST', '/uploads', { token, ...multipart(png) });
    expect(WidgetUploadResponse.parse(again.json()).visitorToken).toBeUndefined();
    for (const spy of spies) spy.mockRestore();
  });

  it('rejects a foreign attachment url', async () => {
    const res = await pub('POST', '/messages', {
      token: await visitorToken(),
      payload: sendBody('', { text: undefined, attachmentUrl: 'https://evil.test/x.png' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 429 with Retry-After after a burst from one visitor', async () => {
    const token = await visitorToken();
    const statuses: number[] = [];
    let last: { headers: Record<string, unknown> } | undefined;
    for (let i = 0; i < 6; i++) {
      const res = await pub('POST', '/messages', { token, payload: sendBody(`m${i}`) });
      statuses.push(res.statusCode);
      last = res;
    }
    expect(statuses.slice(0, 4)).toEqual([202, 202, 202, 202]);
    expect(statuses.at(-1)).toBe(429);
    expect(Number(last?.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });
});

describe('website lead capture', () => {
  const PHONE = '0912345679';
  const E164 = '+84912345679';
  let token = '';
  let conversationId = '';

  it('creates a website customer from /phone and flags the conversation as a new lead', async () => {
    const sent = await pub('POST', '/messages', { payload: sendBody('Cho em xin giá áo thun') });
    token = WidgetSendResponse.parse(sent.json()).visitorToken;
    await tick();
    const res = await pub('POST', '/phone', { token, payload: { phone: '0912 345 679' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phoneCaptured: true });
    expect(
      WidgetPollResponse.parse((await pub('GET', '/messages', { token })).json()).phoneCaptured,
    ).toBe(true);

    const found = ContactListResponse.parse(
      (await hx.call(owner.h, 'POST', '/contacts/query', { q: PHONE })).json(),
    );
    expect(found.data).toHaveLength(1);
    const sources = CrmOptionList.parse(
      (await hx.call(owner.h, 'GET', '/crm/sources')).json(),
    ).data;
    expect(found.data[0]).toMatchObject({
      phoneNormalized: E164,
      sourceId: sources.find((x) => x.key === 'website')?.id,
    });
    expect(found.data[0]?.name).toBe('Khách website 5679');

    const list = ConversationListResponse.parse(
      (await hx.call(owner.h, 'GET', '/conversations')).json(),
    );
    const c = list.data.find((x) => x.lead?.phone === E164);
    conversationId = c?.id ?? '';
    expect(c?.lead).toMatchObject({ contactId: found.data[0]?.id, seenAt: null });
    const visitor = WebsiteVisitorDto.parse(
      (await hx.call(owner.h, 'GET', `/webchat/conversations/${conversationId}/visitor`)).json(),
    );
    expect(visitor).toMatchObject({ phone: E164, contactId: found.data[0]?.id });
  });

  it('sets lead.seenAt when staff mark the conversation read, and keeps it afterwards', async () => {
    const read = await hx.call(owner.h, 'POST', `/conversations/${conversationId}/read`);
    expect(read.statusCode).toBe(200);
    const seenAt = (read.json() as { lead: { seenAt: string | null } }).lead.seenAt;
    expect(seenAt).not.toBeNull();
    const again = await hx.call(owner.h, 'POST', `/conversations/${conversationId}/read`);
    expect((again.json() as { lead: { seenAt: string } }).lead.seenAt).toBe(seenAt);
    const detail = ConversationDetailDto.parse(
      (await hx.call(owner.h, 'GET', `/conversations/${conversationId}`)).json(),
    );
    expect(detail.conversation.lead?.seenAt).toBe(seenAt);
  });

  it('adds the website capture to the history of an existing customer instead of a second one', async () => {
    const sent = await pub('POST', '/messages', { payload: sendBody('xin chào') });
    const other = WidgetSendResponse.parse(sent.json()).visitorToken;
    expect(
      (await pub('POST', '/phone', { token: other, payload: { phone: PHONE } })).statusCode,
    ).toBe(200);
    const found = ContactListResponse.parse(
      (await hx.call(owner.h, 'POST', '/contacts/query', { q: PHONE })).json(),
    );
    expect(found.data).toHaveLength(1);
  });

  it('captures a number typed into a message, and rejects invalid numbers with 422', async () => {
    const sent = await pub('POST', '/messages', {
      payload: sendBody('gọi em số 0901.234.568 nhé'),
    });
    expect(sent.statusCode).toBe(202);
    const found = ContactListResponse.parse(
      (await hx.call(owner.h, 'POST', '/contacts/query', { q: '0901234568' })).json(),
    );
    expect(found.data).toHaveLength(1);
    const bad = await pub('POST', '/phone', { token, payload: { phone: '0987654321' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toEqual({ error: 'INVALID_PHONE' });
  });

  it('creates exactly one customer when the same phone is captured concurrently', async () => {
    const crm = hx.app.get<CrmFacade>(CRM_FACADE, { strict: false });
    const ws = owner.ownWorkspace as never;
    const input = {
      phoneE164: '+84933445566',
      sourceKey: 'website' as const,
      displayName: 'Khách website 5566',
      firstUrl: null,
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => crm.upsertLeadByPhone(ws, input)),
    );
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const found = ContactListResponse.parse(
      (await hx.call(owner.h, 'POST', '/contacts/query', { q: '0933445566' })).json(),
    );
    expect(found.data).toHaveLength(1);
  });

  it('keeps the first source of an existing customer', async () => {
    const sources = CrmOptionList.parse(
      (await hx.call(owner.h, 'GET', '/crm/sources')).json(),
    ).data;
    const facebook = sources.find((x) => x.key === 'facebook');
    const made = await hx.call(owner.h, 'POST', '/contacts', {
      name: 'Chị Lan',
      phone: '0977112233',
      sourceId: facebook?.id,
    });
    expect(made.statusCode).toBe(201);
    const crm = hx.app.get<CrmFacade>(CRM_FACADE, { strict: false });
    const r = await crm.upsertLeadByPhone(owner.ownWorkspace as never, {
      phoneE164: '+84977112233',
      sourceKey: 'website',
      displayName: 'Khách website 2233',
      firstUrl: 'https://shop.test/a',
    });
    expect(r.created).toBe(false);
    await Promise.all(
      [1, 2].map(() =>
        crm.upsertLeadByPhone(owner.ownWorkspace as never, {
          phoneE164: '+84977112233',
          sourceKey: 'website',
          displayName: 'Khách website 2233',
          firstUrl: 'https://shop.test/a',
        }),
      ),
    );
    const found = ContactListResponse.parse(
      (await hx.call(owner.h, 'POST', '/contacts/query', { q: '0977112233' })).json(),
    );
    expect(found.data).toHaveLength(1);
    expect(found.data[0]).toMatchObject({ name: 'Chị Lan', sourceId: facebook?.id });
    const history = (await hx.call(owner.h, 'GET', `/contacts/${r.contactId}/history`)).json() as {
      data: Array<{ changes: Record<string, { to: unknown }> }>;
    };
    expect(
      history.data.filter((h) => h.changes['lead']?.to === 'https://shop.test/a'),
    ).toHaveLength(1);
  });
});

describe('required phone', () => {
  it('asks after N messages, blocks further text with 409 and unblocks once a phone is left', async () => {
    const patched = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, {
      requirePhoneAfter: 2,
    });
    expect(patched.statusCode).toBe(200);
    hx.app.get(WebchatService, { strict: false }).clearSiteCache();
    const first = await pub('POST', '/messages', { payload: sendBody('một') });
    const token = WidgetSendResponse.parse(first.json()).visitorToken;
    expect((await pub('POST', '/messages', { token, payload: sendBody('hai') })).statusCode).toBe(
      202,
    );
    const poll = WidgetPollResponse.parse((await pub('GET', '/messages', { token })).json());
    expect(poll.phoneRequired).toBe(true);
    const blocked = await pub('POST', '/messages', { token, payload: sendBody('ba') });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: 'PHONE_REQUIRED' });
    expect(
      (await pub('POST', '/phone', { token, payload: { phone: '0966778899' } })).statusCode,
    ).toBe(200);
    expect(
      WidgetPollResponse.parse((await pub('GET', '/messages', { token })).json()).phoneRequired,
    ).toBe(false);
    expect((await pub('POST', '/messages', { token, payload: sendBody('bốn') })).statusCode).toBe(
      202,
    );
    await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, { requirePhoneAfter: 0 });
    hx.app.get(WebchatService, { strict: false }).clearSiteCache();
  });
});
