import type { AutonomyLevel, CareMessageStatus, CareTemplateKey } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { MessageTemplate, StopReason } from '../care.js';

/** A business's stored template row (a missing row means the defaults). */
export interface CareTemplateRow {
  key: CareTemplateKey;
  enabled: boolean;
  instruction: string;
  params: { afterSaleDays?: number };
}

/** A due message step, claimed with a lease (`care_enrollments`). */
export interface CareJob {
  id: string;
  workspaceId: WorkspaceId;
  conversationId: string;
  template: MessageTemplate;
  step: number;
  anchorAt: Date;
  nextAt: Date;
  attempts: number;
}

/** One row of `care_messages`. */
export interface CareMessage {
  id: string;
  conversationId: string;
  enrollmentId: string | null;
  /** The customer message the step was written for (a send is refused if they wrote after). */
  anchorAt: Date;
  template: CareTemplateKey;
  step: number;
  level: AutonomyLevel;
  text: string;
  status: CareMessageStatus;
  skipReason: string | null;
  windowClosesAt: Date | null;
  /** When an approved message goes out (`scheduled`). */
  scheduledFor: Date | null;
  sentMessageId: string | null;
  sentAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** A new care message, with the cost of the model call that wrote it. */
export interface NewCareMessage {
  id: string;
  conversationId: string;
  enrollmentId: string | null;
  anchorAt: Date;
  template: CareTemplateKey;
  step: number;
  level: AutonomyLevel;
  text: string;
  status: 'draft' | 'sending' | 'skipped';
  skipReason: string | null;
  windowClosesAt: Date | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
}

/**
 * Persistence of the `care` module. Tenant methods take the workspace and run under RLS (each
 * agent action also writes an audit row, actor `ai:care`); `claimDue` and `expireDue` are the
 * worker's cross-tenant passes (app_system).
 */
export interface CareStore {
  templates(ws: WorkspaceId): Promise<CareTemplateRow[]>;
  putTemplate(ws: WorkspaceId, row: CareTemplateRow, now: Date): Promise<void>;

  /**
   * Takes one message of the day atomically (`count < limit`); `null` limit = unlimited; a limit
   * of 0 takes nothing and writes nothing.
   */
  reserveUsage(ws: WorkspaceId, day: string, limit: number | null): Promise<boolean>;
  releaseUsage(ws: WorkspaceId, day: string): Promise<void>;
  usedOn(ws: WorkspaceId, day: string): Promise<number>;

  /**
   * Starts (or restarts) the cycle of a conversation and template: inserted at step 0, or reset
   * to step 0 / active when the stored cycle is for an older anchor. False when a cycle for this
   * anchor (or a newer one) already exists, whatever its status.
   */
  enroll(
    ws: WorkspaceId,
    e: { conversationId: string; template: CareTemplateKey; anchorAt: Date; nextAt: Date },
    now: Date,
  ): Promise<boolean>;
  /**
   * Stops the active cycles of a conversation for these templates (`onlyDueBy`: only those due
   * by then, for after-sales) and expires its drafts. Returns how many cycles stopped.
   */
  stopConversation(
    ws: WorkspaceId,
    conversationId: string,
    templates: readonly CareTemplateKey[],
    reason: StopReason,
    now: Date,
    onlyDueBy?: Date,
  ): Promise<number>;
  /** Due active message cycles of every business, leased (FOR UPDATE SKIP LOCKED). */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<CareJob[]>;
  /** Moves the cycle to `step` due at `nextAt` (lease released, attempts reset). */
  advance(ws: WorkspaceId, id: string, step: number, nextAt: Date, now: Date): Promise<void>;
  /** The cycle ran its last step. */
  finish(ws: WorkspaceId, id: string, now: Date): Promise<void>;
  /** The cycle stops (and the conversation's drafts expire). */
  stop(ws: WorkspaceId, id: string, reason: StopReason, now: Date): Promise<void>;
  /** The same step runs again at `at` (lease released; attempts kept unless `resetAttempts`). */
  reschedule(ws: WorkspaceId, id: string, at: Date, resetAttempts: boolean): Promise<void>;
  /** After-sales check-ins due before `before` and listed (due less than 7 days ago). */
  afterSaleDue(ws: WorkspaceId, before: Date, now: Date): Promise<string[]>;

