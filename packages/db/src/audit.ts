import { newId, type WorkspaceId } from '@agent-sales/shared';

import { auditEvents } from './schema/audit.js';
import type { TenantTx } from './tenant.js';

export interface AuditRecord {
  workspaceId: WorkspaceId;
  actorUserId: string | null;
  actorName: string | null;
  /** "<area>.<thing>.<verb>", e.g. `member.role_changed`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  /** What changed and context. Never secrets; keep personal data to ids. */
  data?: Record<string, unknown>;
}

/**
 * Appends an audit event in the caller's transaction, so the change and its
 * trail commit together (same pattern as writeOutbox).
 */
export async function writeAudit(tx: TenantTx, r: AuditRecord): Promise<void> {
  await tx.insert(auditEvents).values({
    id: newId(),
    workspaceId: r.workspaceId,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId ?? null,
    data: r.data ?? {},
  });
}
