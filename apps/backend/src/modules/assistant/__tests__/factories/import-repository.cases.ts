import { newId } from '@agent-sales/shared';
import { expect, it } from 'vitest';

import { AssistantNotFoundError } from '../../domain/assistant.errors.js';
import type { OwnerScope } from '../../domain/owner-scope.js';
import type {
  AssistantRepository,
  NewImportBatch,
  NewProposal,
} from '../../domain/ports/assistant.repository.js';
import type { ImportDraft } from '../../domain/product-import.js';

/**
 * Product import storage cases (T-173), run against the in-memory repository and, in
 * `test/assistant-import.integration.spec.ts`, against Postgres. `repo2` is a second handle on
 * the same store (another connection), used for concurrent writes.
 */
export interface ImportRepositoryHarness {
  repo: AssistantRepository;
  repo2: AssistantRepository;
  /** A new owner (in a new account unless `sameAccountAs` is given) with one thread. */
  owner(sameAccountAs?: OwnerScope): Promise<{ s: OwnerScope; threadId: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const newBatch = (s: OwnerScope, threadId: string): NewImportBatch => ({
  id: newId(),
  threadId,
  businessId: s.businessId,
  kind: 'sheet',
  fileName: 'san-pham.xlsx',
  status: 'ready',
  source: {
    kind: 'sheet',
    rows: [
      ['Tên', 'Giá'],
      ['Áo', '150k'],
    ],
  },
  rowCount: 2,
});

const importProposal = (
  s: OwnerScope,
  threadId: string,
  importBatchId: string | null,
): NewProposal => ({
  id: newId(),
  threadId,
  runId: null,
  businessId: s.businessId,
  routeKey: 'POST /products',
  path: '/products',
  query: null,
  body: null,
  summary: 'Tạo 1 sản phẩm từ san-pham.xlsx',
  preview: { draftKeys: ['r1'] },
  expiresAt: new Date(Date.now() + 86_400_000),
  kind: 'product_import',
  importBatchId,
});

const draft: ImportDraft = {
  key: 'r1',
  rows: [1],
  product: {
    code: 'Ao',
    name: 'Áo',
    description: '',
    category: null,
    visibleToBot: true,
    imageUrls: [],
    variants: [{ sku: 'Ao', name: '', price: 150_000, cost: null, weightGram: null, stock: null }],
  },
  problems: [{ field: 'code', code: 'code_generated', severity: 'warning', row: 1 }],
  excluded: false,
};

export function importRepositoryCases(harness: () => ImportRepositoryHarness): void {
  it('creates a batch and hides it from other owners and accounts', async () => {
    const { repo, owner } = harness();
    const a = await owner();
    const sameAccount = await owner(a.s);
    const other = await owner();
    const b = newBatch(a.s, a.threadId);
    const created = await repo.createImportBatch(a.s, b);
    expect(created).toMatchObject({
      ...b,
      spec: null,
      overrides: {},
      excluded: [],
      drafts: null,
      draftsHash: null,
      results: {},
    });
    expect(await repo.getImportBatch(a.s, b.id)).toEqual(created);
    expect(await repo.getImportBatch(sameAccount.s, b.id)).toBeNull();
    expect(await repo.getImportBatch(other.s, b.id)).toBeNull();
    await expect(repo.createImportBatch(other.s, newBatch(other.s, a.threadId))).rejects.toThrow(
      AssistantNotFoundError,
    );
  });

  it('stores a preview, and refuses to write another owner’s batch', async () => {
    const { repo, owner } = harness();
    const a = await owner();
    const other = await owner();
    const b = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));
    const preview = {
      spec: { headerRow: 0, fields: { name: { col: 0 }, price: { col: 1 } } },
      overrides: { r1: { name: 'Áo thun' } },
      excluded: ['r2'],
      drafts: [draft],
      draftsHash: 'a'.repeat(64),
    };
    await repo.saveImportPreview(a.s, b.id, preview);
    expect(await repo.getImportBatch(a.s, b.id)).toMatchObject(preview);
    await expect(repo.saveImportPreview(other.s, b.id, preview)).rejects.toThrow(
      AssistantNotFoundError,
    );
    await expect(
      repo.recordImportResult(other.s, b.id, 'r1', { status: 'not_run' }),
    ).rejects.toThrow(AssistantNotFoundError);
  });

