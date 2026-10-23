/** Integration events this module publishes. Payload schemas live in packages/contracts. */
export { WorkspaceCreatedV1, WorkspaceEvents, type WorkspaceEvent } from '@agent-sales/contracts';

export const WORKSPACE_EVENT_TYPES = ['workspace.workspace.created.v1'] as const;
