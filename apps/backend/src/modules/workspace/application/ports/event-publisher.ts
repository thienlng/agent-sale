import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Application-level port for integration events. The production adapter
 * writes to the transactional outbox in the current unit of work
 * (docs/ARCHITECTURE.md §2), so events commit or roll back with the data.
 */
export interface EventPublisher {
  publish(
    workspaceId: WorkspaceId | null,
    aggregate: { type: string; id: string },
    event: { type: string } & Record<string, unknown>,
  ): Promise<void>;
}
