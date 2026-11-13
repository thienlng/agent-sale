import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { ProposalService } from '../application/proposals.service.js';
import { ROUTE_CATALOG } from '../application/route-catalog.js';
import { routeTools } from '../application/route-tools.js';
import type { SchedulesService } from '../application/schedules.service.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());
const WAREHOUSE = newId();
const PRODUCT = newId();
const VARIANT = newId();
const BODY = {
  code: 'QA-BUPBE',
  name: 'QA AS2 Búp bê gỗ',
  variants: [{ sku: 'QA-BUPBE', price: 145_000 }],
};

async function setup(warehouses = [{ id: WAREHOUSE, isDefault: true }]) {
  const repo = new InMemoryAssistantRepository();
  const scope: OwnerScope = {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: BUSINESS,
    businessIds: [BUSINESS],
  };
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: '',
    systemPrompt: 'S',
    promptVersion: 'assistant@6',
  });
  const invoke = vi.fn((i: RouteInvocation): Promise<RouteInvocationResult> => {
    const key = `${i.method.toUpperCase()} ${i.path}`;
    if (key === 'POST /products') {
      return Promise.resolve({
        status: 201,
        body: { id: PRODUCT, variants: [{ id: VARIANT, sku: 'QA-BUPBE' }] },
      });
    }
    if (key === 'GET /warehouses')
      return Promise.resolve({ status: 200, body: { data: warehouses } });
    if (key === `POST /products/${PRODUCT}/stock`)
      return Promise.resolve({ status: 200, body: {} });
    return Promise.resolve({ status: 404, body: null });
  });
  const [, , call] = routeTools({
    scope,
    repo,
    invoker: { invoke },
    catalog: ROUTE_CATALOG,
    authorization: 'Bearer owner',
    threadId: thread.id,
    runId: newId(),
    proposalIds: [],
  });
  const run = async (input: unknown) =>
    JSON.parse((await call!.run(call!.schema.parse(input))).content) as Record<string, unknown>;
  const proposals = new ProposalService(repo, { invoke }, {} as SchedulesService);
  const events = async () =>
    (await repo.listMessages(scope, thread.id))
      .filter((m) => m.role === 'event')
      .map((m) => m.content);
  return { repo, scope, thread, invoke, run, proposals, events };
}

describe('a product created with its stock on one card (AS-12, AS2-7)', () => {
  it('shows the stock on the card and sets it in the default warehouse on approval', async () => {
    const t = await setup();
    const out = await t.run({
      key: 'POST /products',
      body: BODY,
      stock: [{ sku: 'qa-bupbe', onHand: 6 }],
      summary: 'Tạo QA AS2 Búp bê gỗ, giá 145.000đ, tồn 6',
    });
    expect(out.status).toBe('awaiting_owner_approval');
    const [p] = await t.repo.listProposals(t.scope, t.thread.id);
    // The API body has no stock; the card shows it on the variant.
    expect(p?.body).not.toHaveProperty('variants.0.stock');
    expect(p?.preview).toMatchObject({
      body: { variants: [{ sku: 'QA-BUPBE', stock: 6 }] },
      stock: [{ sku: 'qa-bupbe', onHand: 6 }],
    });
    const dto = await t.proposals.approve(t.scope, p!.id, 'Bearer approver');
    expect(dto.status).toBe('done');
    const stockCall = t.invoke.mock.calls.map((c) => c[0]).find((i) => i.path.endsWith('/stock'));
    expect(stockCall).toMatchObject({
      method: 'post',
      path: `/products/${PRODUCT}/stock`,
      body: { variantId: VARIANT, warehouseId: WAREHOUSE, onHand: 6 },
    });
    expect((await t.events()).at(-1)).toMatch(/^Đã áp dụng: Tạo QA AS2 Búp bê gỗ/);
  });

  it('says when the stock could not be set (no default warehouse)', async () => {
    const t = await setup([]);
    await t.run({
      key: 'POST /products',
      body: BODY,
      stock: [{ sku: 'QA-BUPBE', onHand: 6 }],
      summary: 'Tạo búp bê',
    });
    const [p] = await t.repo.listProposals(t.scope, t.thread.id);
    expect((await t.proposals.approve(t.scope, p!.id, 'B')).status).toBe('done');
    expect((await t.events()).at(-1)).toContain('chưa nhập được tồn kho (chưa có kho mặc định)');
  });

  it('refuses stock on another route, for an unknown SKU or in a bad shape', async () => {
    const t = await setup();
    expect(
      (await t.run({ key: 'GET /products', stock: [{ sku: 'A', onHand: 1 }] })).errorCode,
    ).toBe('stock_not_allowed');
    expect(
      (
        await t.run({
          key: 'POST /products',
          body: BODY,
          stock: [{ sku: 'OTHER', onHand: 1 }],
          summary: 'x',
        })
      ).errorCode,
    ).toBe('stock_unknown_sku');
    expect(
      (await t.run({ key: 'POST /products', body: BODY, stock: 5, summary: 'x' })).errorCode,
    ).toBe('invalid_stock');
  });
});
