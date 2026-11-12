import { z } from 'zod';

/**
 * Integration events published by the workspace module.
 * Names are versioned: "<module>.<thing>.<verb>.v<n>". Payloads are validated
 * by producers (contract test) and consumers (inbox).
 */
export const WorkspaceCreatedV1 = z.object({
  type: z.literal('workspace.workspace.created.v1'),
  workspaceId: z.uuid(),
  ownerUserId: z.uuid(),
  industry: z.string(),
  occurredAt: z.iso.datetime(),
});
export type WorkspaceCreatedV1 = z.infer<typeof WorkspaceCreatedV1>;

/** The owner deleted the business (ADR-033): it stops at once and is purged after `purgeAfter`. */
export const WorkspaceDeletionRequestedV1 = z.object({
  type: z.literal('workspace.workspace.deletion_requested.v1'),
  workspaceId: z.uuid(),
  actorUserId: z.uuid(),
  purgeAfter: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
});
export type WorkspaceDeletionRequestedV1 = z.infer<typeof WorkspaceDeletionRequestedV1>;

/** The owner restored the business before its purge; channels stay disconnected. */
export const WorkspaceRestoredV1 = z.object({
  type: z.literal('workspace.workspace.restored.v1'),
  workspaceId: z.uuid(),
  actorUserId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type WorkspaceRestoredV1 = z.infer<typeof WorkspaceRestoredV1>;

/** The worker hard-deleted the business's data; only a tombstone row and its audit trail remain. */
export const WorkspacePurgedV1 = z.object({
  type: z.literal('workspace.workspace.purged.v1'),
  workspaceId: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export type WorkspacePurgedV1 = z.infer<typeof WorkspacePurgedV1>;

export const WorkspaceEvents = z.discriminatedUnion('type', [
  WorkspaceCreatedV1,
  WorkspaceDeletionRequestedV1,
  WorkspaceRestoredV1,
  WorkspacePurgedV1,
]);
export type WorkspaceEvent = z.infer<typeof WorkspaceEvents>;
