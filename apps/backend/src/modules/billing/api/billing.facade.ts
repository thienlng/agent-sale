import type { EntitlementsDto, MessageUsageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/**
 * What a reservation attempt decided. `metered: false` = the business has no account yet.
 * `account_suspended` = an operator or the lifecycle suspended the account or its subscription.
 */
export type ReserveOutcome =
  | { allowed: true; metered: boolean }
  | { allowed: false; reason: 'allowance_exhausted' | 'account_suspended'; cycleEnd: Date };

/** One AI reply to a customer, identified by its outbound idempotency key. */
export interface ReplyMeterKey {
  idempotencyKey: string;
  conversationId: string | null;
  botId: string | null;
}

/** PUBLIC CONTRACT of the billing module: what a workspace may use. */
export interface BillingFacade {
  /**
   * Plan limits and features with unexpired overrides applied. The account's subscription wins
   * over the business's own (ADR-012 §5); business overrides (e.g. grandfathered seats) apply last.
   */
  entitlements(workspaceId: WorkspaceId): Promise<EntitlementsDto>;
  /**
   * The numeric limit for `key` (e.g. `members.max`): `null` = unlimited,
   * and a key the plan does not define is 0 (deny by default).
   */
  limit(workspaceId: WorkspaceId, key: string): Promise<number | null>;
  /** The account's AI reply allowance and its use in the current cycle. */
  usage(workspaceId: WorkspaceId): Promise<MessageUsageDto>;
  /**
   * Call before generating an AI reply to a customer. Takes one unit of the account's allowance
   * for the key (retries of the same key are not counted twice); `allowed: false` = exhausted,
   * the caller must not generate and hands the conversation to staff instead.
   */
  reserveReply(workspaceId: WorkspaceId, reply: ReplyMeterKey): Promise<ReserveOutcome>;
  /** The reserved reply was delivered: it counts for the cycle. */
  captureReply(workspaceId: WorkspaceId, idempotencyKey: string): Promise<void>;
  /** The reserved reply was not delivered (failure, superseded, staff took over). */
  releaseReply(workspaceId: WorkspaceId, idempotencyKey: string): Promise<void>;
  /**
   * Puts a new account on the signup trial when the billing settings enable it (ADR-021 §6).
   * Idempotent: an account that already has a subscription keeps it. False = nothing started
   * (trial off, trial plan missing, or a subscription already exists).
   */
  startSignupTrial(accountId: string): Promise<boolean>;
}

export const BILLING_FACADE = Symbol('BILLING_FACADE');
