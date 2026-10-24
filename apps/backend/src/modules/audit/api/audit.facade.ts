import type { AuditList, AuditQuery } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/**
 * PUBLIC CONTRACT of the audit module. Writing is not here: a module appends
 * its own events with `writeAudit(tx, …)` from packages/db, inside the
 * transaction of the change it records.
 */
export interface AuditFacade {
  list(workspaceId: WorkspaceId, query: AuditQuery): Promise<AuditList>;
}

export const AUDIT_FACADE = Symbol('AUDIT_FACADE');
