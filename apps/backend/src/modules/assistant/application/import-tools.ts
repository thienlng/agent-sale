import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import { MatchProductCodesResponse } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import type { OwnerScope } from '../domain/owner-scope.js';
import type {
  AssistantRepository,
  ImportBatchRecord,
} from '../domain/ports/assistant.repository.js';
import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';
import {
  buildDrafts,
  codesOf,
  draftsHash,
  hasErrors,
  IMPORT_DRAFT_KEY,
  ImportOverrides,
  ImportSpec,
  type ImportDraft,
} from '../domain/product-import.js';
import { MAX_PENDING_PROPOSALS, PROPOSAL_TTL_MS } from './route-tools.js';

export const IMPORT_PREVIEW_TOOL = 'import_preview';
export const IMPORT_PROPOSE_TOOL = 'import_propose';
/** An import tool result the model sees is never longer than this. */
export const MAX_IMPORT_RESULT_CHARS = 8_000;
/** One import proposal creates at most this many products. */
export const MAX_IMPORT_PROPOSAL_PRODUCTS = 200;
/** Problems listed in a preview result. */
export const PREVIEW_PROBLEMS_SHOWN = 15;
/** Ready drafts shown as a sample in a preview result. */
export const PREVIEW_SAMPLE_SHOWN = 3;
/** The event a pending import proposal gets when a new preview or proposal replaces it. */
export const IMPORT_REPLACED_EVENT = 'Đã thay bằng bản xem trước mới';
/** The route an import proposal runs once per product (C4-R1). */
export const IMPORT_ROUTE_KEY = 'POST /products';
const MAX_ISSUES = 5;
const TRUNCATED = '…[truncated]';

const DraftKeys = z.array(z.string().regex(IMPORT_DRAFT_KEY)).max(300);

/** What the model is shown: the real schemas, so it writes a valid spec. */
const ImportPreviewInput = z.object({
  batchId: z.string().max(64),
  spec: ImportSpec.optional(),
  overrides: ImportOverrides.optional(),
  exclude: DraftKeys.optional(),
});
/** What the tool accepts before its own checks (`invalid_spec` / `invalid_overrides`). */
const ImportPreviewArgs = z.object({
  batchId: z.string().max(64),
  spec: z.unknown().optional(),
  overrides: z.unknown().optional(),
  exclude: z.unknown().optional(),
});
const ImportProposeInput = z.object({
  batchId: z.string().max(64),
  summary: z.string().max(300).optional(),
});

export const IMPORT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: IMPORT_PREVIEW_TOOL,
    description:
      'Preview the products of an import batch from <import_batch>. A sheet needs `spec` (0-based columns of the raw rows mapped to fields, closed transforms) the first time; a photo batch takes no spec. `overrides` ({draftKey: fields}) merge into the earlier ones by key ({} clears a key); `exclude` (draft keys) replaces the earlier list. Returns the counts, the first problems and a sample. Nothing is created.',
    input: ImportPreviewInput,
  },
  {
    name: IMPORT_PROPOSE_TOOL,
    description:
      'Propose creating the ready products of the batch’s current preview (at most 200, skipping rows with errors and products already created). The owner approves it on a card; nothing is created before. Give `summary` (Vietnamese, ≤ 300 chars).',
    input: ImportProposeInput,
  },
];

/** What the import tools work on during one turn. */
export interface ImportToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  invoker: RouteInvoker;
  /** The owner's own `Authorization` header (memory only; never stored or logged). */
  authorization: string;
  threadId: string;
  runId: string;
  /** Proposals made during the turn, in order. */
  proposalIds: string[];
  now?: () => Date;
  /** The industry of one of the scope's businesses (a hotel imports no retail products). */
  industryOf?: (businessId: string) => string | undefined;
}

/** Told to the model when a hotel business is asked to import products (QA Villas #5). */
export const NOT_FOR_HOTEL_GUIDANCE =
  'Product import creates retail products only. A hotel adds its villas, homestays and rooms on the properties page (/app/properties), where rates and the calendar live; tell the owner so and offer to open it. Do not create the villas as products.';

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');
const cut = (text: string): string =>
  text.length > MAX_IMPORT_RESULT_CHARS
    ? text.slice(0, MAX_IMPORT_RESULT_CHARS - TRUNCATED.length) + TRUNCATED
    : text;
const fail = (errorCode: string, extra: Record<string, unknown> = {}) => ({
  content: json({ ok: false, errorCode, ...extra }),
  ok: false,
});
const issuesOf = (error: z.ZodError) =>
  error.issues.slice(0, MAX_ISSUES).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));

function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value ?? null));
}

/** Keys of the drafts already created by an approved import of the batch. */
export const createdKeysOf = (batch: ImportBatchRecord): Set<string> =>
  new Set(
    Object.entries(batch.results)
      .filter(([, r]) => r.status === 'created')
      .map(([k]) => k),
  );

