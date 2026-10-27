import { workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFacade } from '../../bot/api/index.js';
import type { ChannelFacade, WebsiteSite } from '../../channel/api/index.js';
import type { ConversationFacade } from '../../conversation/api/index.js';
import type { CrmFacade } from '../../crm/api/index.js';
import type { WebchatUploadStorage } from '../application/ports/upload-storage.js';
import { InMemoryRateLimiter } from '../application/rate-limiter.js';
import { WebchatService, type PublicCall } from '../application/webchat.service.js';
import type { WidgetError } from '../application/widget-error.js';
import { MemoryVisitorStore } from './factories/memory-visitor-store.js';

const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
const KEY = 'wk_abcdefghijklmnopqrstuv';
const ORIGIN = 'https://shop.test';
const msgId = () => crypto.randomUUID();

let site: WebsiteSite;
let resolved: WebsiteSite | null;
let enqueue: ReturnType<typeof vi.fn>;
let visitors: MemoryVisitorStore;
let service: WebchatService;
let conversationExists = true;
let upsertLead: ReturnType<typeof vi.fn>;
let linkLead: ReturnType<typeof vi.fn>;
let storage: WebchatUploadStorage & { put: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
  site = {
    workspaceId: ws,
    connectionId: '018d0000-0000-7000-8000-000000000002',
    siteKey: KEY,
    name: 'Shop',
    status: 'connected',
    botId: '018d0000-0000-7000-8000-000000000003',
    settings: {
      domains: ['shop.test'],
      color: '#F97316',
      position: 'right',
      agentName: 'Lan',
      avatarUrl: null,
      greeting: 'Chào',
      phonePrompt: 'SĐT?',
      phoneChipText: 'Gửi SĐT',
      requirePhoneAfter: 0,
    },
  };
  resolved = site;
  enqueue = vi.fn(async () => true);
  const channels = {
    resolveWebsite: vi.fn(async () => resolved),
    isOriginAllowed: vi.fn((s: WebsiteSite, origin: string | undefined) => {
      try {
        const host = new URL(origin ?? '').hostname;
        return s.settings.domains.some((d) => host === d || host.endsWith(`.${d}`));
      } catch {
        return false;
      }
    }),
    signVisitorToken: vi.fn(async (_s: WebsiteSite, id: string) => `v1.${id}.sig`),
    verifyVisitorToken: vi.fn(
      async (_s: WebsiteSite, t: string) => /^v1\.([0-9a-f-]{36})\.sig$/.exec(t)?.[1] ?? null,
    ),
    enqueueWebsiteEvent: enqueue,
    hasPendingCustomerEvent: vi.fn(async () => true),
  } as unknown as ChannelFacade;
  conversationExists = true;
  linkLead = vi.fn(async () => undefined);
  const conversations = {
    listForVisitor: vi.fn(async () => ({
      conversationId: conversationExists ? '018d0000-0000-7000-8000-000000000009' : null,
      messages: [],
    })),
    linkLead,
  } as unknown as ConversationFacade;
  upsertLead = vi.fn(async () => ({
    contactId: '018d0000-0000-7000-8000-0000000000c1',
    created: true,
  }));
  const crm = { upsertLeadByPhone: upsertLead } as unknown as CrmFacade;
  const bots = { getBot: vi.fn(async () => ({ language: 'en' })) } as unknown as BotFacade;
  visitors = new MemoryVisitorStore();
  storage = {
    available: () => true,
    publicPrefix: () => 'https://cdn.test',
    put: vi.fn(async (key: string) => `https://cdn.test/${key}`),
  };
  service = new WebchatService(
    channels,
    conversations,
    bots,
    crm,
    visitors,
    storage,
    new InMemoryRateLimiter(),
  );
});
afterEach(() => vi.useRealTimers());

