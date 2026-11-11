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
  template: CareTemplateKey;
  step: number;
  level: AutonomyLevel;
  text: string;
  status: CareMessageStatus;
  skipReason: string | null;
  windowClosesAt: Date | null;
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

  /** Takes one message of the day atomically (`count < limit`); `null` limit = unlimited. */
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
   * audit row (`care.message.drafted|sending|skipped`, actor `ai:care`).
   */
  insertMessage(ws: WorkspaceId, m: NewCareMessage): Promise<void>;
  getMessage(ws: WorkspaceId, id: string): Promise<CareMessage | null>;
  /** A conversation's care messages, newest first (≤ `limit`). */
  messagesOf(ws: WorkspaceId, conversationId: string, limit: number): Promise<CareMessage[]>;
  /** Drafts waiting for a person, newest first (≤ `limit`). */
  drafts(ws: WorkspaceId, limit: number): Promise<CareMessage[]>;
  /**
   * Takes a draft to send it: `draft` → `sending` with the decider, only while its window is open.
   * Null when it is no longer a draft or its window closed (then it is `expired`).
   */
  claimDraft(ws: WorkspaceId, id: string, by: string, now: Date): Promise<CareMessage | null>;
  /** Records the delivery: `sent` or `failed` (`reason`), the text that went out. */
  finishSend(
    ws: WorkspaceId,
    id: string,
    r: {
      status: 'sent' | 'failed';
      text: string;
      sentMessageId: string | null;
      reason: string | null;
      actor: string | null;
    },
    now: Date,
  ): Promise<void>;
  /** `draft` → `rejected` by a person; false when it was no longer a draft. */
  rejectDraft(ws: WorkspaceId, id: string, by: string, now: Date): Promise<boolean>;
  /** When the agent's messages to the conversation went out since `since`. */
  sentTimes(ws: WorkspaceId, conversationId: string, since: Date): Promise<Date[]>;
  /** Sent messages in `[since, until)`, newest first (≤ `limit`), optionally of one level. */
  sentBetween(
    ws: WorkspaceId,
    q: { since: Date; until: Date; level?: AutonomyLevel; limit: number },
  ): Promise<CareMessage[]>;
  /**
   * Worker pass, every business: drafts whose window closed → `expired`, sends stuck in
   * `sending` since `staleBefore` → `failed`. Returns how many changed.
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
