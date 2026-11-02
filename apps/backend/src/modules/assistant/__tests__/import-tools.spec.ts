import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  IMPORT_PREVIEW_TOOL,
  IMPORT_PROPOSE_TOOL,
  IMPORT_REPLACED_EVENT,
  importTools,
} from '../application/import-tools.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import type { ImportSpec } from '../domain/product-import.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());

const ROWS = [
  ['DANH SÁCH'],
  ['Tên', 'Giá', 'Mã'],
  ['Áo thun', '150k', 'AO-1'],
  ['Quần jean', '', 'QJ-1'],
  ['Mũ', '50.000đ', 'MU-1'],
];
const SPEC: ImportSpec = {
  headerRow: 1,
  fields: { name: { col: 0 }, price: { col: 1, transforms: ['money_vnd'] }, code: { col: 2 } },
};

type Invoke = (i: RouteInvocation) => Promise<RouteInvocationResult>;

async function setup(invokeImpl?: Invoke) {
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
  const invoke = vi.fn<Invoke>(
    invokeImpl ?? (() => Promise.resolve({ status: 200, body: { codes: [], skus: [] } })),
  );
  const proposalIds: string[] = [];
  const tools = importTools({
    scope,
    repo,
    invoker: { invoke },
    authorization: 'Bearer owner',
    threadId: thread.id,
    runId: newId(),
    proposalIds,
  });
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(name);
    const out = await tool.run(tool.schema.parse(input));
    return JSON.parse(out.content) as Record<string, unknown>;
  };
  const sheet = async (threadId = thread.id, rows = ROWS) =>
    repo.createImportBatch(scope, {
      id: newId(),
      threadId,
      businessId: BUSINESS,
      kind: 'sheet',
      fileName: 'hang.xlsx',
      status: 'ready',
      source: { kind: 'sheet', rows },
      rowCount: rows.length,
    });
  return { repo, scope, thread, invoke, run, sheet, proposalIds };
}

describe('import_preview', () => {
  it('refuses a batch of another thread (unknown_batch)', async () => {
    const { run, sheet, repo, scope } = await setup();
    const other = await repo.createThread(scope, {
      id: newId(),
      title: '',
      systemPrompt: 'S',
      promptVersion: 'assistant@2',
    });
    const batch = await sheet(other.id);
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC })).toMatchObject({
      ok: false,
      errorCode: 'unknown_batch',
    });
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: 'nope', spec: SPEC })).toMatchObject({
      errorCode: 'unknown_batch',
    });
  });

  it('needs a spec for a sheet the first time and validates it', async () => {
    const { run, sheet } = await setup();
    const batch = await sheet();
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id })).toMatchObject({
      errorCode: 'spec_required',
    });
    const bad = await run(IMPORT_PREVIEW_TOOL, {
      batchId: batch.id,
      spec: { headerRow: 1, fields: { name: { col: 0 } }, regex: '.*' },
    });
    expect(bad).toMatchObject({ errorCode: 'invalid_spec' });
    expect((bad.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it('checks the codes once and flags the ones that already exist', async () => {
    const { run, sheet, invoke, repo, scope } = await setup(() =>
      Promise.resolve({ status: 200, body: { codes: ['ao-1'], skus: [] } }),
    );
    const batch = await sheet();
    const out = await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toMatchObject({
      method: 'post',
      path: '/products/match-codes',
      businessId: BUSINESS,
      authorization: 'Bearer owner',
      body: { codes: ['AO-1', 'QJ-1', 'MU-1'] },
    });
    expect(out).toMatchObject({ ok: true, products: 3, ready: 1, withErrors: 2 });
    const codes = (out.problems as { key: string; code: string }[]).map((p) => [p.key, p.code]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ['r2', 'exists_code'],
        ['r3', 'missing_price'],
      ]),
    );
    expect(out.sample).toEqual([
      { key: 'r4', name: 'Mũ', code: 'MU-1', price: '50000', variants: 1 },
    ]);
    const stored = await repo.getImportBatch(scope, batch.id);
    expect(stored?.spec).toEqual(SPEC);
    expect(stored?.drafts).toHaveLength(3);
    expect(stored?.draftsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries on without the existence check when it fails', async () => {
    const { run, sheet } = await setup(() => Promise.resolve({ status: 500, body: null }));
    const batch = await sheet();
    const out = await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    expect(out).toMatchObject({ ok: true, ready: 2, batchWarnings: ['exists_check_failed'] });
  });

  it('merges overrides by key and replaces the excluded list', async () => {
    const { run, sheet, repo, scope } = await setup();
    const batch = await sheet();
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    let out = await run(IMPORT_PREVIEW_TOOL, {
      batchId: batch.id,
      overrides: { r3: { variants: [{ index: 0, price: '200k' }] } },
    });
    expect(out).toMatchObject({ ready: 3, withErrors: 0 });
    out = await run(IMPORT_PREVIEW_TOOL, {
      batchId: batch.id,
      overrides: { r2: { name: 'Áo thun cotton' } },
      exclude: ['r4'],
    });
    expect(out).toMatchObject({ products: 2, ready: 2, excluded: 1 });
    const stored = await repo.getImportBatch(scope, batch.id);
    expect(Object.keys(stored?.overrides ?? {})).toEqual(['r3', 'r2']);
    expect(stored?.excluded).toEqual(['r4']);
  });

  it('locks the spec once a product was created, but accepts the same spec', async () => {
    const { run, sheet, repo, scope } = await setup();
    const batch = await sheet();
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    await repo.recordImportResult(scope, batch.id, 'r2', { status: 'created', productId: newId() });
    const changed = { ...SPEC, skipRows: [3] };
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: changed })).toMatchObject({
      errorCode: 'spec_locked',
    });
    // Same spec with keys in another order is unchanged.
    const same = { fields: SPEC.fields, headerRow: 1 };
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: same })).toMatchObject({
      ok: true,
      alreadyCreated: 1,
      ready: 1,
    });
  });

  it('refuses a spec for a photo batch', async () => {
    const { run, repo, scope, thread } = await setup();
    const batch = await repo.createImportBatch(scope, {
      id: newId(),
      threadId: thread.id,
      businessId: BUSINESS,
      kind: 'photos',
      fileName: '1 ảnh',
      status: 'ready',
      source: {
        kind: 'photos',
        grouping: 'per_photo',
        groups: [{ imageUrls: [], vision: null, visionError: 'vision_failed' }],
      },
      rowCount: 1,
    });
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC })).toMatchObject({
      errorCode: 'spec_not_allowed',
    });
    expect(await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id })).toMatchObject({
      ok: true,
      withErrors: 1,
    });
  });

  it('a new preview rejects the pending import proposal with an event', async () => {
    const { run, sheet, repo, scope, thread } = await setup();
    const batch = await sheet();
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    const proposed = await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'Tạo 2 sp' });
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, exclude: ['r4'] });
    const p = await repo.getProposal(scope, proposed.proposalId as string);
    expect(p?.status).toBe('rejected');
    const events = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'event');
    expect(events.map((m) => m.content)).toEqual([`${IMPORT_REPLACED_EVENT}: Tạo 2 sp`]);
  });
});

