import type { WorkspaceId } from '@agent-sales/shared';

import type { AutonomyAction, AutonomyLevel } from '../autonomy.js';
import type { BrainSettings } from '../schedule.js';
import type { ConversationSignal, StageChange, SignalTrigger } from '../signal.js';

/** A due idle evaluation, claimed with a lease (`signal_jobs`). */
export interface SignalJob {
  workspaceId: WorkspaceId;
  conversationId: string;
  trigger: SignalTrigger;
  runAfter: Date;
  attempts: number;
}

/** One model call (`signal_runs`), for cost reporting: an evaluation, or a reply draft. */
export interface SignalRunRecord {
  conversationId: string;
  trigger: SignalTrigger | 'draft';
  tier: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  outcome: 'ok' | 'invalid' | 'error' | 'timeout';
}

/**
 * Persistence of the `brain` module. Tenant methods take the workspace and run under RLS; the
 * `claim…`/`reset…` methods are the worker's cross-tenant reads (app_system).
 */
export interface BrainStore {
  getSettings(ws: WorkspaceId): Promise<BrainSettings | null>;
  /** The stored autonomy levels of the business (actions without a row are absent). */
  getAutonomy(ws: WorkspaceId): Promise<{ action: AutonomyAction; level: AutonomyLevel }[]>;
  /** Upserts these levels and writes one audit row per action (`brain.autonomy.updated`). */
  putAutonomy(
    ws: WorkspaceId,
    rows: readonly { action: AutonomyAction; level: AutonomyLevel }[],
    actorId: string | null,
    now: Date,
  ): Promise<void>;
  putSettings(ws: WorkspaceId, s: BrainSettings): Promise<void>;

  getSignal(ws: WorkspaceId, conversationId: string): Promise<ConversationSignal | null>;
  signalsFor(ws: WorkspaceId, conversationIds: readonly string[]): Promise<ConversationSignal[]>;
  /**
   * Writes an evaluation. Only the model's columns are written (intent, mood, needs-a-person,
   * follow-up, note, `evaluated_until` (never moved back), `evaluated_at`, the customer link): the stage only when
   * the STORED row is not locked, and the stored dismissal is cleared only when
   * `lastCustomerMessageAt` is newer than it. So a member's lock, stage or dismissal written while
   * the model was answering survives. Bumps `version`; returns the stored row.
   */
  saveEvaluation(
    ws: WorkspaceId,
    signal: ConversationSignal,
    lastCustomerMessageAt: Date | null,
  ): Promise<ConversationSignal>;
  /** A member's stage change: writes only the stage and the lock (a blank row when none). */
  saveStage(
    ws: WorkspaceId,
    conversationId: string,
    contactId: string | null,
    change: StageChange,
    now: Date,
  ): Promise<ConversationSignal>;
  /** Today's dismiss: writes only `dismissed_until_message_after` (a blank row when none). */
  dismissSignal(
    ws: WorkspaceId,
    conversationId: string,
    contactId: string | null,
    at: Date,
  ): Promise<void>;
  /** Undoes a dismiss: clears `dismissed_until_message_after` (nothing when there is no row). */
  undismissSignal(ws: WorkspaceId, conversationId: string, at: Date): Promise<void>;

