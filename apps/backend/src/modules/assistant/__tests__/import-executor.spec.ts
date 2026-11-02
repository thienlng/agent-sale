import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  importTools,
  IMPORT_PREVIEW_TOOL,
  IMPORT_PROPOSE_TOOL,
} from '../application/import-tools.js';
import { ProposalService } from '../application/proposals.service.js';
import { AssistantProposalConflictError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import type { ImportSpec } from '../domain/product-import.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());
const WAREHOUSE = newId();
const SPEC: ImportSpec = {
  headerRow: 0,
  fields: {
    name: { col: 0 },
    price: { col: 1, transforms: ['money_vnd'] },
    code: { col: 2 },
    stock: { col: 3 },
  },
};
const ROWS = [
  ['Tên', 'Giá', 'Mã', 'Tồn'],
  ['Áo', '100k', 'A-1', ''],
  ['Quần', '200k', 'Q-1', '5'],
  ['Mũ', '50k', 'M-1', ''],
];

type Responder = (i: RouteInvocation) => RouteInvocationResult | Promise<RouteInvocationResult>;

/** An in-memory `/api/v1`: products get ids, variants keep their SKUs. */
function fakeApi(over: Partial<Record<string, Responder>> = {}): Responder {
  return (i) => {
    const key = `${i.method.toUpperCase()} ${i.path}`;
    const special = over[key] ?? (i.path.endsWith('/stock') ? over['STOCK'] : undefined);
    if (special) return special(i);
    if (key === 'POST /products/match-codes') return { status: 200, body: { codes: [], skus: [] } };
    if (key === 'GET /warehouses') {
      return { status: 200, body: { data: [{ id: WAREHOUSE, name: 'Kho', isDefault: true }] } };
    }
    if (key === 'POST /products') {
      const body = i.body as { code: string; variants: { sku: string }[] };
      return {
        status: 201,
        body: {
          id: newId(),
          code: body.code,
          variants: body.variants.map((v) => ({ id: newId(), sku: v.sku.toLowerCase() })),
        },
      };
    }
    if (i.path.endsWith('/stock')) return { status: 200, body: {} };
    return { status: 404, body: null };
  };
}

async function setup(api: Responder = fakeApi(), rows = ROWS) {
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
    promptVersion: 'assistant@2',
  });
  const invoke = vi.fn((i: RouteInvocation) => Promise.resolve(api(i)));
  const proposals = new ProposalService(repo, { invoke });
  const tools = importTools({
    scope,
    repo,
    invoker: { invoke },
    authorization: 'Bearer owner',
    threadId: thread.id,
    runId: newId(),
    proposalIds: [],
  });
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(name);
    return JSON.parse((await tool.run(tool.schema.parse(input))).content) as Record<
      string,
      unknown
    >;
  };
  const batch = await repo.createImportBatch(scope, {
    id: newId(),
    threadId: thread.id,
    businessId: BUSINESS,
    kind: 'sheet',
    fileName: 'hang.xlsx',
    status: 'ready',
    source: { kind: 'sheet', rows },
    rowCount: rows.length,
  });
  /** Preview, propose; returns the proposal id. */
  const propose = async () => {
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    const out = await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'Nhập hàng' });
    return out.proposalId as string;
  };
  const events = async () =>
    (await repo.listMessages(scope, thread.id))
      .filter((m) => m.role === 'event')
      .map((m) => m.content);
  const results = async () => (await repo.getImportBatch(scope, batch.id))?.results ?? {};
  return { repo, scope, thread, invoke, proposals, run, batch, propose, events, results };
}

const productCalls = (invoke: { mock: { calls: [RouteInvocation][] } }) =>
  invoke.mock.calls.map((c) => c[0]).filter((i) => i.method === 'post' && i.path === '/products');

