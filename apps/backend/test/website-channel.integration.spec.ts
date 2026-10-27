import { ChannelConnectionDto, ChannelListResponse } from '@agent-sales/contracts';
import { schema, eq } from '@agent-sales/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CHANNEL_FACADE, type ChannelFacade } from '../src/modules/channel/api/index.js';
import { startHarness, type Harness, type TestUser } from './support/harness.js';

/** Website connections over HTTP on a real Postgres: create, configure, disable, isolation, signing. */
let hx: Harness;
let facade: ChannelFacade;
let owner: TestUser;
let stranger: TestUser;

beforeAll(async () => {
  hx = await startHarness();
  facade = hx.app.get<ChannelFacade>(CHANNEL_FACADE, { strict: false });
  owner = await hx.user('web-owner@shop.vn', 'Chủ shop');
  stranger = await hx.user('web-stranger@shop.vn', 'Người lạ');
});
afterAll(async () => {
  await hx?.stop();
});

async function create(domains = ['shop.vn']) {
  const res = await hx.call(owner.h, 'POST', '/channels/website', { name: 'Shop site', domains });
  expect(res.statusCode).toBe(201);
  return ChannelConnectionDto.parse(res.json());
}

describe('website channel connections', () => {
  it('creates a website connection with a site key and default settings', async () => {
    const site = await create(['Shop.VN']);
    expect(site.provider).toBe('website');
    expect(site.externalId).toMatch(/^wk_[0-9A-Za-z]{22}$/);
    expect(site.status).toBe('connected');
    expect(site.settings).toMatchObject({
      domains: ['shop.vn'],
      color: '#F97316',
      position: 'right',
    });
    expect(JSON.stringify(site)).not.toContain('tokenSealed');
  });

  it('merges settings patches without resetting untouched fields', async () => {
    const site = await create();
    const first = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, {
      color: '#112233',
      greeting: 'Xin chào',
    });
    expect(first.statusCode).toBe(200);
    const second = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, {
      position: 'left',
      name: 'Renamed',
    });
    const dto = ChannelConnectionDto.parse(second.json());
    expect(dto.name).toBe('Renamed');
    expect(dto.settings).toMatchObject({
      color: '#112233',
      greeting: 'Xin chào',
      position: 'left',
    });
  });

  it('rejects invalid domains and settings', async () => {
    const site = await create();
    const bad = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, {
      domains: ['https://x.vn'],
    });
    expect(bad.statusCode).toBe(400);
    const none = await hx.call(owner.h, 'POST', '/channels/website', { name: 'x', domains: [] });
    expect(none.statusCode).toBe(400);
  });

  it('rejects unknown fields such as a nested settings object with 400', async () => {
    const site = await create();
    const res = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, {
      settings: { color: '#000000' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('disables and re-enables a site', async () => {
    const site = await create();
    const off = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, { enabled: false });
    expect(ChannelConnectionDto.parse(off.json()).status).toBe('disabled');
    const on = await hx.call(owner.h, 'PATCH', `/channels/${site.id}/website`, { enabled: true });
    expect(ChannelConnectionDto.parse(on.json()).status).toBe('connected');
  });

  it('lists website connections next to Meta pages', async () => {
    const site = await create();
    const list = ChannelListResponse.parse((await hx.call(owner.h, 'GET', '/channels')).json());
    expect(list.data.some((c) => c.id === site.id && c.provider === 'website')).toBe(true);
  });

  it('hides a site from another workspace', async () => {
    const site = await create();
    const patch = await hx.call(stranger.h, 'PATCH', `/channels/${site.id}/website`, {
      color: '#000000',
    });
    expect(patch.statusCode).toBe(404);
    const list = ChannelListResponse.parse((await hx.call(stranger.h, 'GET', '/channels')).json());
    expect(list.data.some((c) => c.id === site.id)).toBe(false);
  });

  it('refuses the website route for a Meta page', async () => {
    const id = crypto.randomUUID();
    await hx.owner.db.insert(schema.channelConnections).values({
      id,
      workspaceId: owner.ownWorkspace,
      provider: 'facebook',
      externalId: `page-${id}`,
      name: 'Page',
      tokenSealed: 'sealed',
    });
    const res = await hx.call(owner.h, 'PATCH', `/channels/${id}/website`, { color: '#000000' });
    expect(res.statusCode).toBe(404);
  });

  it('resolves a site by key and signs visitor tokens bound to that site', async () => {
    const a = await create();
    const b = await create();
    const siteA = await facade.resolveWebsite(a.externalId);
    const siteB = await facade.resolveWebsite(b.externalId);
    expect(siteA).toMatchObject({ connectionId: a.id, status: 'connected', siteKey: a.externalId });
    expect(await facade.resolveWebsite('wk_unknownunknownunknown00')).toBeNull();
    if (!siteA || !siteB) throw new Error('sites missing');
    const visitor = crypto.randomUUID();
    const token = await facade.signVisitorToken(siteA, visitor);
    expect(await facade.verifyVisitorToken(siteA, token)).toBe(visitor);
    expect(await facade.verifyVisitorToken(siteB, token)).toBeNull();
    expect(await facade.verifyVisitorToken(siteA, 'garbage')).toBeNull();
  });

  it('enqueues website events once and reports pending messages', async () => {
    const created = await create();
    const site = await facade.resolveWebsite(created.externalId);
    if (!site) throw new Error('site missing');
    const visitor = crypto.randomUUID();
    const event = {
      kind: 'website' as const,
      assetExternalId: site.siteKey,
      externalEventId: 'evt-1',
      type: 'message' as const,
      senderExternalId: visitor,
      occurredAt: new Date(),
      text: 'Xin chào',
      raw: null,
    };
    expect(await facade.hasPendingCustomerEvent(site.connectionId, visitor)).toBe(false);
    expect(await facade.enqueueWebsiteEvent(site, event)).toBe(true);
    expect(await facade.enqueueWebsiteEvent(site, event)).toBe(false);
    expect(await facade.hasPendingCustomerEvent(site.connectionId, visitor)).toBe(true);
    const rows = await hx.owner.db
      .select()
      .from(schema.channelWebhookEvents)
      .where(eq(schema.channelWebhookEvents.connectionId, site.connectionId));
    expect(rows).toHaveLength(1);
  });
});
