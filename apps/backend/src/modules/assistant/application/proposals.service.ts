import type { AssistantProposalDto } from '@agent-sales/contracts';
import { isUuid, newId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

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
import {
  ACCESS_DELEGATION,
  type AccessDelegation,
} from '../domain/ports/access-delegation.port.js';
import { ROUTE_INVOKER, type RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { APPROVAL_DELEGATION_SECONDS, delegatedAuthorization } from './delegated-authorization.js';
import { ROUTE_CATALOG, type RouteCatalog } from './route-catalog.js';

/** The stored result shown on a done proposal is at most this long. */
export const RESULT_PREVIEW_CHARS = 1_000;

export function toProposalDto(p: ProposalRecord): AssistantProposalDto {
  return {
    id: p.id,
    threadId: p.threadId,
    businessId: p.businessId,
    routeKey: p.routeKey,
    summary: p.summary,
    preview: p.preview,
    status: p.status,
    errorCode: p.errorCode,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
  };
}

const errorClass = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/** `PATCH /products/{productId}` → `patch`. */
const methodOf = (routeKey: string): string => (routeKey.split(' ')[0] ?? '').toLowerCase();

/** JSON with object keys sorted, so two reads of the same record compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/**
 * The fields a PATCH/PUT proposal changes that are no longer what the owner saw (`before`): for
 * a PATCH the body's top-level keys, for a PUT (a whole replace) every top-level key of either
 * snapshot. Empty when nothing the proposal touches changed.
 */
export function changedSince(
  method: string,
  body: unknown,
  before: unknown,
  current: unknown,
): string[] {
  const obj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const was = obj(before);
  const now = obj(current);
  if (!was || !now) return stableJson(before) === stableJson(current) ? [] : ['*'];
  const keys =
    method === 'patch'
      ? Object.keys(obj(body) ?? {}).filter((k) => k in was)
      : [...new Set([...Object.keys(was), ...Object.keys(now)])];
  return keys.filter((k) => stableJson(was[k]) !== stableJson(now[k])).sort();
}

/** Told to the assistant when a stale draft is refused, so it reads again and re-proposes. */
export const TARGET_CHANGED_EVENT =
  'dữ liệu này đã thay đổi sau khi em soạn đề xuất nên em không áp dụng, để khỏi ghi đè thay đổi mới; em sẽ đọc lại và đề xuất lại';

/** How a proposal ended; a refusal may bring its own result preview and event text. */
type Outcome = ({ ok: true; body?: unknown } | { ok: false; errorCode: string }) & {
  resultPreview?: string;
  event?: string;
};

/**
 * Owner decisions on proposals (spec §6). A proposal runs only on approval, through the same
 * in-process route path as a read, with a delegated token of the approver and idempotency key
 * `asst:<id>`. The outcome is appended to the thread as an `event` message, so the next turn sees
 * it. The pending → executing transition is the atomic guard: of two approvals, one wins.
 */
@Injectable()
export class ProposalService {
  readonly #log = new Logger(ProposalService.name);

  constructor(
    @Inject(ASSISTANT_REPOSITORY) private readonly repo: AssistantRepository,
    @Inject(ROUTE_INVOKER) private readonly invoker: RouteInvoker,
    @Inject(ACCESS_DELEGATION)
    @Optional()
    private readonly delegation: AccessDelegation | null = null,
  ) {}

  /** The routes the assistant may use; tests replace it. */
  catalog: RouteCatalog = ROUTE_CATALOG;

  /** Stale pending proposals expire first, then the thread's proposals, oldest first. */
  async list(scope: OwnerScope, threadId: string): Promise<AssistantProposalDto[]> {
    if (!isUuid(threadId)) throw new AssistantNotFoundError('thread', threadId);
    await this.repo.expireProposals(scope, new Date());
    return (await this.repo.listProposals(scope, threadId)).map(toProposalDto);
  }

  async approve(
    scope: OwnerScope,
    id: string,
    ownAuthorization: string,
  ): Promise<AssistantProposalDto> {
    const proposal = await this.#decidable(scope, id);
    // An import runs many writes and may outlive the approver's token: use one minted for it.
    const authorization = await delegatedAuthorization(
      this.delegation,
      ownAuthorization,
      APPROVAL_DELEGATION_SECONDS,
    );
    const started = await this.repo.transitionProposal(scope, id, ['pending'], 'executing');
    if (!started) throw await this.#conflict(scope, id);
    // It may have expired between the sweep and the transition.
    if (started.expiresAt.getTime() <= Date.now()) {
      await this.repo.transitionProposal(scope, id, ['executing'], 'expired', {
        decidedAt: new Date(),
      });
      throw new AssistantProposalConflictError('proposal_expired');
    }
    // The route may have left the catalog (or stopped being a write) since it was proposed.
    if (this.catalog.get(proposal.routeKey)?.use !== 'write') {
      return this.#finish(scope, proposal, { ok: false, errorCode: 'route_not_allowed' });
    }

    // A stale draft must not undo a later edit (QA TinyMind B5): what it changes must still be
    // what the owner saw when it was drafted.
    const stale = await this.#changedTarget(proposal, authorization);
    if (stale.length > 0) {
      return this.#finish(scope, proposal, {
        ok: false,
        errorCode: 'target_changed',
        resultPreview: JSON.stringify({ changed: stale }),
        event: `Không áp dụng được: ${proposal.summary} (target_changed): ${TARGET_CHANGED_EVENT}`,
      });
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
   * For a PATCH/PUT proposal that stored a `before` snapshot, the fields it changes whose
   * current value differs from that snapshot (re-read with the approver's token). Empty when the
   * proposal has no snapshot or the target cannot be read (the write then answers for itself).
   */
  async #changedTarget(proposal: ProposalRecord, authorization: string): Promise<string[]> {
    const method = methodOf(proposal.routeKey);
    const preview = proposal.preview as { before?: unknown } | null;
    if ((method !== 'patch' && method !== 'put') || preview?.before === undefined) return [];
    try {
      const current = await this.invoker.invoke({
        method: 'get',
        path: proposal.path,
        businessId: proposal.businessId,
        authorization,
      });
      if (current.status < 200 || current.status >= 300) return [];
      return changedSince(method, proposal.body, preview.before, current.body);
    } catch (e) {
      this.#log.warn(`assistant proposal ${proposal.id}: target not re-read (${errorClass(e)})`);
      return [];
    }
  }

  /**
   * executing → done | failed, then the event message the next turn sees. A refusal may pass its
   * own result preview and event text; otherwise they are derived from the answer.
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
