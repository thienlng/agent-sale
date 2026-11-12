import type { WorkspaceId } from '@agent-sales/shared';

import type { Limiter } from '../../../common/limits/limiter.js';

const DAY = 24 * 60 * 60_000;

/** What the bot may commit for one customer per day (security audit 2026-11-12 #18). 0 = off. */
export interface BotCommitLimits {
  /** Orders the bot creates (`confirm_order`). */
  ordersPerContactDay: number;
  /** Lodging holds the bot places (`confirm_hold`); each one blocks rooms until it expires. */
  holdsPerContactDay: number;
}

export type CommitKind = 'order' | 'hold';

/** One turn's allowance for one kind of commitment: check before, count after it succeeded. */
export interface CommitAllowance {
  allowed(): Promise<boolean>;
  used(): Promise<void>;
}

/** The tool result when the day's allowance is spent: the model hands the customer to staff. */
export const COMMIT_LIMIT_REPLY = {
  ok: false,
  error: 'daily_limit_reached',
  hint: 'Do not retry today. Tell the customer the shop staff will finish this for them, then hand off.',
} as const;

/**
 * Orders and holds the bot commits per customer and day, on the shared limiter. The customer is
 * the conversation's contact; without one (an anonymous visitor) the conversation itself.
 */
export class BotCommitQuota {
  constructor(
    readonly limits: BotCommitLimits,
    private readonly limiter: Limiter,
  ) {}

  /** The allowance of one customer, or null when this kind is not capped. */
  for(
    kind: CommitKind,
    ws: WorkspaceId,
    who: { contactId: string | null; conversationId: string },
  ): CommitAllowance | null {
    const limit =
      kind === 'order' ? this.limits.ordersPerContactDay : this.limits.holdsPerContactDay;
    if (!limit) return null;
    const subject = who.contactId ? `contact:${who.contactId}` : `conv:${who.conversationId}`;
    const key = `bot:${kind}s:${ws}:${subject}:d`;
    return {
      allowed: async () => (await this.limiter.peek(key)) < limit,
      used: async () => {
        await this.limiter.add(key, 1, DAY);
      },
    };
  }
}