  /**
   * Writes a message the agent wrote; a new draft expires the conversation's older drafts. One
   * audit row (`care.message.drafted|sending|skipped`, actor `ai:care`). False (nothing written)
   * when this step of the cycle (enrollment, anchor, step) already has a message: a step is
   * written and sent once, even when a crashed or doubled run repeats it.
   */
  insertMessage(ws: WorkspaceId, m: NewCareMessage): Promise<boolean>;
  /** The message of one step of a cycle, if it was written already. */
  stepMessage(
    ws: WorkspaceId,
    enrollmentId: string,
    anchorAt: Date,
    step: number,
  ): Promise<CareMessage | null>;
  getMessage(ws: WorkspaceId, id: string): Promise<CareMessage | null>;
  /** A conversation's care messages, newest first (≤ `limit`). */
  messagesOf(ws: WorkspaceId, conversationId: string, limit: number): Promise<CareMessage[]>;
  /** Drafts waiting for a person, newest first (≤ `limit`). */
  drafts(ws: WorkspaceId, limit: number): Promise<CareMessage[]>;
  /** Approved messages waiting for their time (`scheduled`), soonest first (≤ `limit`). */
  scheduled(ws: WorkspaceId, limit: number): Promise<CareMessage[]>;
  /**
   * A person approves a draft, only while its window is open: `draft` → `sending` (sent now), or
   * → `scheduled` at `sendAt` when given (quiet hours, or queued for the worker's next tick); `text` replaces the draft's text when given. Null when it is no longer a draft or
   * its window closed (then it is `expired`).
   */
  claimDraft(
    ws: WorkspaceId,
    id: string,
    by: string,
    now: Date,
    opts?: { text?: string | undefined; sendAt?: Date | undefined },
  ): Promise<CareMessage | null>;
  /** Approved messages of every business whose time came (`scheduled`, `send_at <= now`). */
  dueScheduled(now: Date, limit: number): Promise<{ workspaceId: WorkspaceId; id: string }[]>;
  /** Takes a due scheduled message to send it (`scheduled` → `sending`); null when gone. */
  claimScheduled(ws: WorkspaceId, id: string, now: Date): Promise<CareMessage | null>;
  /** A scheduled message waits until `at` (the per-conversation limit). */
  deferScheduled(ws: WorkspaceId, id: string, at: Date, now: Date): Promise<void>;
  /**
   * A draft or scheduled message will not go out (a stop rule, the window, a takeover):
   * → `expired` with the reason. False when it was in neither state.
   */
  expireMessage(ws: WorkspaceId, id: string, reason: string, now: Date): Promise<boolean>;
  /**
   * Records the delivery: `sent`, `failed` (the channel refused it) or `expired` (the
   * conversation refused it: the customer wrote, a person took over, closed, out of the window),
   * the text that went out and the reason.
   */
  finishSend(
    ws: WorkspaceId,
    id: string,
    r: {
      status: 'sent' | 'failed' | 'expired';
      text: string;
      sentMessageId: string | null;
      reason: string | null;
      actor: string | null;
    },
    now: Date,
  ): Promise<void>;
  /** `draft` → `rejected` by a person; false when it was no longer a draft. */
  rejectDraft(ws: WorkspaceId, id: string, by: string, now: Date): Promise<boolean>;
  /**
   * When the agent's messages to the conversation went out (or will: `sending`, `scheduled` at
   * their time, a send interrupted by a crash) since `since`, but `exceptId`. For the limit of 2
   * per 24 hours, which must also count a send whose outcome is unknown.
   */
  sentTimes(
    ws: WorkspaceId,
    conversationId: string,
    since: Date,
    exceptId?: string,
  ): Promise<Date[]>;
  /** Sent messages in `[since, until)`, newest first (≤ `limit`), optionally of one level. */
  sentBetween(
    ws: WorkspaceId,
    q: { since: Date; until: Date; level?: AutonomyLevel; limit: number },
  ): Promise<CareMessage[]>;
  /**
   * Worker pass, every business: drafts and scheduled messages whose window closed → `expired`,
   * sends stuck in `sending` since `staleBefore` → `failed`, after-sales check-ins no longer
   * listed (due more than 7 days ago) → `done`. Returns how many changed.
   */
  expireDue(now: Date, staleBefore: Date): Promise<number>;
}
export const CARE_STORE = Symbol('CARE_STORE');

/** One outbox event the care module reads. */
export interface CareEventRow {
  id: number;
  workspaceId: WorkspaceId;
  type: string;
  aggregateId: string;
  payload: unknown;
  createdAt: Date;
}

export interface CareEventLease {
  /** Events of the window with an id after `afterId`, oldest first. */
  readBatch(afterId: number, limit: number): Promise<CareEventRow[]>;
  commit(): Promise<void>;
}

export interface CareEventSource {
  /** Runs `fn` with the exclusive lease; null when another worker holds it. */
  withLease<T>(fn: (lease: CareEventLease) => Promise<T>): Promise<T | null>;
}
export const CARE_EVENT_SOURCE = Symbol('CARE_EVENT_SOURCE');
