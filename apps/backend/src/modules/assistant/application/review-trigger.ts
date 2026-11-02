import type { ReviewScope } from '../domain/ports/assistant.repository.js';

/** Owner turns since the last review that start a memory review at once (spec §11). */
export const REVIEW_MEMORY_TURNS = 8;
/** Tool-loop rounds since the last review that start a skills review at once (spec §11). */
export const REVIEW_SKILL_ROUNDS = 10;
/** Owner turns after which an idle thread gets a combined review (spec §11). */
export const REVIEW_IDLE_TURNS = 3;
/** The idle review runs this long after the last turn; each later turn pushes it back. */
export const REVIEW_IDLE_MS = 30 * 60_000;

/** The review a thread's counters call for, and how long after now it runs. */
export interface ReviewPlan {
  scope: ReviewScope;
  delayMs: number;
}

/**
 * Trigger maths (spec §11), on the counters after this turn was added: ≥ 8 owner turns → a
 * memory review now; ≥ 10 tool rounds → a skills review now (both → combined now); otherwise ≥ 3
 * owner turns → a combined review once the thread has been idle for 30 minutes. Null: nothing.
 */
export function planReview(c: { ownerTurns: number; toolRounds: number }): ReviewPlan | null {
  const memory = c.ownerTurns >= REVIEW_MEMORY_TURNS;
  const skills = c.toolRounds >= REVIEW_SKILL_ROUNDS;
  if (memory && skills) return { scope: 'combined', delayMs: 0 };
  if (memory) return { scope: 'memory', delayMs: 0 };
  if (skills) return { scope: 'skills', delayMs: 0 };
  if (c.ownerTurns >= REVIEW_IDLE_TURNS) return { scope: 'combined', delayMs: REVIEW_IDLE_MS };
  return null;
}
