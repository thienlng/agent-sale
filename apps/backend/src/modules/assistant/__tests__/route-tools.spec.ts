import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ROUTE_CATALOG, type RouteCatalog, searchCatalog } from '../application/route-catalog.js';
import {
  FORBIDDEN_MESSAGE,
  MAX_PENDING_PROPOSALS,
  MAX_PROPOSAL_BODY_CHARS,
  MAX_ROUTE_RESULT_CHARS,
  PROPOSAL_TTL_MS,
  routeTools,
  TRUNCATED,
  TURN_READ_BUDGET_CHARS,
} from '../application/route-tools.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const AUTH = 'Bearer owner-token';
const BUSINESS = workspaceId(newId());
const OTHER = workspaceId(newId());
const NOW = new Date('2026-11-02T03:00:00.000Z');
const PRODUCT = {
  code: 'AO-1',
  name: 'Áo thun',
  variants: [{ sku: 'AO-1-M', price: 150_000 }],
};

async function setup(
  respond: (i: RouteInvocation) => RouteInvocationResult = () => ({ status: 200, body: {} }),
  page?: { route: string },
  catalog: RouteCatalog = ROUTE_CATALOG,
) {
  const repo = new InMemoryAssistantRepository();
  const scope: OwnerScope = {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: BUSINESS,
    businessIds: [BUSINESS, OTHER],
  };
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: '',
    systemPrompt: 'p',
    promptVersion: 'assistant@2',
  });
  const invoke = vi.fn((i: RouteInvocation) => Promise.resolve(respond(i)));
  const proposalIds: string[] = [];
  const runId = newId();
  const [search, describeTool, call] = routeTools({
    scope,
    repo,
    invoker: { invoke },
    catalog,
    authorization: AUTH,
    threadId: thread.id,
    runId,
    proposalIds,
    now: () => NOW,
    ...(page ? { page } : {}),
  });
  const run = async (tool: typeof call, input: unknown) => {
    const parsed = tool!.schema.parse(input);
    const out = await tool!.run(parsed);
    return { ...out, json: JSON.parse(out.content.endsWith(TRUNCATED) ? '{}' : out.content) };
  };
  return {
    repo,
    scope,
    thread,
    invoke,
    proposalIds,
    runId,
    search: (input: unknown) => run(search, input),
    describe: (input: unknown) => run(describeTool, input),
    call: (input: unknown) => run(call, input),
  };
}

