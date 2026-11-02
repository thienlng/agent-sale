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

  it('ranks the bot turn traces first for "why did the bot answer" on the inbox and bot pages', () => {
    const query = 'why did the bot answer like that';
    for (const page of ['/app/inbox', '/app/inbox/c1', '/app/bots/b1/playground']) {
      expect(searchCatalog(ROUTE_CATALOG, query, page)[0]?.key).toBe('GET /bots/{botId}/turns');
    }
    // The inbox also boosts the conversation routes it shows.
    const onInbox = searchCatalog(ROUTE_CATALOG, 'conversation messages', '/app/inbox');
    expect(onInbox.slice(0, 3).map((e) => e.key)).toContain('GET /conversations/{id}');
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
