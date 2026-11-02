import { newId } from '@agent-sales/shared';

import { platformAuditEvents } from './schema/platform.js';
import type { TenantTx } from './tenant.js';

export interface PlatformAuditRecord {
  actorUserId: string | null;
  actorName: string | null;
  /** "<area>.<thing>.<verb>", e.g. `billing.plan.published`. */
  action: string;
  /** `plan` | `billing_settings` | `account` | `payment`. */
  targetType: string;
  targetId?: string | null;
  /** Why the operator did it (mandatory in /admin). */
  reason: string;
  /** What changed. Never secrets; keep personal data to ids. */
  data?: Record<string, unknown>;
}

/** Appends a platform-operator audit row in the caller's system transaction (ADR-021 §6). */
export async function writePlatformAudit(tx: TenantTx, r: PlatformAuditRecord): Promise<void> {
  await tx.insert(platformAuditEvents).values({
    id: newId(),
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId ?? null,
    reason: r.reason,
    data: r.data ?? {},
  });
}