describe('import_propose', () => {
  it('needs a summary and a preview', async () => {
    const { run, sheet } = await setup();
    const batch = await sheet();
    expect(await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: ' ' })).toMatchObject({
      errorCode: 'summary_required',
    });
    expect(await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'x' })).toMatchObject({
      errorCode: 'preview_required',
    });
  });

  it('proposes the ready drafts only, skipping created and erroring ones', async () => {
    const { run, sheet, repo, scope, proposalIds } = await setup();
    const batch = await sheet();
    await run(IMPORT_PREVIEW_TOOL, { batchId: batch.id, spec: SPEC });
    await repo.recordImportResult(scope, batch.id, 'r2', { status: 'created', productId: newId() });
    const out = await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'Tạo sản phẩm' });
    expect(out).toMatchObject({ status: 'awaiting_owner_approval', products: 1 });
    expect(proposalIds).toEqual([out.proposalId]);
    const p = await repo.getProposal(scope, out.proposalId as string);
    const stored = await repo.getImportBatch(scope, batch.id);
    expect(p).toMatchObject({
      kind: 'product_import',
      importBatchId: batch.id,
      routeKey: 'POST /products',
      path: '/products',
      body: null,
      status: 'pending',
      preview: {
        fileName: 'hang.xlsx',
        batchKind: 'sheet',
        draftKeys: ['r4'],
        draftsHash: stored?.draftsHash,
        counts: { products: 1, variants: 1, skippedWithErrors: 1, alreadyCreated: 1 },
        visibleToBotDefault: true,
      },
    });
  });

  it('takes at most 200 drafts', async () => {
    const { run, sheet, repo, scope } = await setup();
    const rows = [
      ['Tên', 'Giá'],
      ...Array.from({ length: 250 }, (_, i) => [`Sản phẩm ${i}`, '10k']),
    ];
    const batch = await sheet(undefined, rows);
    await run(IMPORT_PREVIEW_TOOL, {
      batchId: batch.id,
      spec: { headerRow: 0, fields: { name: { col: 0 }, price: { col: 1 } } },
    });
    const out = await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'Tạo 200' });
    expect(out.products).toBe(200);
    const p = await repo.getProposal(scope, out.proposalId as string);
    expect((p?.preview as { draftKeys: string[] }).draftKeys).toHaveLength(200);
  });

  it('answers nothing_to_import when no draft is ready', async () => {
    const { run, sheet } = await setup();
    const batch = await sheet(undefined, [
      ['Tên', 'Giá'],
      ['Áo', ''],
    ]);
    await run(IMPORT_PREVIEW_TOOL, {
      batchId: batch.id,
      spec: { headerRow: 0, fields: { name: { col: 0 }, price: { col: 1 } } },
    });
    expect(await run(IMPORT_PROPOSE_TOOL, { batchId: batch.id, summary: 'x' })).toMatchObject({
      errorCode: 'nothing_to_import',
    });
  });
});