  it('with lockSpec, refuses a spec change once a draft is created, in the write itself', async () => {
    const { repo, owner } = harness();
    const a = await owner();
    const b = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));
    const spec = { headerRow: 0, fields: { name: { col: 0 }, price: { col: 1 } } };
    const preview = { spec, overrides: {}, excluded: [], drafts: [draft], draftsHash: 'h1' };
    const changed = { ...preview, spec: { ...spec, headerRow: 1 }, draftsHash: 'h2' };
    // No row created yet: the spec may change.
    expect(await repo.saveImportPreview(a.s, b.id, preview, { lockSpec: true })).toBe(true);
    await repo.recordImportResult(a.s, b.id, 'r1', { status: 'created', productId: newId() });
    expect(await repo.saveImportPreview(a.s, b.id, changed, { lockSpec: true })).toBe(false);
    expect((await repo.getImportBatch(a.s, b.id))?.draftsHash).toBe('h1');
    // The same spec (keys in another order) still saves new overrides.
    const same = {
      ...preview,
      spec: { fields: { price: { col: 1 }, name: { col: 0 } }, headerRow: 0 },
      overrides: { r1: { name: 'Áo thun' } },
      draftsHash: 'h3',
    };
    expect(await repo.saveImportPreview(a.s, b.id, same, { lockSpec: true })).toBe(true);
    expect((await repo.getImportBatch(a.s, b.id))?.draftsHash).toBe('h3');
  });

  it('keeps both results of two concurrent writes on different keys', async () => {
    const { repo, repo2, owner } = harness();
    const a = await owner();
    const b = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));
    const productId = newId();
    await Promise.all([
      repo.recordImportResult(a.s, b.id, 'r1', { status: 'created', productId }),
      repo2.recordImportResult(a.s, b.id, 'r2', { status: 'failed', errorCode: 'exists_code' }),
    ]);
    await repo.recordImportResult(a.s, b.id, 'r3', { status: 'not_run' });
    await repo.recordImportResult(a.s, b.id, 'r3', {
      status: 'created',
      productId,
      warnings: ['stock_failed'],
    });
    expect((await repo.getImportBatch(a.s, b.id))?.results).toEqual({
      r1: { status: 'created', productId },
      r2: { status: 'failed', errorCode: 'exists_code' },
      r3: { status: 'created', productId, warnings: ['stock_failed'] },
    });
  });

  it('ties product_import proposals to a batch, and route proposals keep their defaults', async () => {
    const { repo, owner } = harness();
    const a = await owner();
    const b = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));
    await expect(repo.createProposal(a.s, importProposal(a.s, a.threadId, null))).rejects.toThrow();
    await expect(
      repo.createProposal(a.s, { ...importProposal(a.s, a.threadId, b.id), kind: 'route' }),
    ).rejects.toThrow();

    const first = await repo.createProposal(a.s, importProposal(a.s, a.threadId, b.id));
    expect(first).toMatchObject({ kind: 'product_import', importBatchId: b.id, body: null });
    const second = await repo.createProposal(a.s, importProposal(a.s, a.threadId, b.id));
    const { kind: _k, importBatchId: _b, ...route } = importProposal(a.s, a.threadId, null);
    const plain = await repo.createProposal(a.s, {
      ...route,
      routeKey: 'PATCH /products/{productId}',
      path: '/products/p1',
      body: { price: 1 },
    });
    expect(plain).toMatchObject({ kind: 'route', importBatchId: null });

    await repo.transitionProposal(a.s, first.id, ['pending'], 'rejected');
    expect((await repo.pendingImportProposals(a.s, b.id)).map((p) => p.id)).toEqual([second.id]);
    const other = await owner();
    expect(await repo.pendingImportProposals(other.s, b.id)).toEqual([]);
  });

  it('purges only the owner’s old batches, with their proposals', async () => {
    const { repo, owner } = harness();
    const a = await owner();
    const sameAccount = await owner(a.s);
    const old = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));
    const theirs = await repo.createImportBatch(
      sameAccount.s,
      newBatch(sameAccount.s, sameAccount.threadId),
    );
    const proposal = await repo.createProposal(a.s, importProposal(a.s, a.threadId, old.id));
    await sleep(30);
    const cutoff = new Date(Math.max(old.createdAt.getTime(), theirs.createdAt.getTime()) + 5);
    await sleep(30);
    const fresh = await repo.createImportBatch(a.s, newBatch(a.s, a.threadId));

    expect(await repo.purgeImportBatches(a.s, cutoff)).toBe(1);
    expect(await repo.getImportBatch(a.s, old.id)).toBeNull();
    expect(await repo.getProposal(a.s, proposal.id)).toBeNull();
    expect(await repo.getImportBatch(a.s, fresh.id)).not.toBeNull();
    expect(await repo.getImportBatch(sameAccount.s, theirs.id)).not.toBeNull();
    expect(await repo.purgeImportBatches(a.s, cutoff)).toBe(0);
  });
}
