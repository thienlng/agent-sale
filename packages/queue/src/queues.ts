import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Queue catalogue. One queue per job class; `conversation` has a priority twin
 * for higher tenant tiers (docs/16 §3). Names are stable contracts.
 */
export const QUEUES = {
  conversation: 'conversation',
  conversationPriority: 'conversation:priority',
  outbound: 'outbound',
  campaign: 'campaign',
  workflow: 'workflow',
  indexer: 'indexer',
  outbox: 'outbox',
  scheduler: 'scheduler',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Every job carries the tenant; processors run inside withTenant(). */
export interface TenantJob<TData = unknown> {
  workspaceId: WorkspaceId;
  data: TData;
}

/** Deterministic job id = idempotency: BullMQ ignores a second add with the same id. */
export function jobId(parts: ReadonlyArray<string | number>): string {
  return parts.map(String).join(':');
}