describe('route catalog', () => {
  const keys = ROUTE_CATALOG.entries.map((e) => e.key);

  it('holds only workspace routes marked read or write', () => {
    expect(keys).toContain('GET /products');
    expect(keys).toContain('POST /products');
    expect(keys).toContain('POST /analytics/query');
    // `never` routes, the assistant's own routes and routes without a ruling are not tools.
    expect(keys).not.toContain('PATCH /members/{userId}');
    expect(keys).not.toContain('POST /invitations');
    expect(keys).not.toContain('PATCH /channels/{id}/fanpage/settings');
    expect(keys).not.toContain('GET /channels/{id}/fanpage/posts');
    expect(keys.some((k) => k.includes(' /assistant'))).toBe(false);
    expect(keys.some((k) => k.includes(' /auth'))).toBe(false);
    expect(keys).not.toContain('GET /bootstrap');
    for (const e of ROUTE_CATALOG.entries) {
      if (e.use === 'read') expect(e.method === 'get' || e.queryPost === true).toBe(true);
      else expect(e.method).not.toBe('get');
    }
  });

  it('ranks by word overlap, unaccented, and boosts the current page section', () => {
    const top = searchCatalog(ROUTE_CATALOG, 'list products catalog').map((e) => e.key);
    expect(top[0]).toBe('GET /products');
    expect(top.length).toBeLessThanOrEqual(8);
    expect(searchCatalog(ROUTE_CATALOG, '   ')).toEqual([]);
    expect(searchCatalog(ROUTE_CATALOG, 'zzqx')).toEqual([]);
    // Accents and case do not matter.
    expect(searchCatalog(ROUTE_CATALOG, 'PRÓDUCTS').length).toBeGreaterThan(0);

    const plain = searchCatalog(ROUTE_CATALOG, 'change status').map((e) => e.key);
    const onOrders = searchCatalog(ROUTE_CATALOG, 'change status', '/app/orders/123').map(
      (e) => e.key,
    );
    expect(onOrders[0]?.split(' ')[1]?.startsWith('/orders')).toBe(true);
    expect(onOrders).not.toEqual(plain);
  });

  it('ranks a hotel’s own lodging routes first for a short reference (QA Villas #2)', () => {
    for (const query of ['A20', 'product A20', 'find villa with pool', 'list items']) {
      const top = searchCatalog(ROUTE_CATALOG, query, undefined, 'hotel')[0]?.key ?? '';
      expect(top, query).toMatch(/ \/lodging\//);
    }
    // A shop still gets its products first.
    expect(searchCatalog(ROUTE_CATALOG, 'product A20', undefined, 'retail')[0]?.key).toMatch(
      / \/product/,
    );
    // Without an industry nothing changes.
    expect(searchCatalog(ROUTE_CATALOG, 'A20')).toEqual([]);
  });

  it('finds the GET twin of a write on the same path', () => {
    const put = ROUTE_CATALOG.get('PUT /products/{productId}');
    expect(put && ROUTE_CATALOG.readerOf(put)?.key).toBe('GET /products/{productId}');
    const post = ROUTE_CATALOG.get('post /products');
    expect(post?.key).toBe('POST /products');
  });
});

describe('tool_search and tool_describe', () => {
  it('returns key, use, summary and when', async () => {
    const t = await setup();
    const out = await t.search({ query: 'products' });
    expect(out.json[0]).toEqual({
      key: expect.any(String) as unknown,
      use: expect.stringMatching(/^(read|write)$/) as unknown,
      summary: expect.any(String) as unknown,
      when: expect.any(String) as unknown,
    });
  });

  it('describes the inputs as JSON schema', async () => {
    const t = await setup();
    const out = await t.describe({ key: 'PUT /products/{productId}' });
    expect(out.json).toMatchObject({
      key: 'PUT /products/{productId}',
      use: 'write',
      pathParams: ['productId'],
      body: { type: 'object' },
    });
    expect(out.content.length).toBeLessThanOrEqual(MAX_ROUTE_RESULT_CHARS);
    expect((await t.describe({ key: 'GET /products' })).json.query).toMatchObject({
      type: 'object',
    });
    expect((await t.describe({ key: 'PATCH /members/{userId}' })).json).toEqual({
      ok: false,
      errorCode: 'unknown_key',
    });
  });
});

describe('tool_call', () => {
  it('refuses unknown keys, businesses, bad params and invalid input', async () => {
    const t = await setup();
    expect((await t.call({ key: 'POST /invitations' })).json.errorCode).toBe('unknown_key');
    expect(
      (await t.call({ key: 'GET /products', businessId: workspaceId(newId()) })).json.errorCode,
    ).toBe('unknown_business');
    expect((await t.call({ key: 'GET /products/{productId}' })).json).toEqual({
      ok: false,
      errorCode: 'bad_params',
      param: 'productId',
    });
    expect(
      (await t.call({ key: 'GET /products/{productId}', params: { productId: '../x' } })).json
        .errorCode,
    ).toBe('bad_params');
    const invalid = await t.call({ key: 'GET /products', query: { pageSize: 500 } });
    expect(invalid.ok).toBe(false);
    expect(invalid.json).toMatchObject({ errorCode: 'invalid_input' });
    expect(invalid.json.issues[0].path).toBe('pageSize');
    const badBody = await t.call({ key: 'POST /products', body: {}, summary: 'Thêm' });
    expect(badBody.json.errorCode).toBe('invalid_input');
    expect(badBody.json.issues.length).toBeLessThanOrEqual(5);
    expect(t.invoke).not.toHaveBeenCalled();
  });

  it('reads with the owner’s token in the chosen business', async () => {
    const t = await setup(() => ({ status: 200, body: { data: [{ name: 'Áo thun' }] } }));
    const out = await t.call({ key: 'GET /products', businessId: OTHER, query: { q: 'áo' } });
    expect(out.json).toEqual({ status: 200, body: { data: [{ name: 'Áo thun' }] } });
    expect(t.invoke).toHaveBeenCalledWith({
      method: 'get',
      path: '/products',
      query: { q: 'áo' },
      businessId: OTHER,
      authorization: AUTH,
    });
    // A query POST is read with its body.
    await t.call({ key: 'POST /contacts/query', body: {} });
    expect(t.invoke.mock.calls[1]?.[0]).toMatchObject({
      method: 'post',
      path: '/contacts/query',
      body: {},
      businessId: BUSINESS,
    });
  });

  it('answers HTTP errors with a code; a 403 says the owner may not', async () => {
    const t = await setup(() => ({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'Your role cannot do this' } },
    }));
    const out = await t.call({ key: 'GET /products' });
    expect(out.ok).toBe(false);
    expect(out.json).toEqual({
      ok: false,
      errorCode: 'http_403',
      message: FORBIDDEN_MESSAGE,
      error: { code: 'FORBIDDEN', message: 'Your role cannot do this' },
    });
  });

  it('truncates a read and stops at the turn budget', async () => {
    const big = 'x'.repeat(20_000);
    const t = await setup(() => ({ status: 200, body: { big } }));
    const first = await t.call({ key: 'GET /products' });
    expect(first.content.length).toBe(MAX_ROUTE_RESULT_CHARS);
    expect(first.content.endsWith(TRUNCATED)).toBe(true);
    let used = first.content.length;
    while (used < TURN_READ_BUDGET_CHARS) {
      used += (await t.call({ key: 'GET /products' })).content.length;
    }
    expect(used).toBe(TURN_READ_BUDGET_CHARS);
    const calls = t.invoke.mock.calls.length;
    expect((await t.call({ key: 'GET /products' })).json).toEqual({
      ok: false,
      errorCode: 'turn_budget_exhausted',
    });
    expect(t.invoke).toHaveBeenCalledTimes(calls);
  });

  it('turns a write into a pending proposal and never runs it', async () => {
    const t = await setup();
    expect((await t.call({ key: 'POST /products', body: PRODUCT })).json.errorCode).toBe(
      'summary_required',
    );
    const out = await t.call({
      key: 'POST /products',
      body: PRODUCT,
      summary: 'Thêm sản phẩm Áo thun giá 150.000đ',
    });
    expect(out.json).toEqual({
      status: 'awaiting_owner_approval',
      proposalId: expect.any(String) as unknown,
    });
    expect(t.invoke).not.toHaveBeenCalled();
    expect(t.proposalIds).toEqual([out.json.proposalId]);
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(stored).toMatchObject({
      status: 'pending',
      runId: t.runId,
      businessId: BUSINESS,
      routeKey: 'POST /products',
      path: '/products',
      body: PRODUCT,
      summary: 'Thêm sản phẩm Áo thun giá 150.000đ',
      preview: { body: PRODUCT, query: null },
    });
    expect(stored?.expiresAt.getTime()).toBe(NOW.getTime() + PROPOSAL_TTL_MS);
  });

  it('refuses a proposal body over the size cap', async () => {
    // A write whose body schema takes anything, so only the cap stops it.
    const entry = { ...ROUTE_CATALOG.get('POST /products')!, body: z.unknown() };
    const catalog: RouteCatalog = {
      ...ROUTE_CATALOG,
      get: (key) => (key === entry.key ? entry : ROUTE_CATALOG.get(key)),
    };
    const t = await setup(undefined, undefined, catalog);
    const big = { note: 'x'.repeat(MAX_PROPOSAL_BODY_CHARS) };
    const out = await t.call({ key: 'POST /products', body: big, summary: 'Thêm' });
    expect(out.json).toEqual({
      ok: false,
      errorCode: 'body_too_large',
      maxChars: MAX_PROPOSAL_BODY_CHARS,
    });
    expect(await t.repo.listProposals(t.scope, t.thread.id)).toEqual([]);
  });

  it('stops at the cap of pending proposals in a thread', async () => {
    const t = await setup();
    const propose = () => t.call({ key: 'POST /products', body: PRODUCT, summary: 'Thêm áo' });
    for (let i = 0; i < MAX_PENDING_PROPOSALS; i++) {
      expect((await propose()).json.status).toBe('awaiting_owner_approval');
    }
    expect((await propose()).json).toEqual({
      ok: false,
      errorCode: 'too_many_pending',
      max: MAX_PENDING_PROPOSALS,
    });
    // A decided one makes room again.
    const [first] = await t.repo.listProposals(t.scope, t.thread.id);
    await t.repo.transitionProposal(t.scope, first!.id, ['pending'], 'rejected', {
      decidedAt: NOW,
    });
    expect((await propose()).json.status).toBe('awaiting_owner_approval');
  });

  it('shows the current state next to the body of a whole replace', async () => {
    const id = newId();
    const before = { id, name: 'Áo cũ', variants: [{ sku: 'AO-1-M' }, { sku: 'AO-1-L' }] };
    const t = await setup((i) => ({ status: 200, body: i.method === 'get' ? before : null }));
    await t.call({
      key: 'PUT /products/{productId}',
      params: { productId: id },
      body: PRODUCT,
      summary: 'Đổi tên thành Áo thun, bỏ size L',
    });
    // Only the read of the current state ran.
    expect(t.invoke).toHaveBeenCalledTimes(1);
    expect(t.invoke).toHaveBeenCalledWith({
      method: 'get',
      path: `/products/${id}`,
      businessId: BUSINESS,
      authorization: AUTH,
    });
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(stored?.preview).toEqual({ body: PRODUCT, query: null, before });
    expect(stored?.path).toBe(`/products/${id}`);
  });
});

