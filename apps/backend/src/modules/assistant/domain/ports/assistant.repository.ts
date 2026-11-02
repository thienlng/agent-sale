import type { OwnerScope } from '../owner-scope.js';
import type {
  Cadence,
  ScheduleChannel,
  ScheduleCreatedBy,
  ScheduleMode,
  SchedulePausedReason,
  ScheduleRunStatus,
  ScheduleRunTrigger,
  ScheduleStatus,
  ScheduleTemplate,
} from '../schedule.js';

/**
 * The account and owner a repository call is limited to. Every `OwnerScope` is one; the worker
 * (review, curator) builds one from a claimed job, and `withAccount` still applies RLS.
 */
export type OwnerKey = Pick<OwnerScope, 'accountId' | 'ownerUserId'>;

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
  /** Owner turns since the last review (review trigger counter). */
  reviewOwnerTurns: number;
  /** Tool-loop rounds since the last review (review trigger counter). */
  reviewToolRounds: number;
  lastReviewAt: Date | null;
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
  /** The owner's 👍 (1) or 👎 (-1) on an assistant answer; null = none. */
  feedback: MessageFeedback | null;
  createdAt: Date;
}

export type MessageFeedback = -1 | 1;

/** A message to append: the repository assigns `seq`, `createdAt` and the thread. */
export type NewMessage = Omit<
  MessageRecord,
  'seq' | 'createdAt' | 'threadId' | 'isSummary' | 'feedback'
>;