describe('ImportExecutor (through ProposalService.approve)', () => {
  it('creates every product, sets stock on the default warehouse and finishes done', async () => {
    const { proposals, scope, propose, invoke, events, results } = await setup();
    const id = await propose();
    const dto = await proposals.approve(scope, id, 'Bearer approver');
    expect(dto.status).toBe('done');
    const calls = productCalls(invoke);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      businessId: BUSINESS,
      authorization: 'Bearer approver',
      idempotencyKey: `asst:${id}:r1`,
      body: { code: 'A-1', name: 'Áo' },
    });
    const stock = invoke.mock.calls.map((c) => c[0]).filter((i) => i.path.endsWith('/stock'));
    expect(stock).toHaveLength(1);
    expect(stock[0]?.body).toMatchObject({ warehouseId: WAREHOUSE, onHand: 5 });
    expect(invoke.mock.calls.filter((c) => c[0].path === '/warehouses')).toHaveLength(1);
    const r = await results();
    expect(Object.values(r).map((x) => x.status)).toEqual(['created', 'created', 'created']);
    expect((await events()).at(-1)).toBe('Đã tạo 3/3 sản phẩm từ hang.xlsx');
  });

  it('records per-row results for a mix of 201, 409 and 400', async () => {
    let n = 0;
    const base = fakeApi();
    const api = fakeApi({
      'POST /products': (i) => {
        n++;
        if (n === 2) {
          return {
            status: 409,
            body: { error: { code: 'CONFLICT', details: { field: 'code', value: 'Q-1' } } },
          };
        }
        if (n === 3) {
          return {
            status: 400,
            body: { error: { code: 'VALIDATION_FAILED', details: { issues: [{ path: 'name' }] } } },
          };
        }
        return base(i);
      },
    });
    const { proposals, scope, propose, results, events } = await setup(api);
    const dto = await proposals.approve(scope, await propose(), 'B');
    expect(dto.status).toBe('done');
    const r = await results();
    expect(r.r1?.status).toBe('created');
    expect(r.r2).toEqual({ status: 'failed', errorCode: 'exists_code' });
    expect(r.r3).toEqual({ status: 'failed', errorCode: 'invalid:name' });
    expect((await events()).at(-1)).toBe('Đã tạo 1/3 sản phẩm từ hang.xlsx; 2 dòng không tạo được');
  });

  it('fails with the most common error when nothing was created', async () => {
    const api = fakeApi({
      'POST /products': () => ({
        status: 409,
        body: { error: { details: { field: 'sku' } } },
      }),
    });
    const { proposals, scope, propose } = await setup(api);
    const dto = await proposals.approve(scope, await propose(), 'B');
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'exists_sku' });
  });

  it('stops at a 403: this draft and every later one are forbidden', async () => {
    let n = 0;
    const base = fakeApi();
    const api = fakeApi({
      'POST /products': (i) => (++n === 2 ? { status: 403, body: null } : base(i)),
    });
    const { proposals, scope, propose, results, invoke } = await setup(api);
    await proposals.approve(scope, await propose(), 'B');
    expect(productCalls(invoke)).toHaveLength(2);
    const r = await results();
    expect(r.r2).toEqual({ status: 'failed', errorCode: 'forbidden' });
    expect(r.r3).toEqual({ status: 'failed', errorCode: 'forbidden' });
  });

  it('leaves the rest not_run at the deadline, and a new proposal covers only them', async () => {
    let t = 0;
    const base = fakeApi();
    // Each product takes 40 s: the second starts at 40 s, the third would start at 80 s.
    const api = fakeApi({
      'POST /products': (i) => {
        t += 40_000;
        return base(i);
      },
    });
    const { proposals, scope, propose, results, events, run, batch, repo } = await setup(api);
    proposals.importExecutor.clock = () => t;
    const dto = await proposals.approve(scope, await propose(), 'B');
    expect(dto.status).toBe('done');
    const r = await results();
    expect(r.r3).toEqual({ status: 'not_run' });
    expect((await events()).at(-1)).toBe(
      'Đã tạo 2/3 sản phẩm từ hang.xlsx; 1 dòng chưa chạy (đề nghị lại)',
    );
    const again = await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'Phần còn lại' });
    const p = await repo.getProposal(scope, again.proposalId as string);
    expect((p?.preview as { draftKeys: string[] }).draftKeys).toEqual(['r3']);
  });

  it('adds no_warehouse when the business has no default warehouse', async () => {
    const api = fakeApi({ 'GET /warehouses': () => ({ status: 200, body: { data: [] } }) });
    const { proposals, scope, propose, results, invoke } = await setup(api);
    await proposals.approve(scope, await propose(), 'B');
    expect((await results()).r2).toMatchObject({ status: 'created', warnings: ['no_warehouse'] });
    expect(invoke.mock.calls.filter((c) => c[0].path.endsWith('/stock'))).toHaveLength(0);
  });

  it('keeps a product created when its stock call fails (stock_failed)', async () => {
    const api = fakeApi({ STOCK: () => ({ status: 500, body: null }) });
    const { proposals, scope, propose, results } = await setup(api);
    const dto = await proposals.approve(scope, await propose(), 'B');
    expect(dto.status).toBe('done');
    expect((await results()).r2).toMatchObject({ status: 'created', warnings: ['stock_failed'] });
  });

  it('fails with import_changed when the batch preview no longer matches', async () => {
    const { proposals, scope, propose, repo, batch, invoke } = await setup();
    const id = await propose();
    const stored = repo.importBatches.get(batch.id);
    if (!stored) throw new Error('missing batch');
    stored.draftsHash = 'changed';
    const dto = await proposals.approve(scope, id, 'B');
    expect(dto).toMatchObject({ status: 'failed', errorCode: 'import_changed' });
    expect(productCalls(invoke)).toHaveLength(0);
  });

  it('refuses a second approval (409)', async () => {
    const { proposals, scope, propose } = await setup();
    const id = await propose();
    await proposals.approve(scope, id, 'B');
    await expect(proposals.approve(scope, id, 'B')).rejects.toBeInstanceOf(
      AssistantProposalConflictError,
    );
  });
});