  /**
   * Upserts the conversation's idle job (brief rule 1): `run_after = max(existing, due)`, status
   * back to `pending`. A capped job is also moved: the newer message makes it relevant again.
   */
  scheduleJob(ws: WorkspaceId, conversationId: string, due: Date): Promise<void>;
  /** Due `pending` jobs, or ones whose lease expired, leased for `leaseMs` (FOR UPDATE SKIP LOCKED). */
  claimDueJobs(now: Date, limit: number, leaseMs: number): Promise<SignalJob[]>;
  /**
   * Drops the job unless a newer message pushed it past `claimedRunAfter` meanwhile (then its
   * lease is released and its attempts reset, so it runs again later).
   */
  finishJob(ws: WorkspaceId, conversationId: string, claimedRunAfter: Date): Promise<void>;
  /** Cap reached: the job waits as `capped` until `until` (the next local day); attempts reset. */
  capJob(ws: WorkspaceId, conversationId: string, until: Date): Promise<void>;
  /** A failed call: retried at `retryAt` (attempt counted at claim). */
  retryJob(ws: WorkspaceId, conversationId: string, retryAt: Date): Promise<void>;
  /**
   * The next day's first tick: capped jobs whose day has come are `pending` again, due at
   * `runAfter` (a little after now, so the day's fresh jobs, due already, are claimed first).
   */
  resetCappedJobs(now: Date, runAfter: Date): Promise<number>;

  /**
   * Takes one evaluation of the day atomically: `insert … on conflict do update set count =
   * count + 1 where count < limit returning` (brief rule 3). False = the cap is reached.
   * `limit: null` = unlimited (still counted).
   */
  reserveUsage(ws: WorkspaceId, day: string, limit: number | null): Promise<boolean>;
  /** Gives one reserved evaluation back (a failed call). Never below 0. */
  releaseUsage(ws: WorkspaceId, day: string): Promise<void>;
  usedOn(ws: WorkspaceId, day: string): Promise<number>;

  recordRun(ws: WorkspaceId, run: SignalRunRecord): Promise<void>;

  /**
   * The conversations whose signal may put them on Today (spec §5), ids only: complaint or needs a
   * person (`attention`), stage `ready` judged since `readySince`, stage `price_asked` whose
   * covered messages are not older than `priceSince`, or a follow-up due by `now`. At most
   * `limit`, most recently updated first.
   */
  todaySignalRefs(
    ws: WorkspaceId,
    q: { now: Date; readySince: Date; priceSince: Date; limit: number },
  ): Promise<TodaySignalRef[]>;
  /** Conversations with an idle evaluation waiting (customer messages not evaluated yet). */
  pendingJobIds(ws: WorkspaceId, limit: number): Promise<string[]>;
  /**
   * The morning briefing settings of these businesses (worker, cross-tenant); a business
   * without a row is absent (it has the defaults).
   */
  briefingStates(ids: readonly WorkspaceId[]): Promise<BriefingState[]>;
  /**
   * Takes today's briefing of the business: sets `last_briefing_day = day` unless it already is
   * `day` or later (a row with the defaults is created). False when another pass took it.
   */
  claimBriefing(ws: WorkspaceId, day: string): Promise<boolean>;
}

/** A conversation Today may list because of its signal. */
export interface TodaySignalRef {
  conversationId: string;
  /** Complaint or needs a person: the last staff reply decides whether it is listed. */
  attention: boolean;
}

/** `brain_settings` as the briefing pass reads it. */
export interface BriefingState {
  workspaceId: WorkspaceId;
  briefingEnabled: boolean;
  briefingHour: number;
  lastBriefingDay: string | null;
}
export const BRAIN_STORE = Symbol('BRAIN_STORE');

/** One `conversation.message.received.v1` row of the outbox. */
export interface MessageEventRow {
  id: number;
  workspaceId: WorkspaceId;
  conversationId: string;
  payload: unknown;
  createdAt: Date;
}

/** One pass over the outbox window, under an exclusive lease (like the analytics projector). */
export interface MessageEventLease {
  /** Events of the window with an id after `afterId`, oldest first. */
  readBatch(afterId: number, limit: number): Promise<MessageEventRow[]>;
  /** Moves the checkpoint to the end of the window. */
  commit(): Promise<void>;
}

export interface MessageEventSource {
  /** Runs `fn` with the lease; null when another worker holds it. */
  withLease<T>(fn: (lease: MessageEventLease) => Promise<T>): Promise<T | null>;
}
export const MESSAGE_EVENT_SOURCE = Symbol('MESSAGE_EVENT_SOURCE');