export interface RunRecord {
  id: string;
  threadId: string | null;
  /**
   * `chat` = an owner turn; `compaction` = one summariser call (tier `basic`); `schedule` = one
   * report commentary call (tier `basic`, no thread).
   */
  kind: 'chat' | 'compaction' | 'schedule';
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

/** `route` = a declared route; `schedule` = a schedule create/edit/remove (T-172). */
export type ProposalKind = 'route' | 'schedule' | 'product_import';

/** A write the model drafted; it runs only when the owner approves it. */
export interface ProposalRecord {
  id: string;
  kind: ProposalKind;
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
> & { kind?: ProposalKind };

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

// ─── Skills (1c) ───

export type SkillProvenance = 'owner' | 'learned' | 'shadow';
export type SkillState = 'pending_approval' | 'active' | 'stale' | 'archived';

/** An owner, learned or shadow skill (platform skills are files, never records). */
export interface SkillRecord {
  id: string;
  /** `^[a-z0-9][a-z0-9-]*$`, ≤ 64; unique per owner among non-archived skills. */
  name: string;
  /** ≤ 120 chars. */
  description: string;
  /** ≤ 8 000 chars. */
  body: string;
  toolsets: string[];
  provenance: SkillProvenance;
  /** The platform skill a `shadow` replaces; null otherwise. */
  shadowOf: string | null;
  state: SkillState;
  pinned: boolean;
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt: Date | null;
  lastPatchedAt: Date | null;
  createdAt: Date;
  /** Millisecond precision; the optimistic-concurrency token of `updateSkill`. */
  updatedAt: Date;
}

export type NewSkill = Pick<
  SkillRecord,
  'id' | 'name' | 'description' | 'body' | 'toolsets' | 'provenance' | 'shadowOf' | 'state'
> & { pinned?: boolean };

export interface SkillPatch {
  name?: string;
  description?: string;
  body?: string;
  toolsets?: string[];
  state?: SkillState;
  pinned?: boolean;
  /** A content patch: `patch_count` + 1 and `last_patched_at` = now. */
  countPatch?: boolean;
}

/** What the ledger keeps of a skill before and after a change. */
export interface SkillSnapshot {
  name: string;
  description: string;
  body: string;
  state: SkillState;
}

export const skillSnapshot = (x: SkillSnapshot): SkillSnapshot => ({
  name: x.name,
  description: x.description,
  body: x.body,
  state: x.state,
});

export type SkillActor = 'owner' | 'assistant' | 'review' | 'curator';
export type SkillAction =
  'create' | 'patch' | 'archive' | 'restore' | 'approve' | 'reject' | 'undo';

export interface SkillEventRecord {
  id: string;
  skillId: string;
  actor: SkillActor;
  action: SkillAction;
  before: SkillSnapshot | null;
  after: SkillSnapshot | null;
  runId: string | null;
  undoneAt: Date | null;
  createdAt: Date;
}

export type NewSkillEvent = Pick<
  SkillEventRecord,
  'id' | 'skillId' | 'actor' | 'action' | 'before' | 'after' | 'runId'
>;

/**
 * The ledger entry written in the same transaction as a skill create/update; the repository
 * fills `skillId`, `before` and `after` from the rows.
 */
export type SkillEventInput = Pick<SkillEventRecord, 'id' | 'actor' | 'action' | 'runId'>;

/** `skillId` = one skill's history; `since` = the owner's entries from then on. Newest first. */
export interface SkillEventQuery {
  skillId?: string;
  since?: Date;
  actor?: SkillActor;
  limit?: number;
}

/** Skill ledger rows listed at most. */
export const SKILL_EVENT_LIST_LIMIT = 200;

// ─── Suggestions (1c) ───

export type SuggestionKind = 'schedule' | 'skill' | 'setup';
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface SuggestionRecord {
  id: string;
  kind: SuggestionKind;
  /** ≤ 120 chars; unique per owner in every status (a dismissal is permanent). */
  dedupKey: string;
  /** ≤ 200 chars. */
  title: string;
  payload: Record<string, unknown>;
  status: SuggestionStatus;
  createdAt: Date;
  decidedAt: Date | null;
}

export type NewSuggestion = Pick<
  SuggestionRecord,
  'id' | 'kind' | 'dedupKey' | 'title' | 'payload'
>;

// ─── Settings (1c) ───

export interface AssistantSettingsRecord {
  reviewEnabled: boolean;
  disabledToolsets: string[];
  /** When the curator last scanned the owner's learned skills; null = never. */
  curatorRanAt: Date | null;
  /** Null when the owner has no row yet (the defaults). */
  updatedAt: Date | null;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettingsRecord = {
  reviewEnabled: true,
  disabledToolsets: [],
  curatorRanAt: null,
  updatedAt: null,
};

export type SettingsPatch = Partial<
  Pick<AssistantSettingsRecord, 'reviewEnabled' | 'disabledToolsets' | 'curatorRanAt'>
>;

// ─── Review counters and jobs (1c) ───

export interface ReviewCounters {
  ownerTurns: number;
  toolRounds: number;
  lastReviewAt: Date | null;
}

export type JobKind = 'review' | 'curator';
export type ReviewScope = 'memory' | 'skills' | 'combined';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  accountId: string;
  ownerUserId: string;
  threadId: string | null;
  kind: JobKind;
  /** Set for `review` jobs only. */
  reviewScope: ReviewScope | null;
  status: JobStatus;
  runAfter: Date;
  leaseUntil: Date | null;
  /** Claims so far; also the fence of `finishJob` (a re-claimed job ignores the old holder). */
  attempts: number;
  errorCode: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface NewJob {
  id: string;
  /** Null for a curator job. */
  threadId: string | null;
  kind: JobKind;
  reviewScope: ReviewScope | null;
  runAfter: Date;
}

/** A job whose lease lapsed this many times is failed (`lease_expired`), not claimed again. */
export const JOB_MAX_ATTEMPTS = 3;

// ─── Schedules (T-172) ───

export interface ScheduleRecord {
  id: string;
  accountId: string;
  ownerUserId: string;
  businessId: string;
  /** ≤ 80 chars, safety-scanned before it is stored. */
  name: string;
  template: ScheduleTemplate;
  mode: ScheduleMode;
  params: Record<string, unknown>;
  cadence: Cadence;
  /** Always contains `in_app`. */
  channels: ScheduleChannel[];
  commentary: boolean;
  status: ScheduleStatus;
  pausedReason: SchedulePausedReason | null;
  /** Null while paused. */
  nextRunAt: Date | null;
  /** Set by "Chạy ngay"; the runner clears it. */
  runRequestedAt: Date | null;
  leaseUntil: Date | null;
  consecutiveFailures: number;
  lastRunAt: Date | null;
  lastCheckedAt: Date | null;
  alertFingerprint: string | null;
  lastAlertedAt: Date | null;
  /** `new_orders` alerts: orders placed at or after it are new. */
  alertCursor: Date | null;
  createdBy: ScheduleCreatedBy;
  createdAt: Date;
  /** Millisecond precision; the optimistic-concurrency token of `updateSchedule`. */
  updatedAt: Date;
}

export type NewSchedule = Pick<
  ScheduleRecord,
  | 'id'
  | 'businessId'
  | 'name'
  | 'template'
  | 'mode'
  | 'params'
  | 'cadence'
  | 'channels'
  | 'commentary'
  | 'createdBy'
  | 'nextRunAt'
> &
  Partial<Pick<ScheduleRecord, 'status' | 'pausedReason' | 'alertCursor'>>;

/** An owner edit (or the service on their behalf); bumps `updated_at`. */
export type SchedulePatch = Partial<
  Pick<
    ScheduleRecord,
    | 'businessId'
    | 'name'
    | 'template'
    | 'mode'
    | 'params'
    | 'cadence'
    | 'channels'
    | 'commentary'
    | 'status'
    | 'pausedReason'
    | 'nextRunAt'
    | 'runRequestedAt'
    | 'consecutiveFailures'
    | 'alertFingerprint'
    | 'lastAlertedAt'
    | 'alertCursor'
  >
>;

/** The runner's bookkeeping; `saveScheduleState` also clears the lease. */
export type ScheduleStatePatch = Partial<
  Pick<
    ScheduleRecord,
    | 'status'
    | 'pausedReason'
    | 'nextRunAt'
    | 'runRequestedAt'
    | 'consecutiveFailures'
    | 'lastRunAt'
    | 'lastCheckedAt'
    | 'alertFingerprint'
    | 'lastAlertedAt'
    | 'alertCursor'
  >
>;

export interface ScheduleRunRecord {
  id: string;
  accountId: string;
  ownerUserId: string;
  scheduleId: string;
  trigger: ScheduleRunTrigger;
  scheduledFor: Date;
  status: ScheduleRunStatus;
  errorCode: string | null;
  /** Template id, period and figures; no customer PII (S3-R9), ≤ 16 KB. */
  report: Record<string, unknown> | null;
  title: string | null;
  body: string | null;
  commentaryRunId: string | null;
  notificationId: string | null;
  /** The `origin: schedule` thread "Hỏi trợ lý" created (S3-R10). */
  threadId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export type NewScheduleRun = Pick<
  ScheduleRunRecord,
  'id' | 'accountId' | 'ownerUserId' | 'scheduleId' | 'trigger' | 'scheduledFor'
> &
  Partial<Pick<ScheduleRunRecord, 'status' | 'errorCode' | 'finishedAt'>>;

export type ScheduleRunPatch = Partial<
  Pick<
    ScheduleRunRecord,
    | 'status'
    | 'errorCode'
    | 'report'
    | 'title'
    | 'body'
    | 'commentaryRunId'
    | 'notificationId'
    | 'finishedAt'
  >
>;

/** Runs listed per schedule at most. */
export const SCHEDULE_RUN_LIST_LIMIT = 50;

/** Threads listed per page. */
export const THREAD_LIST_LIMIT = 50;
/** A running run older than this no longer blocks a new one (crashed process). */
export const RUN_BUSY_WINDOW_MS = 3 * 60_000;

/**
 * Account-scoped storage of one owner's assistant data (ADR-023). Every method is limited to
 * `s.accountId` AND `s.ownerUserId`: a thread or run of another owner, even in the same
 * account, behaves as absent. Methods taking a `threadId` or `runId` verify, in the same
 * transaction, that it is the owner's (the `thread_id` foreign keys alone do not carry the
 * owner) and throw `AssistantNotFoundError` otherwise.
 */
export interface AssistantRepository {
  /** ≤ 50, pinned first, then last_message_at desc; `text` matches the title or a message. */
  listThreads(s: OwnerScope, q: { archived: boolean; text?: string }): Promise<ThreadRecord[]>;
  getThread(s: OwnerScope, threadId: string): Promise<ThreadRecord | null>;
  /** `origin` defaults to `chat`; a report thread is `schedule` (S3-R10). */
  createThread(
    s: OwnerScope,
    t: {
      id: string;
      title: string;
      systemPrompt: string;
      promptVersion: string;
      origin?: 'chat' | 'schedule';
    },
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

  // ─── Skills (1c) ───
  // Methods taking an `OwnerKey` also serve the worker: it passes the claimed job's account and
  // owner, and the call still runs under `withAccount` (RLS).

  /** By name; all states unless `states` narrows it. */
  listSkills(
    s: OwnerKey,
    q?: { states?: SkillState[]; provenance?: SkillProvenance[] },
  ): Promise<SkillRecord[]>;
  getSkill(s: OwnerKey, id: string): Promise<SkillRecord | null>;
  /** The non-archived skill with this name (unique per owner). */
  getSkillByName(s: OwnerKey, name: string): Promise<SkillRecord | null>;
  /**
   * Inserts the skill and, when given, its `create` ledger entry (before = null) in the same
   * transaction. A non-archived skill of that name throws `AssistantSkillNameTakenError`.
   */
  createSkill(s: OwnerKey, skill: NewSkill, event?: SkillEventInput): Promise<SkillRecord>;
  /**
   * Applies the patch and bumps `updated_at`. With `expectedUpdatedAt`, only if the row still
   * has it (optimistic lock). With `event`, appends the ledger entry with the before/after
   * snapshots in the same transaction. Null when absent, another owner's, or stale. A name
   * taken by another non-archived skill throws `AssistantSkillNameTakenError`.
   */
  updateSkill(
    s: OwnerKey,
    id: string,
    patch: SkillPatch,
    opts?: { expectedUpdatedAt?: Date; event?: SkillEventInput },
  ): Promise<SkillRecord | null>;
  /** `use`: use_count + 1 and last_used_at = now; `view`: view_count + 1. Leaves updated_at. */
  bumpSkillCounter(s: OwnerKey, id: string, counter: 'use' | 'view'): Promise<void>;
  /** The skill must be the owner's (`AssistantNotFoundError` otherwise). */
  appendSkillEvent(s: OwnerKey, e: NewSkillEvent): Promise<SkillEventRecord>;
  /** Newest first, at most `limit` (default and cap `SKILL_EVENT_LIST_LIMIT`). */
  listSkillEvents(s: OwnerKey, q: SkillEventQuery): Promise<SkillEventRecord[]>;
  getSkillEvent(s: OwnerKey, id: string): Promise<SkillEventRecord | null>;
  /** Atomic guard: sets `undone_at` only if still null; null when no row changed. */
  markSkillEventUndone(s: OwnerKey, id: string, at: Date): Promise<SkillEventRecord | null>;

  // ─── Suggestions (1c) ───

  /** Newest first; all statuses unless `status` narrows it. */
  listSuggestions(s: OwnerKey, q?: { status?: SuggestionStatus }): Promise<SuggestionRecord[]>;
  /**
   * Inserts a `pending` suggestion. A `dedup_key` the owner already has, in any status, is
   * ignored: returns null and changes nothing (a dismissal stays permanent).
   */
  upsertSuggestion(s: OwnerKey, x: NewSuggestion): Promise<SuggestionRecord | null>;
  /** Atomic guard: decides a `pending` suggestion; null when absent or already decided. */
  decideSuggestion(
    s: OwnerKey,
    id: string,
    status: 'accepted' | 'dismissed',
    at: Date,
  ): Promise<SuggestionRecord | null>;

  // ─── Settings (1c) ───

  /** `DEFAULT_ASSISTANT_SETTINGS` when the owner has no row. */
  getSettings(s: OwnerKey): Promise<AssistantSettingsRecord>;
  /** Upsert; fields left out keep their value (or the default). */
  saveSettings(s: OwnerKey, patch: SettingsPatch): Promise<AssistantSettingsRecord>;

  // ─── Feedback (1c) ───

  /**
   * Sets (or, with null, clears) the owner's 👍/👎 on an assistant message of their own thread.
   * Any other message (another owner's, a user or tool row, a summary) throws
   * `AssistantNotFoundError`.
   */
  setFeedback(s: OwnerKey, messageId: string, value: MessageFeedback | null): Promise<void>;

  // ─── Review counters (1c) ───

  /** Adds to the thread's counters and returns the new values. */
  bumpReviewCounters(
    s: OwnerKey,
    threadId: string,
    by: { ownerTurns: number; toolRounds: number },
  ): Promise<ReviewCounters>;
  /**
   * Zeroes both counters, or only `only`. With `reviewedAt` (a review was enqueued or ran),
   * also sets `last_review_at`.
   */
  resetReviewCounters(
    s: OwnerKey,
    threadId: string,
    opts?: { only?: 'ownerTurns' | 'toolRounds'; reviewedAt?: Date },
  ): Promise<ReviewCounters>;

  // ─── Jobs (1c) ───

  /**
   * At most one `queued` job per owner, thread and kind: when one exists its `run_after` and
   * `review_scope` are updated (its id is kept); otherwise `j` is inserted. The thread, when
   * given, must be the owner's.
   */
  enqueueJob(s: OwnerKey, j: NewJob): Promise<JobRecord>;
  getJob(s: OwnerKey, id: string): Promise<JobRecord | null>;
  /**
   * Worker, across accounts (`app_system`): leases up to `limit` due jobs (`queued` with
   * `run_after <= now`, or `running` with a lapsed lease) with `FOR UPDATE SKIP LOCKED`, so two
   * claimers never get the same job. Each becomes `running`, `lease_until = now + leaseMs`,
   * `attempts + 1`. A lapsed job already at `JOB_MAX_ATTEMPTS` is failed (`lease_expired`).
   */
  claimJobs(now: Date, limit: number, leaseMs: number): Promise<JobRecord[]>;
  /**
   * Fenced by `attempts`: applies only while the job is `running` with the attempts of the
   * claim. False when it was cancelled or re-claimed meanwhile.
   */
  finishJob(
    s: OwnerKey,
    job: { id: string; attempts: number },
    outcome: { status: 'done' | 'failed'; errorCode?: string | null },
  ): Promise<boolean>;
  /**
   * Cancels `queued` or `running` jobs: one by id, or every one of a thread and kind (a new
   * owner message cancels the thread's pending review). Returns how many changed.
   */
  cancelJob(
    s: OwnerKey,
    target: { id: string } | { threadId: string; kind: JobKind },
  ): Promise<number>;

  // ─── Curator (1c) ───

  /** The owner's learned skills in `active` or `stale` state, by name. */
  listLearnedSkillsForCurator(s: OwnerKey): Promise<SkillRecord[]>;
  /**
   * Worker, across accounts (`app_system`): owners with a learned skill in `active` or `stale`
   * state. With `ranBefore`, only owners whose curator last ran before it (or never).
   */
  ownersWithLearnedSkills(opts?: { ranBefore?: Date }): Promise<OwnerKey[]>;

  // ─── Schedules (T-172) ───
  // Owner methods filter on the account AND the owner; another owner's schedule is absent.

  /** Oldest first. */
  listSchedules(s: OwnerKey): Promise<ScheduleRecord[]>;
  getSchedule(s: OwnerKey, id: string): Promise<ScheduleRecord | null>;
  /** Active and paused alike. */
  countSchedules(s: OwnerKey): Promise<number>;
  createSchedule(s: OwnerKey, row: NewSchedule): Promise<ScheduleRecord>;
  /**
   * Applies the patch and bumps `updated_at`. With `expectedUpdatedAt`, only if the row still
   * has it. Null when absent, another owner's, or stale.
   */
  updateSchedule(
    s: OwnerKey,
    id: string,
    patch: SchedulePatch,
    expectedUpdatedAt?: Date,
  ): Promise<ScheduleRecord | null>;
  /** Hard delete (runs cascade). False when absent or another owner's. */
  deleteSchedule(s: OwnerKey, id: string): Promise<boolean>;
  /** Newest first (`started_at` desc), at most `limit` (capped at `SCHEDULE_RUN_LIST_LIMIT`). */
  listScheduleRuns(s: OwnerKey, scheduleId: string, limit: number): Promise<ScheduleRunRecord[]>;
  getScheduleRun(s: OwnerKey, runId: string): Promise<ScheduleRunRecord | null>;
  /**
   * Sets the run's thread only while it is null, and returns the stored thread id (the earlier
   * one when it was already set). Null when the run is absent or another owner's.
   */
  setRunThread(s: OwnerKey, runId: string, threadId: string): Promise<string | null>;
  /** The owner's pending, unexpired `schedule` proposals that create a schedule. */
  countPendingScheduleProposals(s: OwnerKey, now?: Date): Promise<number>;

  /**
   * Worker, across accounts (`app_system`): leases up to `limit` due schedules with
   * `FOR UPDATE SKIP LOCKED` and `lease_until = now + leaseMs`, so two claimers never get the
   * same one. Due = `active` and (`next_run_at <= now` or `run_requested_at` set) with no live
   * lease. Ordered by `next_run_at`.
   */
  claimDueSchedules(now: Date, limit: number, leaseMs: number): Promise<ScheduleRecord[]>;
  /** Worker: `ON CONFLICT (schedule_id, scheduled_for) DO NOTHING`; null on conflict. */
  insertScheduleRun(row: NewScheduleRun): Promise<ScheduleRunRecord | null>;
  /**
   * Worker: the run of a slot, whatever its status; null when the slot has none. The runner
   * resumes a `running` one a crashed worker left behind.
   */
  getScheduleRunAt(scheduleId: string, scheduledFor: Date): Promise<ScheduleRunRecord | null>;
  /** Worker: patches a run by id. */
  finishScheduleRun(id: string, patch: ScheduleRunPatch): Promise<void>;
  /** Worker: patches the schedule's runner state and clears `lease_until`. */
  saveScheduleState(id: string, patch: ScheduleStatePatch): Promise<void>;
  /** Worker: deletes runs started before `before`; returns how many. */
  purgeOldScheduleRuns(before: Date): Promise<number>;
}

export const ASSISTANT_REPOSITORY = Symbol('ASSISTANT_REPOSITORY');
