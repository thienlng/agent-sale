import type { WorkspaceId } from '@agent-sales/shared';

import type { EventPublisher } from '../../application/ports/event-publisher.js';

/** Test/dev adapter. The outbox adapter replaces it once packages/db is wired (T-004). */
export class InMemoryEventPublisher implements EventPublisher {
  readonly published: Array<{ workspaceId: WorkspaceId | null; event: Record<string, unknown> }> =
    [];

  async publish(
    workspaceId: WorkspaceId | null,
    event: { type: string } & Record<string, unknown>,
  ): Promise<void> {
    this.published.push({ workspaceId, event });
  }
}
