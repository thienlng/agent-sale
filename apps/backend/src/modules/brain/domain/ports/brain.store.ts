import type { WorkspaceId } from '@agent-sales/shared';

import type { BrainSettings } from '../schedule.js';
import type { ConversationSignal, SignalTrigger } from '../signal.js';

/** A due idle evaluation, claimed with a lease (`signal_jobs`). */
export interface SignalJob {
  workspaceId: WorkspaceId;
  conversationId: string;
  trigger: SignalTrigger;
  runAfter: Date;
  attempts: number;
}

/** One model call (`signal_runs`), for cost reporting. */
export interface SignalRunRecord {
  conversationId: string;
  trigger: SignalTrigger;
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
  putSettings(ws: WorkspaceId, s: BrainSettings): Promise<void>;

  getSignal(ws: WorkspaceId, conversationId: string): Promise<ConversationSignal | null>;
  signalsFor(ws: WorkspaceId, conversationIds: readonly string[]): Promise<ConversationSignal[]>;
  /** Insert or replace the row (the caller already bumped `version`). */
  saveSignal(ws: WorkspaceId, signal: ConversationSignal): Promise<void>;

  /**
   * Upserts the conversation's idle job (brief rule 1): `run_after = max(existing, due)`, status
   * back to `pending`. A capped job is also moved: the newer message makes it relevant again.
   */
  scheduleJob(ws: WorkspaceId, conversationId: string, due: Date): Promise<void>;
  /** Due `pending` jobs, or ones whose lease expired, leased for `leaseMs` (FOR UPDATE SKIP LOCKED). */
  claimDueJobs(now: Date, limit: number, leaseMs: number): Promise<SignalJob[]>;
  /**
   * Drops the job unless a newer message pushed it past `claimedRunAfter` meanwhile (then only
   * its lease is released, so it runs again later).
   */
  finishJob(ws: WorkspaceId, conversationId: string, claimedRunAfter: Date): Promise<void>;
  /** Cap reached: the job waits as `capped` until `until` (the next local day). */
  capJob(ws: WorkspaceId, conversationId: string, until: Date): Promise<void>;
  /** A failed call: retried at `retryAt` (attempt counted at claim). */
  retryJob(ws: WorkspaceId, conversationId: string, retryAt: Date): Promise<void>;
  /** The next day's first tick: capped jobs whose day has come are `pending` again. */
  resetCappedJobs(now: Date): Promise<number>;

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
