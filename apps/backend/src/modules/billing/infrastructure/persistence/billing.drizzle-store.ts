import { and, type Database, eq, schema, withSystem, withTenant } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { BillingStore } from '../../application/ports/billing-store.js';
import type { PlanRecord, SubscriptionRecord } from '../../domain/entitlements.js';

/** Workspace state under tenant RLS; the plan catalog is global, so it uses the system role. */
export class DrizzleBillingStore implements BillingStore {
  constructor(
    private readonly tenantDb: Database,
    private readonly systemDb: Database,
  ) {}

  workspaceState(ws: WorkspaceId) {
    return withTenant(this.tenantDb, ws, async (tx) => {
      const [sub] = await tx.select().from(schema.subscriptions).limit(1);
      const overrides = await tx.select().from(schema.workspaceEntitlementOverrides);
      return {
        subscription: sub
          ? ({
              planCode: sub.planCode,
              planVersion: sub.planVersion,
              status: sub.status as SubscriptionRecord['status'],
              currentPeriodEnd: sub.currentPeriodEnd,
            } satisfies SubscriptionRecord)
          : null,
        overrides: overrides.map((o) => ({ key: o.key, value: o.value, expiresAt: o.expiresAt })),
      };
    });
  }

  plan(code: string, version: number): Promise<PlanRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [p] = await tx
        .select()
        .from(schema.plans)
        .where(and(eq(schema.plans.code, code), eq(schema.plans.version, version)))
        .limit(1);
      return p
        ? { code: p.code, version: p.version, name: p.name, entitlements: p.entitlements }
        : null;
    });
  }
}
