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

export const WorkspaceEvents = z.discriminatedUnion('type', [WorkspaceCreatedV1]);
export type WorkspaceEvent = z.infer<typeof WorkspaceEvents>;
