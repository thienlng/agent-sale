import type { SaasSubscriptionChangedV1 } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { SaasTx, SubscriptionRecord } from './ports/saas-store.js';

export const SUBSCRIPTION_CHANGED = 'saas.subscription.changed.v1';

/** The fields a `saas.subscription.changed` event reports; a change of any other field is quiet. */
const REPORTED = [
  'planName',
  'stage',
  'billingPeriod',
  'mrr',
  'trialEndsOn',
  'renewsOn',
  'canceledOn',
] as const satisfies ReadonlyArray<keyof SubscriptionRecord>;

/**
 * The `saas.subscription.changed.v1` payload for a created subscription or one whose plan, stage,
 * period, MRR or dates changed (ADR-022 §7); null when nothing reported changed (note, seats, usage).
 */
export function subscriptionChanged(
  ws: WorkspaceId,
  before: SubscriptionRecord | null,
  after: SubscriptionRecord,
  actorUserId: string | null,
  at: string,
): Omit<SaasSubscriptionChangedV1, 'type'> | null {
  if (before && REPORTED.every((k) => before[k] === after[k])) return null;
  return {
    workspaceId: ws,
    subscriptionId: after.id,
    contactId: after.contactId,
    planName: after.planName,
    stage: after.stage,
    fromStage: before?.stage ?? null,
    billingPeriod: after.billingPeriod,
    mrr: after.mrr,
    trialEndsOn: after.trialEndsOn,
    renewsOn: after.renewsOn,
    canceledOn: after.canceledOn,
    actorUserId,
    occurredAt: at,
  };
}

/** Writes the event in the transaction that saved the subscription, when one is due. */
export async function publishSubscriptionChanged(
  tx: SaasTx,
  ws: WorkspaceId,
  before: SubscriptionRecord | null,
  after: SubscriptionRecord,
  actorUserId: string | null,
  at: string,
): Promise<void> {
  const payload = subscriptionChanged(ws, before, after, actorUserId, at);
  if (payload) await tx.outbox(SUBSCRIPTION_CHANGED, after.id, payload);
}
