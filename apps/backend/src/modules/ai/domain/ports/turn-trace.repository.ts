import type { WorkspaceId } from '@agent-sales/shared';

import type { AiRunRecord } from './ai-run.repository.js';

/** How the turn's agent loop ended; `error` = the model failed before the loop finished. */
export type LoopOutcome = 'done' | 'interrupted' | 'limit' | 'invalid_tools' | 'budget' | 'error';

/** What the shop bot saw in one turn (`ai_run_traces`, migration 0063). Excerpts are redacted. */
export interface TurnTraceRecord {
  runId: string;
  botId: string;
  conversationId: string | null;
  startedAt: Date;
  channel: string | null;
  commentReply: boolean;
  historyTurns: number;
  historySummarized: boolean;
  customerImages: number;
  queryExcerpt: string | null;
  replyExcerpt: string | null;
  scenarioIds: string[];
  focusProductIds: string[];
  actionIds: string[];
  pendingAction: boolean;
  offeredTools: string[];
  systemPromptSha: string;
  situationsSha: string;
  modelCalls: number;
  loopOutcome: LoopOutcome;
  messagesSent: number;
  messagesUndelivered: number;
}

/** One loop step (`ai_run_steps`); `detail` comes from the trace-detail allowlist only. */
export interface TurnStepRecord {
  idx: number;
  kind: string;
  toolName: string | null;
  ok: boolean | null;
  errorCode: string | null;
  ms: number | null;
  detail: Record<string, unknown> | null;
}

/** An `ai_runs` row and its trace (null for runs before T-174 or after the 30-day purge). */
export interface TurnRow {
  run: AiRunRecord;
  trace: TurnTraceRecord | null;
}

export interface TurnListFilter {
  botId: string;
  conversationId?: string;
  from: Date;
  to: Date;
  /**
   * A moment (e.g. a bot message's time): only runs whose window
   * `[coalesce(started_at, created_at − latency) − 5 s, created_at + 90 s]` contains it, nearest
   * first (distance 0 inside `[start, created_at]`). The cursor is ignored with `around`.
   */
  around?: Date;
  /** Accent-insensitive substring of the query or reply excerpt. */
  q?: string;
  includeTests: boolean;
  limit: number;
  /** Keyset: rows strictly older than `(createdAt, runId)` in `created_at DESC, id DESC` order. */
  cursor?: { createdAt: Date; runId: string };
}

/** Window margins of the `around` filter. */
export const AROUND_BEFORE_MS = 5_000;
export const AROUND_AFTER_MS = 90_000;

/** Tool names whose steps feed signals even when they succeeded (`signalSteps`). */
export const SIGNAL_TOOL_NAMES = [
  'search_products',
  'product_details',
  'send_message',
  'confirm_pending_action',
  'cancel_pending_action',
] as const;

/** True for a step `signalSteps` returns: failed, carries an error code, a signal tool or an action. */
export function isSignalStep(step: Pick<TurnStepRecord, 'ok' | 'toolName' | 'errorCode'>): boolean {
  if (step.ok === false || step.errorCode !== null) return true;
  const name = step.toolName;
  if (!name) return false;
  return (SIGNAL_TOOL_NAMES as readonly string[]).includes(name) || name.startsWith('action_');
}

/**
 * Shop-bot turn traces. Tenant methods run under the workspace's RLS and filter `workspace_id`
 * explicitly. `problemsOnly` is not a repository filter: the service over-fetches and filters.
 */
export interface TurnTraceRepository {
  /** Inserts the trace and its steps in one transaction. */
  record(ws: WorkspaceId, trace: TurnTraceRecord, steps: TurnStepRecord[]): Promise<void>;
  /** `ai_runs` LEFT JOIN `ai_run_traces`, newest first (or nearest to `around`). */
  list(ws: WorkspaceId, f: TurnListFilter): Promise<TurnRow[]>;
  get(
    ws: WorkspaceId,
    botId: string,
    runId: string,
  ): Promise<(TurnRow & { steps: TurnStepRecord[] }) | null>;
  /** Steps of the given runs that can raise a signal (`isSignalStep`), keyed by run id. */
  signalSteps(ws: WorkspaceId, runIds: string[]): Promise<Map<string, TurnStepRecord[]>>;
  /**
   * Deletes up to `batch` steps and `batch` traces created before `before` (system connection,
   * under a transaction advisory lock). Returns the rows deleted; 0 when the lock was taken.
   */
  purgeExpired(before: Date, batch: number): Promise<number>;
}

export const TURN_TRACE_REPOSITORY = Symbol('TURN_TRACE_REPOSITORY');
