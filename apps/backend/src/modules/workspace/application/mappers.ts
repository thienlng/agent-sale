import type { WorkspaceDto } from '@agent-sales/contracts';

import type { Workspace } from '../domain/workspace.js';

export function toWorkspaceDto(ws: Workspace): WorkspaceDto {
  const s = ws.snapshot();
  return {
    id: s.id,
    name: s.name,
    industry: s.industry,
    timezone: s.timezone,
    createdAt: s.createdAt.toISOString(),
  };
}
