import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import { BUDGET_EXHAUSTED_GUIDANCE } from '../application/turn-budget.js';
import { z } from 'zod';

import {
  type CatalogEntry,
  ROUTE_CATALOG,
  type RouteCatalog,
  searchCatalog,
} from '../application/route-catalog.js';
import {
  FORBIDDEN_MESSAGE,
  LIST_DESCRIPTION_CUT,
  MAX_PENDING_PROPOSALS,
  MAX_PROPOSAL_BODY_CHARS,
  MAX_ROUTE_RESULT_CHARS,
  PROPOSAL_TTL_MS,
  routeTools,
  TRUNCATED,
  TURN_READ_BUDGET_CHARS,
} from '../application/route-tools.js';
import { type NativeToolEntry, sqlTools } from '../application/sql/sql-tools.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';
import { FakeSqlRunner } from './factories/fake-sql-runner.js';

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
  native?: (scope: OwnerScope) => readonly NativeToolEntry[],
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
    ...(native ? { native: native(scope) } : {}),
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

  it('ranks the bot turn traces first for "why did the bot answer" on the inbox and bot pages', () => {
    const query = 'why did the bot answer like that';
    for (const page of ['/app/inbox', '/app/inbox/c1', '/app/bots/b1/playground']) {
      expect(searchCatalog(ROUTE_CATALOG, query, page)[0]?.key).toBe('GET /bots/{botId}/turns');
    }
    // The inbox also boosts the conversation routes it shows.
    const onInbox = searchCatalog(ROUTE_CATALOG, 'conversation messages', '/app/inbox');
    expect(onInbox.slice(0, 3).map((e) => e.key)).toContain('GET /conversations/{id}');
  });

  it('ranks a hotel’s own lodging routes first for a short reference (QA Villas #2)', () => {
    for (const query of ['A20', 'product A20', 'find villa with pool', 'list items']) {
      const top = searchCatalog(ROUTE_CATALOG, query, undefined, [], 'hotel')[0]?.key ?? '';
      expect(top, query).toMatch(/ \/lodging\//);
    }
    // A shop still gets its products first.
    expect(searchCatalog(ROUTE_CATALOG, 'product A20', undefined, [], 'retail')[0]?.key).toMatch(
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

describe('bot API action drafts (narrowed body)', () => {
  const BOT = newId();
  const DRAFT = {
    name: 'Tra cứu đơn',
    description: 'Gọi khi khách hỏi tình trạng đơn và đã cho mã đơn.',
    url: 'https://shop.example.com/api/orders/{code}',
    method: 'GET',
    params: [
      { name: 'code', type: 'string', location: 'path', required: true, description: 'Mã đơn' },
    ],
    responses: [
      {
        statusCode: 200,
        fields: [{ name: 'data.status', type: 'string', description: 'Tình trạng' }],
      },
    ],
    auth: { kind: 'bearer' },
    requiresConfirm: false,
    enabled: false,
  };
  const draft = (body: unknown) => ({
    key: 'POST /bots/{botId}/actions',
    params: { botId: BOT },
    body,
    summary: 'Thêm API tra cứu đơn',
  });

  it('describes the draft schema: no authSecret, enabled false', async () => {
    const t = await setup();
    const body = (await t.describe({ key: 'POST /bots/{botId}/actions' })).json.body as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(body.properties)).not.toContain('authSecret');
    expect(body.properties.enabled).toMatchObject({ const: false });
  });

  it('refuses a draft with a secret or enabled, and creates no proposal', async () => {
    const t = await setup();
    for (const body of [
      { ...DRAFT, authSecret: 'sk-live-0123456789abcdef' },
      { ...DRAFT, enabled: true },
    ]) {
      const out = await t.call(draft(body));
      expect(out.json.errorCode).toBe('invalid_input');
    }
    expect(await t.repo.listProposals(t.scope, t.thread.id)).toEqual([]);
    expect(t.invoke).not.toHaveBeenCalled();
  });

  it('refuses a nested secret (auth.token, an unknown param key) and never stores it', async () => {
    const t = await setup();
    for (const body of [
      { ...DRAFT, auth: { kind: 'bearer', token: 'sk-live-0123456789abcdef' } },
      { ...DRAFT, params: [{ ...DRAFT.params[0], value: 'sk-live-0123456789abcdef' }] },
    ]) {
      const out = await t.call(draft(body));
      expect(out.json.errorCode).toBe('invalid_input');
    }
    expect(await t.repo.listProposals(t.scope, t.thread.id)).toEqual([]);
    expect(t.invoke).not.toHaveBeenCalled();
  });

  it('refuses secret-looking URL query keys and header params with secret_in_draft', async () => {
    const t = await setup();
    const header = (name: string) => ({
      ...DRAFT,
      params: [
        ...DRAFT.params,
        { name, type: 'string', location: 'header', required: true, description: 'x' },
      ],
    });
    for (const body of [
      { ...DRAFT, url: `${DRAFT.url}?api_key=abc123` },
      { ...DRAFT, url: `${DRAFT.url}?token=abc123` },
      { ...DRAFT, url: `${DRAFT.url}?sig=abc` },
      header('X-Access-Token'),
      header('X-Shop-Secret'),
      header('Authorization-Ext'),
      header('X-Password'),
    ]) {
      const out = await t.call(draft(body));
      expect(out.json.errorCode).toBe('secret_in_draft');
    }
    expect(await t.repo.listProposals(t.scope, t.thread.id)).toEqual([]);
    // A plain query key and header param are fine.
    const ok = await t.call(
      draft({
        ...header('X-Shop-Id'),
        url: `${DRAFT.url}?lang=vi`,
      }),
    );
    expect(ok.json).toMatchObject({ status: 'awaiting_owner_approval' });
  });

  it('turns a valid draft into a pending proposal that previews the body as is', async () => {
    const t = await setup();
    const out = await t.call(draft(DRAFT));
    expect(out.json.status).toBe('awaiting_owner_approval');
    const [p] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(p).toMatchObject({
      routeKey: 'POST /bots/{botId}/actions',
      path: `/bots/${BOT}/actions`,
      status: 'pending',
      body: DRAFT,
      preview: { body: DRAFT, query: null },
      resultId: null,
    });
    // A POST reads no current state first.
    expect(t.invoke).not.toHaveBeenCalled();
  });

  it('keeps editing, deleting and testing actions out of the catalog', () => {
    const keys = ROUTE_CATALOG.entries.map((e) => e.key);
    expect(keys).toContain('POST /bots/{botId}/actions');
    expect(keys).not.toContain('PATCH /bots/{botId}/actions/{actionId}');
    expect(keys).not.toContain('DELETE /bots/{botId}/actions/{actionId}');
    expect(keys).not.toContain('POST /bots/{botId}/actions/test');
    expect(keys).not.toContain('POST /bots/{botId}/actions/{actionId}/test');
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

  it('gives the model the first validation issues of a 400, capped', async () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({
      path: `items.${i}.price`,
      message: 'Expected number',
    }));
    const t = await setup(() => ({
      status: 400,
      body: {
        error: { code: 'VALIDATION_FAILED', message: 'Invalid body', details: { issues } },
      },
    }));
    const out = await t.call({ key: 'GET /products' });
    expect(out.json).toEqual({
      ok: false,
      errorCode: 'http_400',
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid body',
        issues: issues.slice(0, 5),
      },
    });
    expect(JSON.stringify((out.json as { error: unknown }).error).length).toBeLessThanOrEqual(600);
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
      guidance: BUDGET_EXHAUSTED_GUIDANCE,
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

  it('cuts long product descriptions in a list read, never in a read by id (NEW-3)', async () => {
    const long = 'Gỗ thông tự nhiên. '.repeat(40);
    const product = {
      id: newId(),
      name: 'Xương rồng gỗ',
      description: long,
      variants: [{ price: 460_000 }],
    };
    const t = await setup((i) =>
      i.path === '/products'
        ? { status: 200, body: { data: [product], total: 1 } }
        : { status: 200, body: product },
    );
    const list = await t.call({ key: 'GET /products', query: { q: 'xương rồng' } });
    const row = (list.json.body as { data: { description: string; variants: unknown }[] }).data[0]!;
    expect(row.description).toBe(long.slice(0, 200) + LIST_DESCRIPTION_CUT);
    expect(row.variants).toEqual([{ price: 460_000 }]);
    const one = await t.call({
      key: 'GET /products/{productId}',
      params: { productId: product.id },
    });
    expect((one.json.body as { description: string }).description).toBe(long);
  });

  it('names the property of every availability option (AS3-3)', async () => {
    const villa = newId();
    const t = await setup((i) =>
      i.path === '/lodging/properties'
        ? { status: 200, body: { data: [{ id: villa, name: 'Villa D33', code: 'D33' }] } }
        : { status: 200, body: { options: [{ propertyId: villa, fits: true }] } },
    );
    const out = await t.call({
      key: 'POST /lodging/availability',
      body: { checkIn: '2026-11-14', checkOut: '2026-11-15', party: { adults: 2, childAges: [] } },
    });
    expect(out.json.body).toEqual({
      count: 1,
      options: [{ propertyName: 'Villa D33', propertyCode: 'D33', propertyId: villa, fits: true }],
    });
  });

  it('accepts a concrete path for a templated key (AS-14)', async () => {
    const t = await setup(() => ({ status: 200, body: { items: [] } }));
    const bot = newId();
    const out = await t.call({ key: `GET /bots/${bot}/turns`, query: { q: 'gia' } });
    expect(out.json).toEqual({ status: 200, body: { items: [] } });
    expect(t.invoke.mock.calls[0]?.[0]).toMatchObject({
      method: 'get',
      path: `/bots/${bot}/turns`,
    });
    expect((await t.describe({ key: `GET /bots/${bot}/turns` })).json).toMatchObject({
      key: 'GET /bots/{botId}/turns',
    });
    expect((await t.call({ key: 'GET /nowhere/1' })).json.errorCode).toBe('unknown_key');
  });

  it('turns the local instants the model writes back into UTC (AS-3)', async () => {
    const write: CatalogEntry = {
      key: 'POST /holds',
      use: 'write',
      summary: 'Extend a hold',
      when: 'extend a hold',
      method: 'post',
      path: '/holds',
      pathParams: [],
      body: z.object({ holdExpiresAt: z.iso.datetime() }),
    };
    const read: CatalogEntry = {
      key: 'GET /holds',
      use: 'read',
      summary: 'Holds',
      when: 'list holds',
      method: 'get',
      path: '/holds',
      pathParams: [],
      query: z.object({ from: z.iso.datetime().optional() }),
    };
    const catalog: RouteCatalog = {
      ...ROUTE_CATALOG,
      entries: [write, read],
      get: (key) => [write, read].find((e) => e.key === key),
      readerOf: () => undefined,
    };
    const t = await setup(undefined, undefined, catalog);
    await t.call({
      key: 'POST /holds',
      body: { holdExpiresAt: '2026-11-13T03:05:39+07:00' },
      summary: 'Gia hạn giữ chỗ',
    });
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(stored?.body).toEqual({ holdExpiresAt: '2026-11-12T20:05:39.000Z' });
    await t.call({ key: 'GET /holds', query: { from: '2026-11-16T00:00:00+07:00' } });
    expect(t.invoke.mock.calls[0]?.[0].query).toEqual({ from: '2026-11-15T17:00:00.000Z' });
  });

  it('stores the parsed body of every write: unknown keys never reach the proposal', async () => {
    const t = await setup();
    await t.call({
      key: 'POST /products',
      body: { ...PRODUCT, apiToken: 'sk-live-0123456789abcdef' },
      summary: 'Thêm sản phẩm Áo thun',
    });
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(JSON.stringify(stored?.body)).not.toContain('apiToken');
    expect(JSON.stringify(stored?.preview)).not.toContain('sk-live');
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
    // The preview shows the parsed body (defaults applied), the one the approval will run.
    expect(stored?.preview).toMatchObject({ body: PRODUCT, query: null, before });
    expect(stored?.preview).toEqual({ body: stored?.body, query: null, before });
    expect(stored?.path).toBe(`/products/${id}`);
  });
});

describe('the current state of an item without its own GET (QA M-4)', () => {
  const PROPERTY = newId();
  const RATE = newId();
  const KEY = 'PATCH /lodging/properties/{id}/overrides/{rateId}';

  it('reads a date-range price from its property, matched by its id', async () => {
    const rate = { id: RATE, kind: 'override', sell: 15_000_000, version: 1 };
    const property = { id: PROPERTY, name: 'A20', rates: [{ id: newId(), sell: 1 }, rate] };
    const t = await setup((i) => ({ status: 200, body: i.method === 'get' ? property : null }));
    await t.call({
      key: KEY,
      params: { id: PROPERTY, rateId: RATE },
      body: { sell: 17_000_000, version: 1 },
      summary: 'Đổi giá Noel',
    });
    expect(t.invoke).toHaveBeenCalledWith({
      method: 'get',
      path: `/lodging/properties/${PROPERTY}`,
      businessId: BUSINESS,
      authorization: AUTH,
    });
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(stored?.preview).toMatchObject({ before: rate });
    expect(stored?.preview).not.toHaveProperty('beforeUnavailable');
  });

  it('marks the old value unreadable when the parent does not hold the item', async () => {
    const t = await setup((i) => ({
      status: 200,
      body: i.method === 'get' ? { id: PROPERTY, rates: [{ id: newId() }] } : null,
    }));
    await t.call({
      key: KEY,
      params: { id: PROPERTY, rateId: RATE },
      body: { sell: 17_000_000, version: 1 },
      summary: 'Đổi giá Noel',
    });
    const [stored] = await t.repo.listProposals(t.scope, t.thread.id);
    expect(stored?.preview).toMatchObject({ beforeUnavailable: true });
    expect(stored?.preview).not.toHaveProperty('before');
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

describe('native entries (sql_schema, sql_query)', () => {
  const withSql = (runner: FakeSqlRunner) => (scope: OwnerScope) =>
    sqlTools({ scope, runner, uiActions: [], charts: { count: 0 } });

  it('are found by tool_search for a number question', async () => {
    const t = await setup(undefined, undefined, ROUTE_CATALOG, withSql(new FakeSqlRunner()));
    const out = await t.search({ query: 'revenue this week' });
    const top3 = (out.json as { key: string }[]).slice(0, 3).map((h) => h.key);
    expect(top3.some((k) => k === 'sql_query' || k === 'sql_schema')).toBe(true);
    const hit = (out.json as { key: string; use: string }[]).find((h) => h.key === 'sql_query');
    expect(hit?.use).toBe('read');
  });

  it('get no page boost', () => {
    const extra = [{ key: 'sql_query', summary: 'orders', when: '' }];
    const onPage = searchCatalog(ROUTE_CATALOG, 'orders', '/app/orders', extra);
    const plain = searchCatalog(ROUTE_CATALOG, 'orders', undefined, extra);
    expect(onPage.findIndex((e) => e.key === 'sql_query')).toBeGreaterThanOrEqual(
      plain.findIndex((e) => e.key === 'sql_query'),
    );
  });

  it('are described with their body schema', async () => {
    const t = await setup(undefined, undefined, ROUTE_CATALOG, withSql(new FakeSqlRunner()));
    const out = await t.describe({ key: 'sql_query' });
    expect(out.json).toMatchObject({ key: 'sql_query', use: 'read', pathParams: [] });
    expect(out.json.body).toMatchObject({
      type: 'object',
      properties: { sql: { type: 'string', maxLength: 4000 } },
      required: ['sql'],
    });
  });

  it('run through tool_call with the input in body, ignoring businessId, params and query', async () => {
    const runner = new FakeSqlRunner();
    const t = await setup(undefined, undefined, ROUTE_CATALOG, withSql(runner));
    const out = await t.call({
      key: 'sql_query',
      body: { sql: 'select 1 from orders' },
      businessId: 'not-a-business',
      params: { x: '1' },
      query: { q: 'x' },
    });
    expect(out.json).toMatchObject({ ok: true, columns: ['n'], rows: [[1]] });
    expect(runner.calls).toEqual([
      { accountId: t.scope.accountId, businessIds: [BUSINESS, OTHER], sql: 'select 1 from orders' },
    ]);
    expect(t.invoke).not.toHaveBeenCalled();
    const schema = await t.call({ key: 'sql_schema' });
    expect(typeof schema.json).toBe('string');
  });

  it('check the body against the entry input', async () => {
    const runner = new FakeSqlRunner();
    const t = await setup(undefined, undefined, ROUTE_CATALOG, withSql(runner));
    const out = await t.call({ key: 'sql_query', body: { sql: 42 } });
    expect(out.ok).toBe(false);
    expect(out.json).toMatchObject({ ok: false, errorCode: 'invalid_input' });
    expect((out.json.issues as { path: string }[])[0]?.path).toBe('sql');
    expect(runner.calls).toHaveLength(0);
  });

  it('count against the turn read budget', async () => {
    const big = 'x'.repeat(150);
    const runner = new FakeSqlRunner(() => ({
      columns: [{ name: 'v', type: 'text' }],
      rows: Array.from({ length: 200 }, () => [big]),
      truncated: false,
    }));
    const t = await setup(undefined, undefined, ROUTE_CATALOG, withSql(runner));
    let used = 0;
    // Each result is close to 8 000 chars: the sixth is cut to what is left of the 40 000.
    for (let i = 0; i < 6; i++) {
      const out = await t.call({ key: 'sql_query', body: { sql: 'select 1 from orders' } });
      used += out.content.length;
    }
    expect(used).toBe(TURN_READ_BUDGET_CHARS);
    const after = await t.call({ key: 'sql_query', body: { sql: 'select 1 from orders' } });
    expect(after.json).toEqual({
      ok: false,
      errorCode: 'turn_budget_exhausted',
      guidance: BUDGET_EXHAUSTED_GUIDANCE,
    });
  });

  it('do not exist without native entries', async () => {
    const t = await setup();
    expect(
      (await t.call({ key: 'sql_query', body: { sql: 'select 1 from orders' } })).json,
    ).toEqual({ ok: false, errorCode: 'unknown_key' });
    expect((await t.describe({ key: 'sql_query' })).json).toEqual({
      ok: false,
      errorCode: 'unknown_key',
    });
    const hits = (await t.search({ query: 'revenue this week' })).json as { key: string }[];
    expect(hits.some((h) => h.key.startsWith('sql_'))).toBe(false);
  });
});
