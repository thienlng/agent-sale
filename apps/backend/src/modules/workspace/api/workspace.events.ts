/** Integration events this module publishes. Payload schemas live in packages/contracts. */
export {
  WorkspaceCreatedV1,
  WorkspaceDeletionRequestedV1,
  WorkspaceEvents,
  WorkspacePurgedV1,
  WorkspaceRestoredV1,
  type WorkspaceEvent,
} from '@agent-sales/contracts';

export const WORKSPACE_EVENT_TYPES = [
  'workspace.workspace.created.v1',
  'workspace.workspace.deletion_requested.v1',
  'workspace.workspace.restored.v1',
  'workspace.workspace.purged.v1',
] as const;
