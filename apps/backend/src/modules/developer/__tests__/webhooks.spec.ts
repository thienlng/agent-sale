import { createHmac } from 'node:crypto';

import { userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import type { PublicOutboxRow } from '../application/ports/developer-store.js';
import type { PostResult, WebhookTransport } from '../application/ports/webhook-transport.js';
import { toPublicEnvelope } from '../application/public-events.js';
import { checkAddresses, checkUrlShape, isBlockedAddress } from '../application/url-guard.js';
import { WebhookDispatcher } from '../application/webhook-dispatcher.js';
import { MAX_ENDPOINTS, WebhookEndpointService } from '../application/webhook-endpoint.service.js';
import { WebhookSender } from '../application/webhook-sender.js';
import { eventIdOf, newSigningSecret, signatureHeader } from '../application/webhook-signing.js';
import { nextAttemptAt, RETRY_DELAYS_MS, shouldDisable } from '../domain/delivery-schedule.js';
import { HttpsWebhookTransport } from '../infrastructure/clients/https-webhook-transport.js';
import { InMemoryDeveloperStore } from '../infrastructure/persistence/developer.in-memory-store.js';

const WS = workspaceId('0190b000-0000-7000-8000-000000000001');
const OTHER_WS = workspaceId('0190b000-0000-7000-8000-000000000002');
const OWNER = userId('0190b000-0000-7000-8000-0000000000aa');
const CONTACT = '0190b000-0000-7000-8000-0000000000c1';

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'fd00:ec2::254',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it.each([
    ['http://example.com/hook', 'https_required'],
    ['https://user:pw@example.com/hook', 'credentials_not_allowed'],
    ['https://example.com:22/hook', 'port_not_allowed'],
    ['https://localhost/hook', 'private_address'],
    ['https://printer.local/hook', 'private_address'],
    ['https://db.internal/hook', 'private_address'],
    ['https://10.0.0.5/hook', 'private_address'],
    ['https://[::1]/hook', 'private_address'],
    ['nope', 'invalid_url'],
    ['https://example.com/hook', null],
    ['https://example.com:8443/hook', null],
  ])('%s → %s', (url, reason) => {
    expect(checkUrlShape(url)).toBe(reason);
  });

  it('needs every resolved address to be public', () => {
    expect(checkAddresses([])).toBe('unresolvable_host');
    expect(checkAddresses(['8.8.8.8', '10.0.0.1'])).toBe('private_address');
    expect(checkAddresses(['8.8.8.8'])).toBeNull();
  });

  it('checks resolved addresses before saving and before sending', async () => {
    const transport = new HttpsWebhookTransport(() => Promise.resolve(['10.0.0.7']));
    expect(await transport.check('https://rebind.example.com/hook')).toBe('private_address');
    expect(await transport.post('https://rebind.example.com/hook', {}, '{}')).toEqual({
      ok: false,
      status: null,
      error: 'private_address',
    });
    const failing = new HttpsWebhookTransport(() => Promise.reject(new Error('ENOTFOUND')));
    expect(await failing.check('https://nowhere.example.com/hook')).toBe('unresolvable_host');
  });
});

