import type { WorkspaceId } from '@agent-sales/shared';

export interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditFilter {
  /** Exact action, or a prefix when it ends with `.`. */
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Rows strictly older than this (createdAt, id) pair. */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export interface AuditStore {
  list(ws: WorkspaceId, f: AuditFilter): Promise<AuditRow[]>;
}

export const AUDIT_STORE = Symbol('AUDIT_STORE');
