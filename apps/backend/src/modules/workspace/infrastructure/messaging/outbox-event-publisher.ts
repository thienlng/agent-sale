import { type TenantTx, writeOutbox } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { EventPublisher } from '../../application/ports/event-publisher.js';

/** Writes integration events to the transactional outbox in the current tenant transaction. */
export class OutboxEventPublisher implements EventPublisher {
  constructor(private readonly tx: TenantTx) {}

  async publish(
    workspaceId: WorkspaceId | null,
    aggregate: { type: string; id: string },
    event: { type: string } & Record<string, unknown>,
  ): Promise<void> {
    await writeOutbox(this.tx, {
      workspaceId,
      type: event.type,
      aggregateType: aggregate.type,
      aggregateId: aggregate.id,
      payload: event,
    });
  }
}
