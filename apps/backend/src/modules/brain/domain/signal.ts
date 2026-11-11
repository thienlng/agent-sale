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
 * How late a message may be stored behind its channel time and still be read by the next
 * evaluation. Messages carry the channel's time (a webhook can arrive minutes late), and the next
 * evaluation reads the messages after `evaluated_until`; so `evaluated_until` never comes closer
 * to the evaluation than this, and a message stored late within it is read next time.
 */
export const EVALUATION_LAG_MS = 10 * 60_000;

/** What one evaluation covered: the last message read and the last customer message among them. */
export interface EvaluationCoverage {
  /** Time of the last message the model saw; `evaluated_until` (within the lag allowance). */
  lastMessageAt: Date;
  /** Time of the newest customer message the model saw; null when it saw none. */
  lastCustomerMessageAt: Date | null;
  contactId: string | null;
}

/**
 * `evaluated_until` of an evaluation: the last covered message, but at least `EVALUATION_LAG_MS`
 * before the evaluation (a late-stored message is read next time), never moving back.
 */
export function evaluatedUntil(prev: Date | null, lastMessageAt: Date, now: Date): Date {
  const until = Math.min(lastMessageAt.getTime(), now.getTime() - EVALUATION_LAG_MS);
  return new Date(Math.max(until, prev?.getTime() ?? Number.NEGATIVE_INFINITY));
}

/**
 * For a member's request (manual, refresh): a customer message after this time is new. Right
 * after an evaluation (within the lag allowance) that is the evaluation itself, so asking again
 * does not pay to re-read the messages `evaluated_until` kept behind for late arrivals; the idle
 * job, which reads after `evaluated_until`, still picks a late message up.
 */
export function newAfter(s: ConversationSignal | null, now: Date): number {
  const until = s?.evaluatedUntil?.getTime() ?? Number.NEGATIVE_INFINITY;
  const at = s?.evaluatedAt?.getTime();
  return at !== undefined && now.getTime() - at < EVALUATION_LAG_MS ? Math.max(until, at) : until;
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
    evaluatedUntil: evaluatedUntil(prev.evaluatedUntil, cover.lastMessageAt, now),
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