describe('customer contact data in reads (spec 2-R4)', () => {
  const ID = newId();

  it('redacts guest phones and e-mails from bookings, even when asked to list them', async () => {
    const t = await setup(() => ({
      status: 200,
      body: {
        data: [
          {
            code: 'BK-0001',
            guestName: 'Nam',
            guestPhone: '0901234567',
            guestEmail: 'nam@example.com',
            note: 'Khách dặn gọi 0912.345.678 trước khi tới',
            totalSell: 33_000_000,
          },
        ],
      },
    }));
    const out = await t.call({ key: 'GET /lodging/bookings' });
    expect(out.content).not.toContain('0901234567');
    expect(out.content).not.toContain('0912.345.678');
    expect(out.content).not.toContain('nam@example.com');
    expect(out.json.body.data[0]).toEqual({
      code: 'BK-0001',
      guestName: 'Nam',
      guestPhone: '[phone]',
      guestEmail: '[email]',
      note: 'Khách dặn gọi [phone] trước khi tới',
      totalSell: 33_000_000,
    });
  });

  it('redacts contact fields of a CRM contact and a contact query', async () => {
    const contact = {
      id: ID,
      name: 'Lan',
      phone: '+84 912 345 678',
      email: 'lan@shop.vn',
      address: { line1: '12 Lê Lợi', city: 'Hà Nội' },
      hasPhone: true,
      phones: ['0987654321'],
    };
    const t = await setup(() => ({ status: 200, body: contact }));
    const one = await t.call({ key: 'GET /contacts/{contactId}', params: { contactId: ID } });
    expect(one.json.body).toEqual({
      id: ID,
      name: 'Lan',
      phone: '[phone]',
      email: '[email]',
      address: '[address]',
      hasPhone: true,
      phones: '[phone]',
    });
    const many = await t.call({ key: 'POST /contacts/query', body: {} });
    expect(many.content).not.toMatch(/0912|0987|lan@shop|Lê Lợi/);
  });

  it('redacts the shipping address and phone of an order', async () => {
    const t = await setup(() => ({
      status: 200,
      body: {
        id: ID,
        code: 'DH-1',
        customer: { name: 'Hà', phone: '0355555555', shippingAddress: '5 Trần Phú, Đà Nẵng' },
        total: 340_000,
      },
    }));
    const out = await t.call({ key: 'GET /orders/{orderId}', params: { orderId: ID } });
    expect(out.json.body).toEqual({
      id: ID,
      code: 'DH-1',
      customer: { name: 'Hà', phone: '[phone]', shippingAddress: '[address]' },
      total: 340_000,
    });
  });

  it('keeps the shop’s own hotline and address in its bot profile', async () => {
    const profile = { id: ID, profile: { hotline: '0901234567', address: '1 Tam Đảo' } };
    const t = await setup(() => ({ status: 200, body: profile }));
    const out = await t.call({ key: 'GET /bots/{botId}', params: { botId: ID } });
    expect(out.json.body).toEqual(profile);
  });

  it('refuses a write drafted from redacted data', async () => {
    const t = await setup();
    const out = await t.call({
      key: 'POST /products',
      body: { ...PRODUCT, description: 'Gọi [phone] để đặt' },
      summary: 'Thêm áo',
    });
    expect(out.json).toEqual({ ok: false, errorCode: 'redacted_value_in_body' });
    expect(await t.repo.listProposals(t.scope, t.thread.id)).toEqual([]);
  });
});
