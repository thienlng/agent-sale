import type { WorkspaceId } from '@agent-sales/shared';

/**
 * One customer being deleted on request (docs/09 §10). Handed to every registered step; `collect`
 * steps fill `conversationIds`, the others add to `counts`.
 */
export interface ContactErasure {
  readonly workspaceId: WorkspaceId;
  readonly contactId: string;
  /** The customer's E.164 phone (orders carry no customer id, only the phone typed on them). */
  readonly phoneE164: string | null;
  /**
   * The customer's name as stored (null: none). A phone shared by several people (a family, a
   * shop's front desk) must not erase somebody else's order or booking: a record matched only by
   * phone is anonymized when its name is this one or empty.
   */
  readonly name: string | null;
  /** The customer's conversations (filled by the `collect` steps). */
  conversationIds: string[];
  /** What each module removed or anonymized, for the response; counts only. */
  counts: ContactErasureCounts;
}

export interface ContactErasureCounts {
  conversations: number;
  messages: number;
  files: number;
  orders: number;
  bookings: number;
}

export type ContactErasureStep = (erasure: ContactErasure) => Promise<void>;

/**
 * Lets modules above `crm` in the module graph (conversation, commerce, lodging, webchat, ai) erase
 * or anonymize what they hold about a customer before crm deletes the customer, without `crm`
 * importing them (same pattern as `BotLifecycle`). Steps run in three phases so registration order
 * never matters:
 *
 * 1. `collect` — read only: add the customer's conversation ids.
 * 2. `detach` — remove or anonymize records that point at the customer or those conversations
 *    (orders, bookings, drafts, visitors, summaries).
 * 3. `erase` — remove the conversations themselves (last, so a retry still finds them).
 *
 * Every step must be idempotent: a failure leaves the customer in place and the delete can be
 * retried from the start.
 */
export class ContactLifecycle {
  readonly #collect: ContactErasureStep[] = [];
  readonly #detach: ContactErasureStep[] = [];
  readonly #erase: ContactErasureStep[] = [];

  onCollect(step: ContactErasureStep): void {
    this.#collect.push(step);
  }

  onDetach(step: ContactErasureStep): void {
    this.#detach.push(step);
  }

  onErase(step: ContactErasureStep): void {
    this.#erase.push(step);
  }

  async beforeDelete(erasure: ContactErasure): Promise<void> {
    for (const step of this.#collect) await step(erasure);
    erasure.conversationIds = [...new Set(erasure.conversationIds)];
    for (const step of this.#detach) await step(erasure);
    for (const step of this.#erase) await step(erasure);
  }
}

export const CONTACT_LIFECYCLE = Symbol('CONTACT_LIFECYCLE');
