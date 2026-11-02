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
  /** Prompt-cache key root, set on the first compaction (null before). */
  cacheRootId: string | null;
  compactedAt: Date | null;
  compactionFailedAt: Date | null;
  /** Savings (%) of the last two compactions, oldest first. */
  compactionSavedPcts: number[];
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
  /** A compaction summary (sorts before the tail it precedes in the active history). */
  isSummary: boolean;
  createdAt: Date;
}

/** A message to append: the repository assigns `seq`, `createdAt` and the thread. */
export type NewMessage = Omit<MessageRecord, 'seq' | 'createdAt' | 'threadId' | 'isSummary'>;

export interface RunRecord {
  id: string;
  threadId: string | null;
  /** `chat` = an owner turn; `compaction` = one summariser call (tier `basic`). */
  kind: 'chat' | 'compaction';
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

/** A run recorded after the fact (no busy check, never `running`), e.g. a compaction call. */
export type RecordedRun = Pick<RunRecord, 'id' | 'threadId' | 'kind' | 'tier' | 'promptVersion'> &
  Pick<
    RunRecord,
    | 'provider'
    | 'model'
    | 'inputTokens'
    | 'cachedTokens'
    | 'outputTokens'
    | 'latencyMs'
    | 'rounds'
    | 'outcome'
    | 'guardrail'
  > & { status: 'done' | 'failed' };

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

export interface MemoryEntry {
  id: string;
  text: string;
  origin: 'assistant' | 'owner';
  createdAt: string;
}

/** One bounded memory store: `owner_profile`, `notes` or `business:<uuid>`. */
export interface MemoryStoreRecord {
  store: string;
  entries: MemoryEntry[];
  updatedAt: Date;
}

/** Valid store names (the table's CHECK constraint). */
export const MEMORY_STORE_PATTERN = /^(owner_profile|notes|business:[0-9a-f-]{36})$/;

export type ProposalStatus = 'pending' | 'executing' | 'done' | 'failed' | 'rejected' | 'expired';

/** A write the model drafted; it runs only when the owner approves it. */
export interface ProposalRecord {
  id: string;
  threadId: string;
  runId: string | null;
  businessId: string;
  /** `METHOD /path` of the route contract. */
  routeKey: string;
  /** Concrete path with params filled, relative to `/api/v1`. */
  path: string;
  query: unknown | null;
  body: unknown | null;
  /** ≤ 300 chars. */
  summary: string;
  preview: unknown | null;
  status: ProposalStatus;
  errorCode: string | null;
  resultPreview: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
  createdAt: Date;
}

export type NewProposal = Pick<
  ProposalRecord,
  | 'id'
  | 'threadId'
  | 'runId'
  | 'businessId'
  | 'routeKey'
  | 'path'
  | 'query'
  | 'body'
  | 'summary'
  | 'preview'
  | 'expiresAt'
>;

export interface ProposalPatch {
  errorCode?: string | null;
  resultPreview?: string | null;
  decidedAt?: Date | null;
}

export interface CompactionInput {
  /** The summarised middle: becomes `active=false, compacted=true` (still searchable). */
  deactivateIds: string[];
  /** Tool results that stay active but whose content becomes `PRUNED_TOOL_TEXT`. */
  prunedToolIds: string[];
  /**
   * Stored with `is_summary=true`, seq = max+1 and sort_seq = `summarySortSeq` of the summarised
   * rows, so every later compaction's summary still sorts after the head and before the tail.
   */
  summary: NewMessage;
  /** Percent of the context this compaction saved; the thread keeps the last two. */
  savedPct: number;
  /** The rebuilt (frozen) system prompt. */
  systemPrompt: string;
}

/**
 * Where a new compaction summary sorts in the active history: (min sort_seq of the summarised
 * ordinary rows) − 0.5, so it sits right after the head and before the tail. A folded earlier
 * summary is left out of the minimum: it sorts before the rows it once replaced, and counting it
 * would let the position drift down one step per compaction until it sank into the head. Only
 * when nothing but summaries is summarised does the lowest of their sort_seq count.
 */
export function summarySortSeq(summarised: { sortSeq: number; isSummary: boolean }[]): number {
  if (summarised.length === 0) throw new Error('assistant compaction needs a middle to summarise');
  const ordinary = summarised.filter((x) => !x.isSummary);
  return ordinary.length > 0
    ? Math.min(...ordinary.map((x) => x.sortSeq)) - 0.5
    : Math.min(...summarised.map((x) => x.sortSeq));
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
  /** seq asc; with `activeOnly`, the active history in `sort_seq` order (summary before the tail). */
  listMessages(
    s: OwnerScope,
    threadId: string,
    opts?: { activeOnly?: boolean },
  ): Promise<MessageRecord[]>;
  /** Assigns seq = max+1…, bumps last_message_at. */
  appendMessages(s: OwnerScope, threadId: string, msgs: NewMessage[]): Promise<MessageRecord[]>;
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
  /** The thread's newest finished (`done`) chat run, for the compaction trigger; null if none. */
  getLastChatRun(s: OwnerScope, threadId: string): Promise<RunRecord | null>;
  /** Inserts a finished run (`finished_at` = now); the thread must be the owner's. */
  recordRun(s: OwnerScope, r: RecordedRun): Promise<void>;

  // ─── Memory ───
  /** The owner's stores, by store name. */
  getMemory(s: OwnerScope): Promise<MemoryStoreRecord[]>;
  /** Replaces the store's entries (upsert); limits and the safety scan are the caller's job. */
  saveMemoryStore(s: OwnerScope, store: string, entries: MemoryEntry[]): Promise<MemoryStoreRecord>;

  // ─── Proposals ───
  /** Status `pending`; the thread must be the owner's. */
  createProposal(s: OwnerScope, p: NewProposal): Promise<ProposalRecord>;
  /** created_at asc; the thread must be the owner's. */
  listProposals(s: OwnerScope, threadId: string): Promise<ProposalRecord[]>;
  getProposal(s: OwnerScope, id: string): Promise<ProposalRecord | null>;
  /**
   * Atomic guard: moves the proposal to `to` only if its status is one of `from` (one
   * conditional UPDATE). Null when no row changed (absent, another owner's, or another status),
   * so of two concurrent approvals exactly one wins.
   */
  transitionProposal(
    s: OwnerScope,
    id: string,
    from: ProposalStatus[],
    to: ProposalStatus,
    patch?: ProposalPatch,
  ): Promise<ProposalRecord | null>;
  /** Pending proposals with `expires_at < now` become `expired`; returns how many. */
  expireProposals(s: OwnerScope, now: Date): Promise<number>;

  // ─── Compaction ───
  /**
   * In one transaction: deactivates the middle, prunes tool results, inserts the summary row,
   * and updates the thread's system prompt, `compacted_at`, `compaction_saved_pcts` (last two)
   * and `cache_root_id` (set to the thread id when still null). Returns the summary row.
   */
  applyCompaction(s: OwnerScope, threadId: string, c: CompactionInput): Promise<MessageRecord>;
  markCompactionFailed(s: OwnerScope, threadId: string, at: Date): Promise<void>;
}

export const ASSISTANT_REPOSITORY = Symbol('ASSISTANT_REPOSITORY');
