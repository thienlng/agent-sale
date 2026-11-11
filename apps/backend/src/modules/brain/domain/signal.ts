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

/** What one evaluation covered: the last message read and the last customer message among them. */
export interface EvaluationCoverage {
  /** Time of the last message the model saw; becomes `evaluated_until`. */
  lastMessageAt: Date;
  /** Time of the newest customer message the model saw; null when it saw none. */
  lastCustomerMessageAt: Date | null;
  contactId: string | null;
}

/**
 * Write rules of an evaluation (spec §3.1, brief rule 5):
 * - a stage a member set by hand (`stage_locked`) is kept; otherwise the model's stage wins;
 * - `evaluated_until` becomes the time of the last covered message;
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
    evaluatedUntil: cover.lastMessageAt,
    evaluatedAt: now,
    dismissedUntilMessageAfter: keepDismissal ? dismissed : null,
    version: prev.version + 1,
    updatedAt: now,
  };
}

/** A member sets the stage by hand: it is locked so evaluations keep it. */
export function overrideStage(
  prev: ConversationSignal,
  change: { stage?: SignalStage | undefined; stageLocked?: boolean | undefined },
  now: Date,
): ConversationSignal {
  const stage = change.stage ?? prev.stage;
  const stageLocked = change.stage !== undefined ? true : (change.stageLocked ?? prev.stageLocked);
  return { ...prev, stage, stageLocked, version: prev.version + 1, updatedAt: now };
}

/** The complaint alert fires only when an evaluation newly sets `mood = complaint`. */
export function becameComplaint(prev: ConversationSignal, next: ConversationSignal): boolean {
  return next.mood === 'complaint' && prev.mood !== 'complaint';
}
