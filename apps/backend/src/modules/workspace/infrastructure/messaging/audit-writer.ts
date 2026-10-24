import { type TenantTx, writeAudit } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Actor, AuditWriter } from '../../application/ports/audit-writer.js';

/** Appends audit events in the current tenant transaction. */
export class DrizzleAuditWriter implements AuditWriter {
  constructor(private readonly tx: TenantTx) {}

  async record(
    workspaceId: WorkspaceId,
    actor: Actor,
    event: Parameters<AuditWriter['record']>[2],
  ): Promise<void> {
    await writeAudit(this.tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      ...(event.data ? { data: event.data } : {}),
    });
  }
}

/** Unit-test / DB-less writer: keeps events in memory. */
export class InMemoryAuditWriter implements AuditWriter {
  readonly events: Array<
    { workspaceId: WorkspaceId; actor: Actor } & Parameters<AuditWriter['record']>[2]
  > = [];

  async record(
    workspaceId: WorkspaceId,
    actor: Actor,
    event: Parameters<AuditWriter['record']>[2],
  ) {
    this.events.push({ workspaceId, actor, ...event });
  }
}
