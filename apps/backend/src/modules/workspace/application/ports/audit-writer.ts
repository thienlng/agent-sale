import type { WorkspaceId } from '@agent-sales/shared';

/** Who did it, for the audit trail. */
export interface Actor {
  userId: string;
  name: string | null;
}

/**
 * Application port for the audit trail. The production adapter appends to
 * `audit_events` in the current unit of work, so a change and its trail commit together.
 */
export interface AuditWriter {
  record(
    workspaceId: WorkspaceId,
    actor: Actor,
    event: {
      action: string;
      targetType: string;
      targetId?: string | null;
      data?: Record<string, unknown>;
    },
  ): Promise<void>;
}
