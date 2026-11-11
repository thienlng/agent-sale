import type { SignalMood, SignalStage, SignalTrigger } from '@agent-sales/contracts';

import type { EvaluationOutput } from './evaluation-prompt.js';

export type { SignalMood, SignalStage, SignalTrigger };

/** The stored judgement of one conversation (`conversation_signals`). */
export interface ConversationSignal {
  conversationId: string;
  contactId: string | null;
  stage: SignalStage;
  intent: string | null;
  mood: SignalMood;
  needsHuman: boolean;
  needsHumanReason: string | null;
  followUpAt: Date | null;
  followUpReason: string | null;
  note: string | null;
  evaluatedUntil: Date | null;
  evaluatedAt: Date | null;
  stageLocked: boolean;
  dismissedUntilMessageAfter: Date | null;
  version: number;
  updatedAt: Date;
}

/** A conversation that was never evaluated: the defaults of the table. */
export function blankSignal(
  conversationId: string,
  contactId: string | null,
  now: Date,
): ConversationSignal {
  return {
    conversationId,
    contactId,
    stage: 'new',
    intent: null,
    mood: 'neutral',
    needsHuman: false,
    needsHumanReason: null,
    followUpAt: null,
    followUpReason: null,
    note: null,
    evaluatedUntil: null,
    evaluatedAt: null,
    stageLocked: false,
    dismissedUntilMessageAfter: null,
    version: 0,
    updatedAt: now,
  };
}

/**
 * `evaluated_until` is the exact channel time of the last message an evaluation covered, so "is
 * there something new" never pays again for covered messages. Accepted limit: a message stored
 * late (a webhook behind its channel time) that is older than a covered one is not sent to the
 * model; the member still sees it in the inbox, and the next customer message is evaluated.
 */
/** What one evaluation covered: the last message read and the last customer message among them. */
export interface EvaluationCoverage {
  /** Time of the last message the model saw: `evaluated_until`. */
  lastMessageAt: Date;
  /** Time of the newest customer message the model saw; null when it saw none. */
  lastCustomerMessageAt: Date | null;
  contactId: string | null;
}

/** `evaluated_until` of an evaluation: the last covered message, never moving back. */
export function evaluatedUntil(prev: Date | null, lastMessageAt: Date): Date {
  return new Date(Math.max(lastMessageAt.getTime(), prev?.getTime() ?? Number.NEGATIVE_INFINITY));
}

/** A customer message after this time is new: one the last evaluation did not cover. */
export function newAfter(s: ConversationSignal | null): number {
  return s?.evaluatedUntil?.getTime() ?? Number.NEGATIVE_INFINITY;
}

/**
 * Write rules of an evaluation (spec §3.1, brief rule 5):
 * - a stage a member set by hand (`stage_locked`) is kept; otherwise the model's stage wins;
 * - `evaluated_until` becomes the time of the last covered message (`evaluatedUntil`);
 * - a dismissal (hidden until a newer customer message) is cleared only when a customer message
 *   newer than it was covered; otherwise it stays.
 * Every other field is the model's answer. The version is bumped.
 */
export function applyEvaluation(
  prev: ConversationSignal,
  out: EvaluationOutput,
  cover: EvaluationCoverage,
  now: Date,
): ConversationSignal {
  const dismissed = prev.dismissedUntilMessageAfter;
  const keepDismissal =
    dismissed !== null &&
    (cover.lastCustomerMessageAt === null ||
      cover.lastCustomerMessageAt.getTime() <= dismissed.getTime());
  return {
    ...prev,
    contactId: cover.contactId ?? prev.contactId,
    stage: prev.stageLocked ? prev.stage : out.stage,
    intent: out.intent || null,
    mood: out.mood,
    needsHuman: out.needsHuman,
    needsHumanReason: out.needsHuman ? (out.needsHumanReason ?? null) : null,
    followUpAt: out.followUpAt ? new Date(out.followUpAt) : null,
    followUpReason: out.followUpAt ? (out.followUpReason ?? null) : null,
    note: out.note || null,
    evaluatedUntil: evaluatedUntil(prev.evaluatedUntil, cover.lastMessageAt),
    evaluatedAt: now,
    dismissedUntilMessageAfter: keepDismissal ? dismissed : null,
    version: prev.version + 1,
    updatedAt: now,
  };
}

/** A member's stage change as it is written: a stage set by hand is locked. */
export interface StageChange {
  /** null: the stored stage stays. */
  stage: SignalStage | null;
  stageLocked: boolean;
}

/**
 * The write of a member's request: setting a stage locks it (the contract rejects a stage with
 * `stageLocked: false`); `stageLocked` alone locks or unlocks the stored stage.
 */
export function stageChange(change: {
  stage?: SignalStage | undefined;
  stageLocked?: boolean | undefined;
}): StageChange {
  if (change.stage !== undefined) return { stage: change.stage, stageLocked: true };
  return { stage: null, stageLocked: change.stageLocked ?? true };
}

/** A member sets the stage by hand: it is locked so evaluations keep it. */
export function overrideStage(
  prev: ConversationSignal,
  change: { stage?: SignalStage | undefined; stageLocked?: boolean | undefined },
  now: Date,
): ConversationSignal {
  const c = stageChange(change);
  return {
    ...prev,
    stage: c.stage ?? prev.stage,
    stageLocked: c.stageLocked,
    version: prev.version + 1,
    updatedAt: now,
  };
}

/** The complaint alert fires only when an evaluation newly sets `mood = complaint`. */
export function becameComplaint(prev: ConversationSignal, next: ConversationSignal): boolean {
  return next.mood === 'complaint' && prev.mood !== 'complaint';
}
