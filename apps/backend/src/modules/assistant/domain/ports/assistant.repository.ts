import type { OwnerScope } from '../owner-scope.js';

export interface ThreadRecord {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  businessId: string | null;
  systemPrompt: string;
  promptVersion: string;
  createdAt: Date;
  lastMessageAt: Date;
}

export interface MessageRecord {
  id: string;
  threadId: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | 'event';
  content: string;
  toolCalls: unknown[] | null;
  toolCallId: string | null;
  toolName: string | null;
  pageContext: unknown | null;
  uiActions: unknown[];
  runId: string | null;
  createdAt: Date;
}

export interface RunRecord {
  id: string;
  threadId: string | null;
  kind: 'chat';
  status: 'running' | 'done' | 'failed';
  tier: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  latencyMs: number;
  rounds: number;
  outcome: string | null;
  guardrail: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface StepRecord {
  runId: string;
  idx: number;
  kind: string;
  toolName: string | null;
  ok: boolean | null;
  ms: number | null;
  errorCode: string | null;
}

export interface SearchHit {
  threadId: string;
  threadTitle: string;
  messageId: string;
  seq: number;
  role: string;
  snippet: string;
  createdAt: Date;
}

/** Threads listed per page. */
export const THREAD_LIST_LIMIT = 50;
/** A running run older than this no longer blocks a new one (crashed process). */
export const RUN_BUSY_WINDOW_MS = 3 * 60_000;

/**
 * Account-scoped storage of one owner's assistant data (ADR-022). Every method is limited to
 * `s.accountId` AND `s.ownerUserId`: a thread or run of another owner, even in the same
 * account, behaves as absent. Methods taking a `threadId` or `runId` verify, in the same
 * transaction, that it is the owner's (the `thread_id` foreign keys alone do not carry the
 * owner) and throw `AssistantNotFoundError` otherwise.
 */
export interface AssistantRepository {
  /** ≤ 50, pinned first, then last_message_at desc; `text` matches the title or a message. */
  listThreads(s: OwnerScope, q: { archived: boolean; text?: string }): Promise<ThreadRecord[]>;
  getThread(s: OwnerScope, threadId: string): Promise<ThreadRecord | null>;
  createThread(
    s: OwnerScope,
    t: { id: string; title: string; systemPrompt: string; promptVersion: string },
  ): Promise<ThreadRecord>;
  updateThread(
    s: OwnerScope,
    threadId: string,
    patch: Partial<Pick<ThreadRecord, 'title' | 'pinned' | 'archived'>>,
  ): Promise<ThreadRecord | null>;
  /** seq asc. */
  listMessages(
    s: OwnerScope,
    threadId: string,
    opts?: { activeOnly?: boolean },
  ): Promise<MessageRecord[]>;
  /** Assigns seq = max+1…, bumps last_message_at. */
  appendMessages(
    s: OwnerScope,
    threadId: string,
    msgs: Omit<MessageRecord, 'seq' | 'createdAt' | 'threadId'>[],
  ): Promise<MessageRecord[]>;
  /** Accent-insensitive full text (fallback: substring) over user/assistant rows; schedule and review threads last. */
  searchMessages(s: OwnerScope, query: string, limit: number): Promise<SearchHit[]>;
  /**
   * `busy` = another run of this owner is running and younger than 3 min; `duplicate` = this
   * owner already has a run with this id.
   */
  startRun(
    s: OwnerScope,
    r: { id: string; threadId: string; tier: string; promptVersion: string },
  ): Promise<'started' | 'busy' | 'duplicate'>;
  addStep(s: OwnerScope, step: StepRecord): Promise<void>;
  finishRun(s: OwnerScope, runId: string, patch: Partial<RunRecord>): Promise<void>;
  getRun(s: OwnerScope, runId: string): Promise<(RunRecord & { steps: StepRecord[] }) | null>;
}

export const ASSISTANT_REPOSITORY = Symbol('ASSISTANT_REPOSITORY');
