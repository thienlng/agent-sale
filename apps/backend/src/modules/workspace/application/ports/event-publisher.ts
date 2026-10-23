import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Application-level port for integration events. The production adapter
 * writes to the transactional outbox (docs/ARCHITECTURE.md §2).
 */
export interface EventPublisher {
  publish(
    workspaceId: WorkspaceId | null,
    event: { type: string } & Record<string, unknown>,
  ): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
