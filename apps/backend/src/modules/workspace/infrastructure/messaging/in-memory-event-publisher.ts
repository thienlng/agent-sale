import type { WorkspaceId } from '@agent-sales/shared';

import type { EventPublisher } from '../../application/ports/event-publisher.js';

/** Test/dev adapter used by the in-memory unit of work. */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: Array<{
    workspaceId: WorkspaceId | null;
    aggregate: { type: string; id: string };
    event: Record<string, unknown>;
  }> = [];

  async publish(
    workspaceId: WorkspaceId | null,
    aggregate: { type: string; id: string },
    event: { type: string } & Record<string, unknown>,
  ): Promise<void> {
    this.published.push({ workspaceId, aggregate, event });
  }
}
