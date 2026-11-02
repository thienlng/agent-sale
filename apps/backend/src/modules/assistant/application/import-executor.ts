import { Logger } from '@nestjs/common';

import type { OwnerScope } from '../domain/owner-scope.js';
import type {
  AssistantRepository,
  ImportRowResult,
  ProposalRecord,
} from '../domain/ports/assistant.repository.js';
import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { hasErrors, toUpsertProductRequest, type ImportDraft } from '../domain/product-import.js';

/** An approved import stops starting products after this long; the rest are `not_run`. */
export const IMPORT_RUN_DEADLINE_MS = 60_000;

/** How an approved import went, for `ProposalService` to finish the proposal with. */
export interface ImportOutcome {
  ok: boolean;
  errorCode?: string;
  /** `{created, failed, notRun}` as JSON. */
  resultPreview: string;
  /** The event message the next turn sees (Vietnamese, as the 1b events). */
  event: string;
}

/** What a `product_import` proposal pins in its preview. */
interface ImportProposalPreview {
  fileName?: string;
  draftKeys?: string[];
  draftsHash?: string;
}

interface Body {
  id?: unknown;
  variants?: { id?: unknown; sku?: unknown }[];
  error?: { details?: { field?: unknown; issues?: { path?: unknown }[] } };
  data?: { id?: unknown; isDefault?: unknown }[];
}

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);
const ok2xx = (status: number) => status >= 200 && status < 300;

/** The failure code of a `POST /products` answer (spec §7). */
function failureCode(status: number, body: Body | null): string {
  if (status === 409) {
    const field = body?.error?.details?.field;
    return field === 'code' || field === 'sku' ? `exists_${field}` : 'http_409';
  }
  if (status === 400) {
    const path = body?.error?.details?.issues?.[0]?.path;
    return typeof path === 'string' && path ? `invalid:${path}` : 'invalid';
  }
  if (status === 403) return 'forbidden';
  return `http_${status}`;
}

