import type { AssistantProposalDto } from '@agent-sales/contracts';
import { isUuid, newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AssistantNotFoundError,
  AssistantProposalConflictError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import {
  ASSISTANT_REPOSITORY,
  type AssistantRepository,
  type ProposalRecord,
} from '../domain/ports/assistant.repository.js';
import { ROUTE_INVOKER, type RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { ImportExecutor, type ImportOutcome, ImportRunError } from './import-executor.js';
import { ROUTE_CATALOG, type RouteCatalog } from './route-catalog.js';
import { type ScheduleProposalBody, SchedulesService } from './schedules.service.js';

/** The stored result shown on a done proposal is at most this long. */
export const RESULT_PREVIEW_CHARS = 1_000;

export function toProposalDto(p: ProposalRecord): AssistantProposalDto {
  return {
    id: p.id,
    kind: p.kind,
    threadId: p.threadId,
    businessId: p.businessId,
    routeKey: p.routeKey,
    path: p.path,
    summary: p.summary,
    preview: p.preview,
    status: p.status,
    errorCode: p.errorCode,
    resultId: p.resultId,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
    importBatchId: p.importBatchId,
  };
}

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** The `id` of a 2xx JSON response body when it is a uuid (what the proposal created), else null. */
export function resultIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' && isUuid(id) ? id : null;
}

/** `PATCH /products/{productId}` → `patch`. */
const methodOf = (routeKey: string): string => (routeKey.split(' ')[0] ?? '').toLowerCase();

/** How a proposal ended; an import brings its own result preview and event text. */
type Outcome = ({ ok: true; body?: unknown } | { ok: false; errorCode: string }) & {
  resultPreview?: string;
  event?: string;
};

/**
 * Owner decisions on proposals (spec §6). A proposal runs only on approval, through the same
 * in-process route path as a read, with the approver's own bearer token and idempotency key
 * `asst:<id>`. The outcome is appended to the thread as an `event` message, so the next turn sees
 * it. The pending → executing transition is the atomic guard: of two approvals, one wins.
 */
@Injectable()
export class ProposalService {
  readonly #log = new Logger(ProposalService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ROUTE_INVOKER) private readonly invoker: RouteInvoker,
    @Inject(SchedulesService) private readonly schedules: SchedulesService,
  ) {
    this.importExecutor = new ImportExecutor(repo, invoker);
  }

  /** The routes the assistant may use; tests replace it. */
  catalog: RouteCatalog = ROUTE_CATALOG;
  /** Runs approved `product_import` proposals (C4-R1); tests replace its clock. */
  readonly importExecutor: ImportExecutor;

  /** Stale pending proposals expire first, then the thread's proposals, oldest first. */
  async list(scope: OwnerScope, threadId: string): Promise<AssistantProposalDto[]> {
    if (!isUuid(threadId)) throw new AssistantNotFoundError('thread', threadId);
    await this.repo.expireProposals(scope, new Date());
    return (await this.repo.listProposals(scope, threadId)).map(toProposalDto);
  }

  async approve(
    scope: OwnerScope,
    id: string,
    authorization: string,
  ): Promise<AssistantProposalDto> {
    const proposal = await this.#decidable(scope, id);
    const started = await this.repo.transitionProposal(scope, id, ['pending'], 'executing');
    if (!started) throw await this.#conflict(scope, id);
    // It may have expired between the sweep and the transition.
    if (started.expiresAt.getTime() <= Date.now()) {
      await this.repo.transitionProposal(scope, id, ['executing'], 'expired', {
        decidedAt: new Date(),
      });
      throw new AssistantProposalConflictError('proposal_expired');
    }
    // A schedule change applies in-process, not through a route (S3-R11: /assistant is `never`).
    if (proposal.kind === 'schedule') {
      let outcome;
      try {
        outcome = await this.schedules.applyProposal(scope, proposal.body as ScheduleProposalBody);
      } catch (e) {
        this.#log.warn(`assistant proposal ${id}: schedule change failed (${errorClass(e)})`);
        outcome = { ok: false as const, errorCode: 'apply_failed' };
      }
      return this.#finish(
        scope,
        proposal,
        outcome.ok ? { ok: true, body: { id: outcome.id, name: outcome.name } } : outcome,
      );
    }
    // The route may have left the catalog (or stopped being a write) since it was proposed.
    const entry = this.catalog.get(proposal.routeKey);
    if (entry?.use !== 'write') {
      return this.#finish(scope, proposal, { ok: false, errorCode: 'route_not_allowed' });
    }
    if (proposal.kind === 'product_import') {
      let outcome: ImportOutcome;
      try {
        outcome = await this.importExecutor.run(scope, proposal, authorization);
      } catch (e) {
        // Never leave the proposal `executing`: finish it failed, with how far it got.
        const counts =
          e instanceof ImportRunError ? e.counts : { created: 0, failed: 0, notRun: 0 };
        this.#log.warn(
          `assistant proposal ${id}: import stopped (${errorClass(e instanceof ImportRunError ? e.cause : e)}) ` +
            `created=${counts.created} failed=${counts.failed} notRun=${counts.notRun}`,
        );
        return this.#finish(scope, proposal, {
          ok: false,
          errorCode: 'import_failed',
          resultPreview: JSON.stringify(counts),
          event:
            `Không áp dụng xong: ${proposal.summary} (import_failed); ` +
            `đã tạo ${counts.created} sản phẩm trước khi dừng`,
        });
      }
      return this.#finish(
        scope,
        proposal,
        outcome.ok
          ? { ok: true, resultPreview: outcome.resultPreview, event: outcome.event }
          : {
              ok: false,
              errorCode: outcome.errorCode ?? 'import_failed',
              resultPreview: outcome.resultPreview,
              event: outcome.event,
            },
      );
    }
    // The stored body must still pass the assistant's (possibly narrowed) schema: a body edited
    // after the proposal, or a schema narrowed since, never runs (no secret reaches a route).
    if (entry.body && !entry.body.safeParse(proposal.body ?? undefined).success) {
      return this.#finish(scope, proposal, { ok: false, errorCode: 'invalid_stored_body' });
    }

    let status: number;
    let body: unknown;
    try {
      ({ status, body } = await this.invoker.invoke({
        method: methodOf(proposal.routeKey),
        path: proposal.path,
        ...(proposal.query ? { query: proposal.query as Record<string, unknown> } : {}),
        ...(proposal.body !== null ? { body: proposal.body } : {}),
        businessId: proposal.businessId,
        authorization,
        idempotencyKey: `asst:${id}`,
      }));
    } catch (e) {
      this.#log.warn(`assistant proposal ${id}: execution failed (${errorClass(e)})`);
      status = 0;
      body = null;
    }

    const ok = status >= 200 && status < 300;
    return this.#finish(
      scope,
      proposal,
      ok ? { ok, body } : { ok, errorCode: status === 0 ? 'invoke_failed' : `http_${status}` },
    );
  }

  /**
   * executing → done | failed, then the event message the next turn sees. An import passes its
   * own result preview and event text; a route proposal's are derived from the answer.
   */
  async #finish(
    scope: OwnerScope,
    proposal: ProposalRecord,
    outcome: Outcome,
  ): Promise<AssistantProposalDto> {
    const done = await this.repo.transitionProposal(
      scope,
      proposal.id,
      ['executing'],
      outcome.ok ? 'done' : 'failed',
      {
        decidedAt: new Date(),
        errorCode: outcome.ok ? null : outcome.errorCode,
        resultPreview:
          outcome.resultPreview !== undefined
            ? outcome.resultPreview.slice(0, RESULT_PREVIEW_CHARS)
            : outcome.ok
              ? (JSON.stringify(outcome.body) ?? '').slice(0, RESULT_PREVIEW_CHARS)
              : null,
        resultId: outcome.ok ? resultIdOf(outcome.body) : null,
      },
    );
    await this.#event(
      scope,
      proposal,
      outcome.event ??
        (outcome.ok
          ? `Đã áp dụng: ${proposal.summary}`
          : `Không áp dụng được: ${proposal.summary} (${outcome.errorCode})`),
    );
    if (!done) throw new AssistantNotFoundError('proposal', proposal.id);
    return toProposalDto(done);
  }

  async reject(scope: OwnerScope, id: string): Promise<AssistantProposalDto> {
    const proposal = await this.#decidable(scope, id);
    const rejected = await this.repo.transitionProposal(scope, id, ['pending'], 'rejected', {
      decidedAt: new Date(),
    });
    if (!rejected) throw await this.#conflict(scope, id);
    await this.#event(scope, proposal, `Anh/chị đã bỏ: ${proposal.summary}`);
    return toProposalDto(rejected);
  }

  /**
   * The owner's proposal for a business still in their scope (else 404), after stale pending
   * proposals expired.
   */
  async #decidable(scope: OwnerScope, id: string): Promise<ProposalRecord> {
    if (!isUuid(id)) throw new AssistantNotFoundError('proposal', id);
    await this.repo.expireProposals(scope, new Date());
    const proposal = await this.repo.getProposal(scope, id);
    if (!proposal || !scope.businessIds.some((b) => b === proposal.businessId)) {
      throw new AssistantNotFoundError('proposal', id);
    }
    return proposal;
  }

  async #conflict(scope: OwnerScope, id: string): Promise<AssistantProposalConflictError> {
    const now = await this.repo.getProposal(scope, id);
    return new AssistantProposalConflictError(
      now?.status === 'expired' ? 'proposal_expired' : 'proposal_not_pending',
    );
  }

  async #event(scope: OwnerScope, proposal: ProposalRecord, content: string): Promise<void> {
    await this.repo.appendMessages(scope, proposal.threadId, [
      {
        id: newId(),
        role: 'event',
        content,
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      },
    ]);
  }
}
