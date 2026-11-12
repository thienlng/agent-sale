import type { WorkspaceId } from '@agent-sales/shared';

import type { Limiter } from '../../../common/limits/limiter.js';

const DAY = 24 * 60 * 60_000;

/** What the bot may commit per day (security audit 2026-11-12 #18). 0 = off. */
export interface BotCommitLimits {
  /** Orders the bot creates (`confirm_order`) for one customer. */
  ordersPerContactDay: number;
  /** Lodging holds (`confirm_hold`) for one customer; each one blocks rooms until it expires. */
  holdsPerContactDay: number;
  /**
   * Orders and holds per workspace from conversations without a contact (anonymous visitors).
   * Their per-customer key is the conversation, which a visitor rotates with a new widget token,
   * so this workspace-wide total is what bounds them.
   */
  anonymousOrdersPerWorkspaceDay: number;
  anonymousHoldsPerWorkspaceDay: number;
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
 * the conversation's contact; without one (an anonymous visitor) the conversation itself, plus
 * the workspace's anonymous total.
 *
 * Check-then-count (`peek` before the commitment, `add` after it succeeded): turns that confirm
 * at the same moment all pass the check, so a day can overshoot a limit by the confirmations in
 * flight at once (at most one per conversation, which runs one turn at a time). Accepted:
 * counting first would spend the allowance on confirmations that then fail.
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
    const l = this.limits;
    const caps: { key: string; limit: number }[] = [];
    const perCustomer = kind === 'order' ? l.ordersPerContactDay : l.holdsPerContactDay;
    const subject = who.contactId ? `contact:${who.contactId}` : `conv:${who.conversationId}`;
    if (perCustomer) caps.push({ key: `bot:${kind}s:${ws}:${subject}:d`, limit: perCustomer });
    const anonymous =
      kind === 'order' ? l.anonymousOrdersPerWorkspaceDay : l.anonymousHoldsPerWorkspaceDay;
    if (!who.contactId && anonymous)
      caps.push({ key: `bot:${kind}s:${ws}:anon:d`, limit: anonymous });
    if (!caps.length) return null;
    return {
      allowed: async () => {
        for (const cap of caps) if ((await this.limiter.peek(cap.key)) >= cap.limit) return false;
        return true;
      },
      used: async () => {
        for (const cap of caps) await this.limiter.add(cap.key, 1, DAY);
      },
    };
  }
}