describe('signing', () => {
  it('signs "<t>.<body>" with every active secret', () => {
    const a = newSigningSecret();
    const b = newSigningSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const header = signatureHeader([a, b], 1_700_000_000, '{"x":1}');
    const hmac = (s: string) => createHmac('sha256', s).update('1700000000.{"x":1}').digest('hex');
    expect(header).toBe(`t=1700000000,v1=${hmac(a)},v1=${hmac(b)}`);
  });

  it('derives a stable UUID per outbox row', () => {
    expect(eventIdOf(42)).toBe(eventIdOf(42));
    expect(eventIdOf(42)).not.toBe(eventIdOf(43));
    expect(eventIdOf(42)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('public events', () => {
  const row = (over: Partial<PublicOutboxRow> = {}): PublicOutboxRow => ({
    id: 7,
    workspaceId: WS,
    type: 'crm.contact.updated.v1',
    payload: { contactId: CONTACT, actorUserId: null, fields: ['name'], internalFlag: true },
    createdAt: new Date('2030-01-01T00:00:00Z'),
    ...over,
  });

  it('maps an internal event to its public envelope, dropping unlisted fields', () => {
    expect(toPublicEnvelope(row())).toEqual({
      id: eventIdOf(7),
      type: 'crm.contact.updated',
      workspaceId: WS,
      occurredAt: '2030-01-01T00:00:00.000Z',
      data: { contactId: CONTACT, actorUserId: null, fields: ['name'] },
    });
  });

  it('skips internal-only types and payloads that do not match the public schema', () => {
    expect(toPublicEnvelope(row({ type: 'crm.contact.merged.v1' }))).toBeNull();
    expect(toPublicEnvelope(row({ payload: { contactId: 'x' } }))).toBeNull();
  });
});

describe('delivery schedule', () => {
  it('retries after 1m, 5m, 30m, 2h, 6h, 12h, 24h, then gives up', () => {
    const now = new Date(0);
    expect(RETRY_DELAYS_MS.map((_, i) => nextAttemptAt(i + 1, now)?.getTime())).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000,
    ]);
    expect(nextAttemptAt(8, now)).toBeNull();
  });

  it('disables after 3 days of failures', () => {
    const since = new Date(0);
    expect(shouldDisable(null, new Date(10 * 86_400_000))).toBe(false);
    expect(shouldDisable(since, new Date(3 * 86_400_000 - 1))).toBe(false);
    expect(shouldDisable(since, new Date(3 * 86_400_000))).toBe(true);
  });
});

// ─── Endpoints, dispatcher and sender over the in-memory store ───────────────

class FakeTransport implements WebhookTransport {
  readonly sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  reply: PostResult = { ok: true, status: 200 };
  check(url: string) {
    return Promise.resolve(checkUrlShape(url));
  }
  post(url: string, headers: Record<string, string>, body: string) {
    this.sent.push({ url, headers, body });
    return Promise.resolve(this.reply);
  }
}

function setup(entitled = true) {
  const store = new InMemoryDeveloperStore();
  const transport = new FakeTransport();
  const box = SecretBox.insecureDevelopmentBox();
  const plan = { enabled: () => Promise.resolve(entitled) };
  const service = new WebhookEndpointService(store, transport, plan, box);
  const dispatcher = new WebhookDispatcher(store, plan);
  const sender = new WebhookSender(store, transport, box);
  return { store, transport, service, dispatcher, sender };
}

const contactUpdated = (id: number, ws = WS): PublicOutboxRow => ({
  id,
  workspaceId: ws,
  type: 'crm.contact.updated.v1',
  payload: { contactId: CONTACT, actorUserId: null, fields: ['name'] },
  createdAt: new Date('2030-01-01T00:00:00Z'),
});

const verify = (secret: string, header: string, body: string) => {
  const [t, ...sigs] = header.split(',');
  const ts = (t ?? '').slice(2);
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return sigs.includes(`v1=${expected}`);
};

describe('WebhookEndpointService', () => {
  it('creates an endpoint with a sealed secret shown once', async () => {
    const { service, store } = setup();
    const { endpoint, secret } = await service.create(WS, OWNER, {
      url: 'https://hooks.example.com/rapiz',
      description: '',
      events: ['crm.contact.updated', 'crm.contact.updated'],
    });
    expect(secret).toMatch(/^whsec_/);
    expect(endpoint).toMatchObject({ enabled: true, version: 1, events: ['crm.contact.updated'] });
    const stored = store.endpoints.get(endpoint.id);
    expect(stored?.secretEncrypted).not.toContain(secret);
    expect(JSON.stringify(await service.list(WS))).not.toContain(secret);
  });

  it('refuses private URLs, missing plans and too many endpoints', async () => {
    const { service } = setup();
    const req = {
      url: 'https://10.0.0.1/hook',
      description: '',
      events: ['crm.tag.assigned' as const],
    };
    await expect(service.create(WS, OWNER, req)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'private_address' },
    });
    await expect(
      setup(false).service.create(WS, OWNER, { ...req, url: 'https://ok.example.com' }),
    ).rejects.toMatchObject({ code: 'FEATURE_LOCKED' });
    for (let i = 0; i < MAX_ENDPOINTS; i++)
      await service.create(WS, OWNER, { ...req, url: `https://ok${i}.example.com` });
    await expect(
      service.create(WS, OWNER, { ...req, url: 'https://one-more.example.com' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('updates with the version, and keeps workspaces apart', async () => {
    const { service } = setup();
    const { endpoint } = await service.create(WS, OWNER, {
      url: 'https://hooks.example.com/a',
      description: '',
      events: ['crm.tag.assigned'],
    });
    const next = await service.update(WS, endpoint.id, { version: 1, enabled: false });
    expect(next).toMatchObject({ enabled: false, disabledReason: 'manual', version: 2 });
    await expect(
      service.update(WS, endpoint.id, { version: 1, description: 'x' }),
    ).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    await expect(service.update(OTHER_WS, endpoint.id, { version: 2 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.remove(WS, 'not-a-uuid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.remove(WS, endpoint.id);
    expect(await service.list(WS)).toEqual([]);
  });
});

describe('dispatch and send', () => {
  async function withEndpoint(
    s: ReturnType<typeof setup>,
    events = ['crm.contact.updated' as const],
  ) {
    return s.service.create(WS, OWNER, {
      url: 'https://hooks.example.com/rapiz',
      description: '',
      events,
    });
  }

  it('delivers subscribed public events once, signed, with a stable event id', async () => {
    const s = setup();
    const { endpoint, secret } = await withEndpoint(s);
    s.store.outbox.push(
      contactUpdated(1),
      contactUpdated(2, OTHER_WS),
      { ...contactUpdated(3), type: 'crm.tag.assigned.v1' },
      { ...contactUpdated(4), type: 'conversation.message.created.v1' },
    );
    expect(await s.dispatcher.dispatch()).toBe(1);
    expect(await s.dispatcher.dispatch()).toBe(0);
    expect(await s.sender.send()).toBe(1);
    const [sent] = s.transport.sent;
    expect(sent?.url).toBe('https://hooks.example.com/rapiz');
    expect(sent?.headers['rapiz-event-id']).toBe(eventIdOf(1));
    expect(sent?.headers['rapiz-event-type']).toBe('crm.contact.updated');
    expect(verify(secret, sent?.headers['rapiz-signature'] ?? '', sent?.body ?? '')).toBe(true);
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({ id: eventIdOf(1), workspaceId: WS });
    const page = await s.service.deliveries(WS, endpoint.id, { limit: 50 });
    expect(page.data[0]).toMatchObject({ status: 'succeeded', attempts: 1, lastStatusCode: 200 });
    expect(await s.sender.send()).toBe(0);
  });

  it('does not dispatch for workspaces without the plan', async () => {
    const s = setup();
    await withEndpoint(s);
    const locked = new WebhookDispatcher(s.store, { enabled: () => Promise.resolve(false) });
    s.store.outbox.push(contactUpdated(1));
    expect(await locked.dispatch()).toBe(0);
  });

  it('signs with both secrets for 24 h after a rotation', async () => {
    const s = setup();
    const { endpoint, secret: old } = await withEndpoint(s);
    const t0 = new Date();
    const { secret } = await s.service.rotateSecret(WS, endpoint.id, t0);
    await s.service.sendTest(WS, endpoint.id, t0);
    await s.sender.send(t0);
    const header = s.transport.sent[0]?.headers['rapiz-signature'] ?? '';
    const body = s.transport.sent[0]?.body ?? '';
    expect(header.match(/v1=/g)).toHaveLength(2);
    expect(verify(old, header, body) && verify(secret, header, body)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({ type: 'webhook.test' });

    const later = new Date(t0.getTime() + 25 * 3_600_000);
    await s.service.sendTest(WS, endpoint.id, later);
    await s.sender.send(later);
    const late = s.transport.sent[1]?.headers['rapiz-signature'] ?? '';
    expect(late.match(/v1=/g)).toHaveLength(1);
    expect(verify(secret, late, s.transport.sent[1]?.body ?? '')).toBe(true);
  });

  it('retries with backoff, fails after the last retry, and resends with the same event id', async () => {
    const s = setup();
    const { endpoint } = await withEndpoint(s);
    s.transport.reply = { ok: false, status: 500, error: 'HTTP 500' };
    const t0 = new Date('2030-01-01T00:00:00Z');
    s.store.outbox.push(contactUpdated(1));
    await s.dispatcher.dispatch(t0);
    let at = t0;
    for (const delay of [0, ...RETRY_DELAYS_MS]) {
      // + 1 s: the sender schedules from its clock, which also moves by the real time spent.
      at = new Date(at.getTime() + delay + 1000);
      expect(await s.sender.send(at)).toBe(1);
      // Re-enable so the 3-day disable does not stop the schedule under test.
      const ep = s.store.endpoints.get(endpoint.id);
      if (ep) Object.assign(ep, { enabled: true, failingSince: null });
    }
    const [d] = (await s.service.deliveries(WS, endpoint.id, { limit: 50 })).data;
    expect(d).toMatchObject({
      status: 'failed',
      attempts: 8,
      nextAttemptAt: null,
      lastStatusCode: 500,
    });
    s.transport.reply = { ok: true, status: 204 };
    const again = await s.service.resend(WS, d?.id ?? '', at);
    expect(again).toMatchObject({ status: 'pending', attempts: 0 });
    await s.sender.send(at);
    expect(s.transport.sent.at(-1)?.headers['rapiz-event-id']).toBe(eventIdOf(1));
    expect(
      (await s.service.deliveries(WS, endpoint.id, { limit: 50, status: 'succeeded' })).data,
    ).toHaveLength(1);
  });

  it('disables an endpoint failing for 3 days, and re-enabling starts over', async () => {
    const s = setup();
    const { endpoint } = await withEndpoint(s);
    s.transport.reply = { ok: false, status: null, error: 'timeout' };
    const t0 = new Date('2030-01-01T00:00:00Z');
    await s.service.sendTest(WS, endpoint.id, t0);
    await s.sender.send(t0);
    // The sender's clock moves by the real time spent (a few ms at most).
    const since = s.store.endpoints.get(endpoint.id)?.failingSince?.getTime() ?? 0;
    expect(since - t0.getTime()).toBeGreaterThanOrEqual(0);
    expect(since - t0.getTime()).toBeLessThan(1000);
    const t3 = new Date(t0.getTime() + 3 * 86_400_000 + 1000);
    await s.service.sendTest(WS, endpoint.id, t3);
    await s.sender.send(t3);
    const [disabled] = await s.service.list(WS);
    expect(disabled).toMatchObject({ enabled: false, disabledReason: 'failing' });
    await s.service.sendTest(WS, endpoint.id, t3);
    expect(await s.sender.send(t3)).toBe(0);
    const back = await s.service.update(WS, endpoint.id, {
      version: disabled?.version ?? 0,
      enabled: true,
    });
    expect(back).toMatchObject({ enabled: true, disabledReason: null, failingSince: null });
  });
});