/** The most frequent value (first seen wins a tie). */
function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  for (const [v, n] of counts) if (best === undefined || n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/**
 * Runs an approved `product_import` proposal (C4-R1, spec §7): `POST /products` once per draft,
 * in order and one at a time, through the same in-process route path as every proposal, with the
 * approver's own token. Each draft's result is stored as soon as it is known, so a crash loses at
 * most one record (and a re-run meets that product as `exists_code`). Logs carry counts only.
 */
export class ImportExecutor {
  readonly #log = new Logger(ImportExecutor.name);

  constructor(
    private readonly repo: AssistantRepository,
    private readonly invoker: RouteInvoker,
  ) {}

  /** Milliseconds; tests replace it to reach the deadline. */
  clock: () => number = () => Date.now();
  deadlineMs = IMPORT_RUN_DEADLINE_MS;

  async run(
    scope: OwnerScope,
    proposal: ProposalRecord,
    authorization: string,
  ): Promise<ImportOutcome> {
    const pinned = (proposal.preview ?? {}) as ImportProposalPreview;
    const batch = proposal.importBatchId
      ? await this.repo.getImportBatch(scope, proposal.importBatchId)
      : null;
    if (!batch || !batch.drafts || batch.draftsHash !== pinned.draftsHash) {
      return {
        ok: false,
        errorCode: 'import_changed',
        resultPreview: JSON.stringify({ created: 0, failed: 0, notRun: 0 }),
        event: `Không áp dụng được: ${proposal.summary} (import_changed)`,
      };
    }
    const drafts = new Map(batch.drafts.map((d) => [d.key, d]));
    const keys = (pinned.draftKeys ?? []).filter((k) => batch.results[k]?.status !== 'created');
    const started = this.clock();

    const needsStock = keys.some((k) =>
      drafts.get(k)?.product?.variants.some((v) => v.stock !== null),
    );
    const warehouseId = needsStock
      ? await this.#defaultWarehouse(batch.businessId, authorization)
      : null;

    let created = 0;
    let notRun = 0;
    const failures: string[] = [];
    let forbidden = false;
    for (const key of keys) {
      let result: ImportRowResult;
      if (forbidden) {
        result = { status: 'failed', errorCode: 'forbidden' };
      } else if (this.clock() - started >= this.deadlineMs) {
        result = { status: 'not_run' };
      } else {
        result = await this.#create(proposal, batch.businessId, key, drafts.get(key), {
          authorization,
          warehouseId,
        });
        if (result.status === 'failed' && result.errorCode === 'forbidden') forbidden = true;
      }
      if (result.status === 'created') created++;
      else if (result.status === 'failed') failures.push(result.errorCode);
      else notRun++;
      await this.repo.recordImportResult(scope, batch.id, key, result);
    }

    const failed = failures.length;
    this.#log.log(
      `assistant import ${batch.id}: created=${created} failed=${failed} notRun=${notRun}`,
    );
    const event =
      `Đã tạo ${created}/${keys.length} sản phẩm từ ${batch.fileName}` +
      (failed ? `; ${failed} dòng không tạo được` : '') +
      (notRun ? `; ${notRun} dòng chưa chạy (đề nghị lại)` : '');
    const resultPreview = JSON.stringify({ created, failed, notRun });
    if (created > 0) return { ok: true, resultPreview, event };
    return {
      ok: false,
      errorCode: mostCommon(failures) ?? (notRun ? 'not_run' : 'nothing_to_import'),
      resultPreview,
      event,
    };
  }

  /** The default warehouse's id, or null (no warehouse, or the read failed). */
  async #defaultWarehouse(businessId: string, authorization: string): Promise<string | null> {
    try {
      const res = await this.invoker.invoke({
        method: 'get',
        path: '/warehouses',
        businessId,
        authorization,
      });
      if (!ok2xx(res.status)) return null;
      const found = (res.body as Body | null)?.data?.find((w) => w.isDefault === true);
      return typeof found?.id === 'string' ? found.id : null;
    } catch (e) {
      this.#log.warn(`assistant import: warehouses not read (${errorClass(e)})`);
      return null;
    }
  }

  async #create(
    proposal: ProposalRecord,
    businessId: string,
    key: string,
    draft: ImportDraft | undefined,
    opts: { authorization: string; warehouseId: string | null },
  ): Promise<ImportRowResult> {
    if (!draft || draft.excluded || hasErrors(draft))
      return { status: 'failed', errorCode: 'invalid' };
    let body: ReturnType<typeof toUpsertProductRequest>;
    try {
      body = toUpsertProductRequest(draft);
    } catch {
      return { status: 'failed', errorCode: 'invalid' };
    }
    let status: number;
    let res: Body | null;
    try {
      const out = await this.invoker.invoke({
        method: 'post',
        path: '/products',
        body,
        businessId,
        authorization: opts.authorization,
        idempotencyKey: `asst:${proposal.id}:${key}`,
      });
      status = out.status;
      res = out.body as Body | null;
    } catch (e) {
      this.#log.warn(`assistant import: product not created (${errorClass(e)})`);
      return { status: 'failed', errorCode: 'invoke_failed' };
    }
    if (!ok2xx(status) || typeof res?.id !== 'string') {
      return {
        status: 'failed',
        errorCode: ok2xx(status) ? 'invoke_failed' : failureCode(status, res),
      };
    }
    const productId = res.id;
    const warnings = await this.#stock(businessId, productId, draft, res, opts);
    return { status: 'created', productId, ...(warnings.length ? { warnings } : {}) };
  }

  /** Counted stock per variant (matched by SKU, case-insensitive); failures are warnings only. */
  async #stock(
    businessId: string,
    productId: string,
    draft: ImportDraft,
    created: Body,
    opts: { authorization: string; warehouseId: string | null },
  ): Promise<string[]> {
    const withStock = (draft.product?.variants ?? []).filter((v) => v.stock !== null);
    if (withStock.length === 0) return [];
    if (!opts.warehouseId) return ['no_warehouse'];
    const ids = new Map<string, string>();
    for (const v of created.variants ?? []) {
      if (typeof v.sku === 'string' && typeof v.id === 'string') ids.set(v.sku.toLowerCase(), v.id);
    }
    let failed = false;
    for (const v of withStock) {
      const variantId = ids.get(v.sku.toLowerCase());
      if (!variantId) {
        failed = true;
        continue;
      }
      try {
        const out = await this.invoker.invoke({
          method: 'post',
          path: `/products/${productId}/stock`,
          body: { variantId, warehouseId: opts.warehouseId, onHand: v.stock },
          businessId,
          authorization: opts.authorization,
        });
        if (!ok2xx(out.status)) failed = true;
      } catch {
        failed = true;
      }
    }
    return failed ? ['stock_failed'] : [];
  }
}