const call = (over: Partial<PublicCall> = {}): PublicCall => ({
  key: KEY,
  origin: ORIGIN,
  ip: '203.0.113.7',
  authorization: undefined,
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({
  clientMessageId: msgId(),
  text: 'Xin chào',
  page: { url: 'https://shop.test/a?utm=1', title: 'Trang A' },
  ...over,
});
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as WidgetError,
  );

describe('WebchatService site gate', () => {
  it.each([
    ['unknown key', () => (resolved = null), ORIGIN],
    ['disabled site', () => (resolved = { ...site, status: 'disabled' }), ORIGIN],
    ['wrong origin', () => undefined, 'https://evil.test'],
    ['missing origin', () => undefined, undefined],
    ['look-alike host', () => undefined, 'https://shop.test.evil.test'],
  ])('answers the uniform 404 for %s', async (_name, arrange, origin) => {
    arrange();
    const e = await failure(service.config(call({ origin })));
    expect(e).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
  it('does not even look up a malformed key', async () => {
    const e = await failure(service.config(call({ key: 'nope' })));
    expect(e?.status).toBe(404);
  });
  it('serves the public config without domains or bot id, language from the bot', async () => {
    const config = await service.config(call());
    expect(config).toMatchObject({ agentName: 'Lan', language: 'en', position: 'right' });
    expect(JSON.stringify(config)).not.toMatch(/shop\.test|domains|botId/);
  });
  it('allows a subdomain of an allowed domain', async () => {
    await expect(service.config(call({ origin: 'https://www.shop.test' }))).resolves.toBeDefined();
  });
});

describe('WebchatService send', () => {
  it('creates the visitor, signs a token and enqueues a website event keyed by clientMessageId', async () => {
    const b = body({ firstUrl: 'https://shop.test/?gclid=x', referrer: 'https://google.com/' });
    const res = await service.send(call(), b);
    expect(res.visitorToken).toMatch(/^v1\.[0-9a-f-]{36}\.sig$/);
    expect(res.message).toMatchObject({
      id: b.clientMessageId,
      clientMessageId: b.clientMessageId,
      role: 'customer',
      text: 'Xin chào',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const event = enqueue.mock.calls[0]?.[1];
    expect(event).toMatchObject({
      kind: 'website',
      assetExternalId: KEY,
      externalEventId: expect.stringMatching(new RegExp(`^[0-9a-f-]{36}:${b.clientMessageId}$`)),
      externalMessageId: b.clientMessageId,
      type: 'message',
      text: 'Xin chào',
    });
    const visitor = [...visitors.rows.values()][0];
    expect(event.senderExternalId).toBe(visitor?.id);
    expect(visitor).toMatchObject({
      firstUrl: 'https://shop.test/?gclid=x',
      referrer: 'https://google.com/',
      lastUrl: 'https://shop.test/a?utm=1',
      lastTitle: 'Trang A',
    });
  });
  it('reuses a valid token and keeps the visitor, updating the current page', async () => {
    const first = await service.send(call(), body());
    await service.send(
      call({ authorization: `Visitor ${first.visitorToken}` }),
      body({ page: { url: 'https://shop.test/b', title: 'B' } }),
    );
    expect(visitors.rows.size).toBe(1);
    expect([...visitors.rows.values()][0]).toMatchObject({ lastUrl: 'https://shop.test/b' });
  });
  it('rejects a bad token with 401 INVALID_VISITOR', async () => {
    const e = await failure(service.send(call({ authorization: 'Visitor nonsense' }), body()));
    expect(e).toMatchObject({ status: 401, code: 'INVALID_VISITOR' });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects text and attachment together, empty and oversized messages with 400', async () => {
    for (const bad of [
      body({ attachmentUrl: 'https://cdn.test/webchat/x.png' }),
      body({ text: '   ' }),
      body({ text: 'x'.repeat(2001) }),
    ])
      expect((await failure(service.send(call(), bad)))?.status).toBe(400);
  });
  it("only accepts attachments produced by this site's upload route", async () => {
    const own = `https://cdn.test/webchat/${ws}/${site.connectionId}/018d0000-0000-7000-8000-0000000000aa.png`;
    const sent = await service.send(call(), body({ text: undefined, attachmentUrl: own }));
    expect(sent.message.imageUrl).toBe(own);
    expect(enqueue.mock.calls[0]?.[1].attachments).toEqual([{ type: 'image', url: own }]);
    const foreign = body({ text: undefined, attachmentUrl: 'https://evil.test/x.png' });
    expect((await failure(service.send(call(), foreign)))?.code).toBe('INVALID_ATTACHMENT');
  });
  it('answers 429 with Retry-After on the 6th message within a second', async () => {
    const first = await service.send(call(), body());
    const auth = `Visitor ${first.visitorToken}`;
    for (let i = 0; i < 4; i++) await service.send(call({ authorization: auth }), body());
    const e = await failure(service.send(call({ authorization: auth }), body()));
    expect(e).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(e?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    vi.advanceTimersByTime(5000);
    await expect(service.send(call({ authorization: auth }), body())).resolves.toBeDefined();
  });
  it('limits one address to 120 messages per site per 10 minutes across visitors', async () => {
    for (let i = 0; i < 120; i++) await service.send(call(), body());
    expect((await failure(service.send(call(), body())))?.status).toBe(429);
    // another address is unaffected (the per-minute new-visitor cap has passed)
    vi.advanceTimersByTime(61_000);
    await expect(service.send(call({ ip: '198.51.100.9' }), body())).resolves.toBeDefined();
  });
  it('limits new visitors per site to 120 per minute', async () => {
    for (let i = 0; i < 120; i++) await service.send(call({ ip: `10.0.${i}.1` }), body());
    expect((await failure(service.send(call({ ip: '10.9.9.9' }), body())))?.status).toBe(429);
  });
  it('never puts the raw address into any limiter key or stored row', async () => {
    await service.send(call(), body());
    expect(JSON.stringify([...visitors.rows.values()])).not.toContain('203.0.113.7');
  });
});

describe('WebchatService poll', () => {
  it('needs a valid token', async () => {
    expect((await failure(service.poll(call(), undefined)))?.status).toBe(401);
    expect(
      (await failure(service.poll(call({ authorization: 'Visitor x' }), undefined)))?.status,
    ).toBe(401);
  });
  it('returns messages, typing, phone state and links the conversation lazily', async () => {
    const first = await service.send(call(), body());
    const res = await service.poll(
      call({ authorization: `Visitor ${first.visitorToken}` }),
      undefined,
    );
    expect(res).toMatchObject({ botTyping: true, phoneCaptured: false, phoneRequired: false });
    expect([...visitors.rows.values()][0]?.conversationId).toBe(
      '018d0000-0000-7000-8000-000000000009',
    );
  });
  it('rejects a malformed cursor', async () => {
    const first = await service.send(call(), body());
    const e = await failure(
      service.poll(call({ authorization: `Visitor ${first.visitorToken}` }), 'not-a-uuid'),
    );
    expect(e?.status).toBe(400);
  });
});

describe('WebchatService upload', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  async function auth() {
    return `Visitor ${(await service.send(call(), body())).visitorToken}`;
  }
  it('stores a valid image under the connection prefix and returns the public URL', async () => {
    const { url } = await service.upload(call({ authorization: await auth() }), async () => png);
    expect(url).toMatch(
      new RegExp(`^https://cdn\\.test/webchat/${ws}/${site.connectionId}/[0-9a-f-]{36}\\.png$`),
    );
  });
  it('rejects non-images by magic bytes and oversized files, and a bad token', async () => {
    const a = await auth();
    const html = Buffer.from('<html></html>');
    expect(
      (await failure(service.upload(call({ authorization: a }), async () => html)))?.status,
    ).toBe(415);
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
    expect(
      (await failure(service.upload(call({ authorization: a }), async () => big)))?.status,
    ).toBe(413);
    expect(
      (await failure(service.upload(call({ authorization: 'Visitor nope' }), async () => png)))
        ?.status,
    ).toBe(401);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('answers 503 UNAVAILABLE without object storage', async () => {
    const a = await auth();
    storage.available = () => false;
    const e = await failure(service.upload(call({ authorization: a }), async () => png));
    expect(e).toMatchObject({ status: 503, code: 'UNAVAILABLE' });
  });
  it('starts the visitor when the first action is an image: token, row fields and new-visitor limits', async () => {
    const res = await service.upload(call(), async () => png, {
      firstUrl: 'https://shop.test/landing',
      referrer: 'https://google.test/',
      pageUrl: 'https://shop.test/p/1',
      pageTitle: 'Sản phẩm',
    });
    expect(res.url).toMatch(/\.png$/);
    const token = res.visitorToken as string;
    expect(token).toMatch(/^v1\.[0-9a-f-]{36}\.sig$/);
    const visitorId = /^v1\.([0-9a-f-]{36})\.sig$/.exec(token)?.[1] as string;
    const row = await visitors.find(ws, site.connectionId, visitorId);
    expect(row).toMatchObject({
      firstUrl: 'https://shop.test/landing',
      referrer: 'https://google.test/',
      lastUrl: 'https://shop.test/p/1',
      lastTitle: 'Sản phẩm',
    });
    // The normal send follows with the new token and keeps the same visitor.
    const sent = await service.send(
      call({ authorization: `Visitor ${token}` }),
      body({ text: undefined, attachmentUrl: res.url }),
    );
    expect(sent.visitorToken).toBe(token);
    // An existing visitor's upload does not issue another token.
    expect(
      (await service.upload(call({ authorization: `Visitor ${token}` }), async () => png))
        .visitorToken,
    ).toBeUndefined();
  });
  it('does not create a visitor for a rejected file or without storage', async () => {
    const html = Buffer.from('<html></html>');
    expect((await failure(service.upload(call(), async () => html)))?.status).toBe(415);
    storage.available = () => false;
    expect((await failure(service.upload(call(), async () => png)))?.status).toBe(503);
    expect(
      (service as unknown as { channels: { signVisitorToken: ReturnType<typeof vi.fn> } }).channels
        .signVisitorToken,
    ).not.toHaveBeenCalled();
  });
  it('applies the new-visitor limits to token-less uploads', async () => {
    for (let i = 0; i < 120; i++)
      await service.upload(call({ ip: `10.1.${Math.floor(i / 200)}.${i % 200}` }), async () => png);
    expect((await failure(service.upload(call({ ip: '10.9.9.9' }), async () => png)))?.status).toBe(
      429,
    );
  });
  it('allows 10 uploads per visitor per hour', async () => {
    const a = await auth();
    for (let i = 0; i < 10; i++) await service.upload(call({ authorization: a }), async () => png);
    expect(
      (await failure(service.upload(call({ authorization: a }), async () => png)))?.status,
    ).toBe(429);
  });
});

describe('WebchatService preflight and phone', () => {
  it('passes preflight only for an allowed origin of a live site', async () => {
    expect(await service.preflightAllowed(KEY, ORIGIN, '203.0.113.7')).toBe(true);
    expect(await service.preflightAllowed(KEY, 'https://evil.test', '203.0.113.7')).toBe(false);
  });
});

describe('WebchatService lead capture', () => {
  const auth = async (over: Record<string, unknown> = {}) =>
    `Visitor ${(await service.send(call(), body(over))).visitorToken}`;
  const contactId = '018d0000-0000-7000-8000-0000000000c1';
  const conversationId = '018d0000-0000-7000-8000-000000000009';

  it('captures a phone from /phone: contact, visitor row and conversation link', async () => {
    const a = await auth();
    const res = await service.phone(call({ authorization: a }), { phone: '0912 345 679' });
    expect(res).toEqual({ phoneCaptured: true });
    expect(upsertLead).toHaveBeenCalledWith(ws, {
      phoneE164: '+84912345679',
      sourceKey: 'website',
      displayName: 'Khách website 5679',
      firstUrl: 'https://shop.test/a?utm=1',
    });
    expect([...visitors.rows.values()][0]).toMatchObject({
      phoneE164: '+84912345679',
      contactId,
    });
    expect(linkLead).toHaveBeenCalledWith(
      ws,
      conversationId,
      expect.objectContaining({ contactId, phoneE164: '+84912345679' }),
    );
  });
  it.each(['abc', '', '1'.repeat(31)])(
    'answers 400 for %j (contract bounds 6..30)',
    async (phone) => {
      const a = await auth();
      expect((await failure(service.phone(call({ authorization: a }), { phone })))?.status).toBe(
        400,
      );
    },
  );
  it.each(['0123456789', '0987654321', '02838123456', 'abcdefgh'])(
    'answers 422 INVALID_PHONE for %s',
    async (phone) => {
      const a = await auth();
      const e = await failure(service.phone(call({ authorization: a }), { phone }));
      expect(e).toMatchObject({ status: 422, code: 'INVALID_PHONE' });
      expect(upsertLead).not.toHaveBeenCalled();
    },
  );
  it('needs a token and a body, and rate limits the phone route', async () => {
    expect((await failure(service.phone(call(), { phone: '0912345679' })))?.status).toBe(401);
    const a = await auth();
    expect((await failure(service.phone(call({ authorization: a }), null)))?.status).toBe(400);
    for (let i = 0; i < 9; i++)
      await service.phone(call({ authorization: a }), { phone: '0912345679' });
    expect(
      (await failure(service.phone(call({ authorization: a }), { phone: '0912345679' })))?.status,
    ).toBe(429);
  });
  it('captures a number typed in a message and still enqueues it', async () => {
    await service.send(call(), body({ text: 'em sdt 0912 345 679 nhé' }));
    expect(upsertLead).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
    expect([...visitors.rows.values()][0]?.phoneE164).toBe('+84912345679');
  });
  it('does not capture placeholder numbers or plain text', async () => {
    await service.send(call(), body({ text: 'mã 0987654321 giúp em' }));
    expect(upsertLead).not.toHaveBeenCalled();
  });
  it('links the lead lazily when the conversation appears after the capture', async () => {
    conversationExists = false;
    const first = await service.send(call(), body({ text: 'sdt 0912345679' }));
    conversationExists = true;
    expect(linkLead).not.toHaveBeenCalled();
    await service.poll(call({ authorization: `Visitor ${first.visitorToken}` }), undefined);
    expect(linkLead).toHaveBeenCalledWith(
      ws,
      conversationId,
      expect.objectContaining({ contactId }),
    );
  });
  it('retries linking the lead on the next poll when it failed during capture', async () => {
    const a = await auth();
    linkLead.mockRejectedValueOnce(new Error('boom'));
    await service.phone(call({ authorization: a }), { phone: '0912345679' });
    expect([...visitors.rows.values()][0]?.conversationId).toBeNull();
    await service.poll(call({ authorization: a }), undefined);
    expect(linkLead).toHaveBeenCalledTimes(2);
    expect([...visitors.rows.values()][0]?.conversationId).toBe(conversationId);
  });
  it('reports phoneCaptured on the next poll', async () => {
    const a = await auth();
    await service.phone(call({ authorization: a }), { phone: '0912345679' });
    expect(await service.poll(call({ authorization: a }), undefined)).toMatchObject({
      phoneCaptured: true,
      phoneRequired: false,
    });
  });

  describe('required phone', () => {
    beforeEach(() => {
      site.settings.requirePhoneAfter = 2;
    });
    it('asks after N messages and rejects the next text with 409 PHONE_REQUIRED', async () => {
      const first = await service.send(call(), body());
      const a = `Visitor ${first.visitorToken}`;
      expect((await service.poll(call({ authorization: a }), undefined)).phoneRequired).toBe(false);
      await service.send(call({ authorization: a }), body());
      expect((await service.poll(call({ authorization: a }), undefined)).phoneRequired).toBe(true);
      const e = await failure(service.send(call({ authorization: a }), body()));
      expect(e).toMatchObject({ status: 409, code: 'PHONE_REQUIRED' });
      const img = await failure(
        service.send(
          call({ authorization: a }),
          body({
            text: undefined,
            attachmentUrl: `https://cdn.test/webchat/${ws}/${site.connectionId}/018d0000-0000-7000-8000-0000000000bb.png`,
          }),
        ),
      );
      expect(img).toMatchObject({ status: 409, code: 'PHONE_REQUIRED' });
      expect(enqueue).toHaveBeenCalledTimes(2);
    });
    it('does not count a retried message twice, and a typed number lifts the block', async () => {
      const retry = body();
      const first = await service.send(call(), retry);
      const a = `Visitor ${first.visitorToken}`;
      enqueue.mockResolvedValueOnce(false);
      await service.send(call({ authorization: a }), retry);
      expect((await service.poll(call({ authorization: a }), undefined)).phoneRequired).toBe(false);
      await service.send(call({ authorization: a }), body());
      await expect(
        service.send(call({ authorization: a }), body({ text: 'số em 0912345679' })),
      ).resolves.toBeDefined();
    });
    it('stops asking once the phone is captured', async () => {
      const a = await auth();
      await service.send(call({ authorization: a }), body());
      await service.phone(call({ authorization: a }), { phone: '0912345679' });
      expect((await service.poll(call({ authorization: a }), undefined)).phoneRequired).toBe(false);
      await expect(service.send(call({ authorization: a }), body())).resolves.toBeDefined();
    });
  });
});

describe('WebchatService hardening (T-100 review)', () => {
  const dir = () => `https://cdn.test/webchat/${ws}/${site.connectionId}/`;
  const id = '018d0000-0000-7000-8000-0000000000bb';
  const attach = (url: string) =>
    service.send(call(), body({ text: undefined, attachmentUrl: url }));

  it.each([
    ['dot segments', () => `${dir()}../../${ws}/other-conn/${id}.png`],
    ['encoded dot segments', () => `${dir()}%2e%2e/%2e%2e/other/${id}.png`],
    [
      'another connection',
      () => `https://cdn.test/webchat/${ws}/018d0000-0000-7000-8000-0000000000cc/${id}.png`,
    ],
    ['a query string', () => `${dir()}${id}.png?x=1`],
    ['a fragment', () => `${dir()}${id}.png#x`],
    [
      'another host',
      () => `https://cdn.test.evil.test/webchat/${ws}/${site.connectionId}/${id}.png`,
    ],
    ['a wrong extension', () => `${dir()}${id}.svg`],
    ['credentials', () => `https://u:p@cdn.test/webchat/${ws}/${site.connectionId}/${id}.png`],
  ])('rejects an attachment url with %s', async (_n, url) => {
    expect((await failure(attach(url())))?.code).toBe('INVALID_ATTACHMENT');
  });
  it('accepts the exact upload url shape', async () => {
    await expect(attach(`${dir()}${id}.webp`)).resolves.toBeDefined();
  });

  it('namespaces the queue event id per visitor but keeps the widget id for the message', async () => {
    const shared = msgId();
    await service.send(call(), body({ clientMessageId: shared }));
    await service.send(call({ ip: '198.51.100.1' }), body({ clientMessageId: shared }));
    const [a, b] = enqueue.mock.calls.map((c) => c[1]);
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(a.externalMessageId).toBe(shared);
    expect(b.externalMessageId).toBe(shared);
  });

  it('returns the verified, trimmed token for an existing visitor', async () => {
    const first = await service.send(call(), body());
    const res = await service.send(
      call({ authorization: `Visitor   ${first.visitorToken}  ` }),
      body(),
    );
    expect(res.visitorToken).toBe(first.visitorToken);
  });

  it('caches site lookups briefly, misses included', async () => {
    const channels = (
      service as unknown as { channels: { resolveWebsite: ReturnType<typeof vi.fn> } }
    ).channels;
    await service.config(call());
    await service.config(call({ ip: '198.51.100.2' }));
    expect(channels.resolveWebsite).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    await service.config(call());
    expect(channels.resolveWebsite).toHaveBeenCalledTimes(2);
    resolved = null;
    vi.advanceTimersByTime(6000);
    await failure(service.config(call({ ip: '198.51.100.3' })));
    await failure(service.config(call({ ip: '198.51.100.4' })));
    expect(channels.resolveWebsite).toHaveBeenCalledTimes(3);
  });

  it('charges the address only for site lookups that miss the cache and answers 429 without querying', async () => {
    const channels = (
      service as unknown as { channels: { resolveWebsite: ReturnType<typeof vi.fn> } }
    ).channels;
    const random = (i: number) => `wk_${String(i).padStart(22, 'a')}`;
    for (let i = 0; i < 300; i++) await failure(service.send(call({ key: random(i) }), body()));
    expect(channels.resolveWebsite.mock.calls.length).toBe(300);
    for (const run of [
      (k: string) => service.send(call({ key: k }), body()),
      (k: string) => service.poll(call({ key: k }), undefined),
      (k: string) => service.upload(call({ key: k }), async () => Buffer.alloc(1)),
      (k: string) => service.phone(call({ key: k }), { phone: '0912345678' }),
      (k: string) => service.config(call({ key: k })),
      (k: string) => service.preflightAllowed(k, ORIGIN, '203.0.113.7'),
    ])
      expect((await failure(run(random(999))))?.status).toBe(429);
    expect(channels.resolveWebsite.mock.calls.length).toBe(300);
  });

  it('does not charge polls, config or preflight answered from the cache to the address gate', async () => {
    const channels = (
      service as unknown as { channels: { resolveWebsite: ReturnType<typeof vi.fn> } }
    ).channels;
    const a = `Visitor ${(await service.send(call(), body())).visitorToken}`;
    const b = `Visitor ${(await service.send(call(), body())).visitorToken}`;
    // 400 polls from one address in 10 minutes (two tabs, one poll per 3 s each is about 200 each).
    for (let i = 0; i < 200; i++) {
      await service.poll(call({ authorization: a }), undefined);
      await service.poll(call({ authorization: b }), undefined);
      if (i % 20 === 0) vi.advanceTimersByTime(1000);
    }
    for (let i = 0; i < 100; i++) {
      await service.config(call());
      await service.preflightAllowed(KEY, ORIGIN, '203.0.113.7');
    }
    expect(channels.resolveWebsite.mock.calls.length).toBeLessThan(10);
  });

  it('still limits one address per site on polls (2400 per 10 minutes)', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 9; i++)
      tokens.push(
        `Visitor ${(await service.send(call({ ip: `10.2.0.${i}` }), body())).visitorToken}`,
      );
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 2500; i++) {
      const authorization = tokens[i % 9] as string;
      const e = await failure(service.poll(call({ authorization }), undefined));
      if (!e) ok++;
      else if (e.status === 429) limited++;
    }
    expect(ok).toBe(2400);
    expect(limited).toBe(100);
  });
});