/** Ready = not excluded, no error, not created yet: what a proposal would create, in order. */
export function readyDrafts(drafts: ImportDraft[], created: ReadonlySet<string>): ImportDraft[] {
  return drafts.filter((d) => !d.excluded && !hasErrors(d) && !created.has(d.key));
}

/** `120000` or `100000–250000`. */
function priceRange(d: ImportDraft): string | null {
  const prices = (d.product?.variants ?? [])
    .map((v) => v.price)
    .filter((p): p is number => p !== null);
  if (prices.length === 0) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/**
 * The owner's pending import proposals of the batch are rejected, each with the event the next
 * turn sees: a newer preview or proposal replaces them (one pending import per batch).
 */
export async function rejectPendingImports(
  scope: OwnerScope,
  repo: AssistantRepository,
  batch: ImportBatchRecord,
): Promise<number> {
  let n = 0;
  for (const p of await repo.pendingImportProposals(scope, batch.id)) {
    const rejected = await repo.transitionProposal(scope, p.id, ['pending'], 'rejected', {
      decidedAt: new Date(),
    });
    if (!rejected) continue;
    n++;
    await repo.appendMessages(scope, p.threadId, [
      {
        id: newId(),
        role: 'event',
        content: `${IMPORT_REPLACED_EVENT}: ${p.summary}`,
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      },
    ]);
  }
  return n;
}

/** import_preview and import_propose for one turn (spec §6.2). */
export function importTools(ctx: ImportToolContext): RunnableTool[] {
  const now = ctx.now ?? (() => new Date());

  /** A refusal when the batch's business sells nights, not products (a hotel). */
  function wrongIndustry(batch: ImportBatchRecord) {
    return ctx.industryOf?.(batch.businessId) === 'hotel'
      ? fail('not_for_this_industry', { industry: 'hotel', guidance: NOT_FOR_HOTEL_GUIDANCE })
      : null;
  }

  /** The batch of this turn's thread, for a business still in scope. */
  async function batchOf(batchId: string): Promise<ImportBatchRecord | null> {
    if (!z.uuid().safeParse(batchId).success) return null;
    const batch = await ctx.repo.getImportBatch(ctx.scope, batchId);
    if (!batch || batch.threadId !== ctx.threadId) return null;
    return ctx.scope.businessIds.some((b) => b === batch.businessId) ? batch : null;
  }

  /** `{codes, skus}` that already exist, or null when the check failed. */
  async function existing(
    batch: ImportBatchRecord,
    drafts: ImportDraft[],
  ): Promise<{ codes: string[]; skus: string[] } | null> {
    const wanted = codesOf(drafts);
    if (wanted.codes.length === 0 && wanted.skus.length === 0) return { codes: [], skus: [] };
    try {
      const res = await ctx.invoker.invoke({
        method: 'post',
        path: '/products/match-codes',
        body: wanted,
        businessId: batch.businessId,
        authorization: ctx.authorization,
      });
      if (res.status < 200 || res.status >= 300) return null;
      const parsed = MatchProductCodesResponse.safeParse(res.body);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  const preview: RunnableTool = {
    name: IMPORT_PREVIEW_TOOL,
    readOnly: false,
    schema: ImportPreviewArgs,
    async run(raw) {
      const input = raw as z.output<typeof ImportPreviewArgs>;
      const batch = await batchOf(input.batchId);
      if (!batch) return fail('unknown_batch');
      const refused = wrongIndustry(batch);
      if (refused) return refused;
      const created = createdKeysOf(batch);

      let spec = batch.spec;
      if (batch.kind === 'photos') {
        if (input.spec !== undefined) return fail('spec_not_allowed');
      } else if (input.spec !== undefined) {
        const parsed = ImportSpec.safeParse(input.spec);
        if (!parsed.success) return fail('invalid_spec', { issues: issuesOf(parsed.error) });
        if (created.size > 0 && canonical(parsed.data) !== canonical(batch.spec)) {
          return fail('spec_locked');
        }
        spec = parsed.data;
      } else if (!spec) {
        return fail('spec_required');
      }

      let overrides = batch.overrides;
      if (input.overrides !== undefined) {
        const parsed = ImportOverrides.safeParse(input.overrides);
        if (!parsed.success) return fail('invalid_overrides', { issues: issuesOf(parsed.error) });
        const merged = { ...batch.overrides, ...parsed.data };
        for (const [key, o] of Object.entries(parsed.data)) {
          if (Object.keys(o).length === 0) delete merged[key];
        }
        const again = ImportOverrides.safeParse(merged);
        if (!again.success) return fail('invalid_overrides', { issues: issuesOf(again.error) });
        overrides = again.data;
      }
      let excluded = batch.excluded;
      if (input.exclude !== undefined) {
        const parsed = DraftKeys.safeParse(input.exclude);
        if (!parsed.success) return fail('invalid_exclude', { issues: issuesOf(parsed.error) });
        excluded = [...new Set(parsed.data)];
      }

      const base = { source: batch.source, spec, overrides, excluded, createdKeys: created };
      const first = buildDrafts({ ...base, existing: null });
      const found = await existing(batch, first);
      const drafts = found ? buildDrafts({ ...base, existing: found }) : first;
      const saved = await ctx.repo.saveImportPreview(
        ctx.scope,
        batch.id,
        { spec, overrides, excluded, drafts, draftsHash: draftsHash(drafts) },
        // Checked again in the write itself: an approval may have created rows since the load.
        { lockSpec: true },
      );
      if (!saved) return fail('spec_locked');
      await rejectPendingImports(ctx.scope, ctx.repo, batch);

      const live = drafts.filter((d) => !d.excluded);
      const ready = readyDrafts(drafts, created);
      const result = {
        ok: true,
        products: live.length,
        variants: live.reduce((n, d) => n + (d.product?.variants.length ?? 0), 0),
        ready: ready.length,
        withErrors: live.filter((d) => !created.has(d.key) && hasErrors(d)).length,
        warnings: live.filter((d) => d.problems.some((p) => p.severity === 'warning')).length,
        excluded: drafts.length - live.length,
        alreadyCreated: created.size,
        ...(found ? {} : { batchWarnings: ['exists_check_failed'] }),
        problems: live
          .filter((d) => !created.has(d.key))
          .flatMap((d) =>
            d.problems.map((p) => ({
              key: d.key,
              ...(p.row !== undefined ? { row: p.row } : {}),
              field: p.field,
              code: p.code,
            })),
          )
          .slice(0, PREVIEW_PROBLEMS_SHOWN),
        sample: ready.slice(0, PREVIEW_SAMPLE_SHOWN).map((d) => ({
          key: d.key,
          name: d.product?.name ?? '',
          code: d.product?.code ?? '',
          price: priceRange(d),
          variants: d.product?.variants.length ?? 0,
        })),
      };
      return { content: cut(json(result)) };
    },
  };

  const propose: RunnableTool = {
    name: IMPORT_PROPOSE_TOOL,
    readOnly: false,
    schema: ImportProposeInput,
    async run(raw) {
      const input = raw as z.output<typeof ImportProposeInput>;
      const batch = await batchOf(input.batchId);
      if (!batch) return fail('unknown_batch');
      const refusedIndustry = wrongIndustry(batch);
      if (refusedIndustry) return refusedIndustry;
      const summary = input.summary?.trim();
      if (!summary) return fail('summary_required');
      if (!batch.drafts || !batch.draftsHash) return fail('preview_required');
      const created = createdKeysOf(batch);
      const chosen = readyDrafts(batch.drafts, created).slice(0, MAX_IMPORT_PROPOSAL_PRODUCTS);
      if (chosen.length === 0) return fail('nothing_to_import');

      const at = now().getTime();
      const waiting = (await ctx.repo.listProposals(ctx.scope, ctx.threadId)).filter(
        (x) => x.status === 'pending' && x.expiresAt.getTime() > at && x.importBatchId !== batch.id,
      );
      if (waiting.length >= MAX_PENDING_PROPOSALS) {
        return fail('too_many_pending', { max: MAX_PENDING_PROPOSALS });
      }
      await rejectPendingImports(ctx.scope, ctx.repo, batch);

      const live = batch.drafts.filter((d) => !d.excluded);
      const proposal = await ctx.repo.createProposal(ctx.scope, {
        id: newId(),
        threadId: ctx.threadId,
        runId: ctx.runId,
        businessId: batch.businessId,
        kind: 'product_import',
        importBatchId: batch.id,
        routeKey: IMPORT_ROUTE_KEY,
        path: '/products',
        query: null,
        body: null,
        summary,
        preview: {
          fileName: batch.fileName,
          batchKind: batch.kind,
          draftKeys: chosen.map((d) => d.key),
          draftsHash: batch.draftsHash,
          counts: {
            products: chosen.length,
            variants: chosen.reduce((n, d) => n + (d.product?.variants.length ?? 0), 0),
            skippedWithErrors: live.filter((d) => !created.has(d.key) && hasErrors(d)).length,
            alreadyCreated: created.size,
          },
          visibleToBotDefault: chosen.every((d) => d.product?.visibleToBot !== false),
        },
        expiresAt: new Date(at + PROPOSAL_TTL_MS),
      });
      ctx.proposalIds.push(proposal.id);
      return {
        content: json({
          status: 'awaiting_owner_approval',
          proposalId: proposal.id,
          products: chosen.length,
        }),
      };
    },
  };

  return [preview, propose];
}
