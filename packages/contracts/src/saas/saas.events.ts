import { z } from 'zod';

import { SaasBillingPeriod, SaasStage } from './saas.schema.js';

/**
 * Integration events published by the saas module through the outbox (ADR-022 §7): a customer's
 * subscription was created or its plan, stage, period, MRR or dates changed.
 */
export const SaasSubscriptionChangedV1 = z.object({
  type: z.literal('saas.subscription.changed.v1'),
  workspaceId: z.uuid(),
  subscriptionId: z.uuid(),
  contactId: z.uuid(),
  planName: z.string(),
  stage: SaasStage,
  fromStage: SaasStage.nullable(),
  billingPeriod: SaasBillingPeriod,
  /** Monthly recurring revenue in VND. */
  mrr: z.number().int().min(0),
  trialEndsOn: z.iso.date().nullable(),
  renewsOn: z.iso.date().nullable(),
  canceledOn: z.iso.date().nullable(),
  actorUserId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
});
export type SaasSubscriptionChangedV1 = z.infer<typeof SaasSubscriptionChangedV1>;
