import type { WorkspaceId } from '@agent-sales/shared';

import type { OverrideRecord, PlanRecord, SubscriptionRecord } from '../../domain/entitlements.js';

export interface BillingStore {
  /** The workspace's subscription (null = free plan) and its overrides, under tenant RLS. */
  workspaceState(
    ws: WorkspaceId,
  ): Promise<{ subscription: SubscriptionRecord | null; overrides: OverrideRecord[] }>;
  /** One version of a plan (platform catalog, system role). */
  plan(code: string, version: number): Promise<PlanRecord | null>;
}

export const BILLING_STORE = Symbol('BILLING_STORE');
