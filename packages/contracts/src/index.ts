// Public surface of @agent-sales/contracts. Add one export line per module file.
import { healthRoutes } from './health/health.routes.js';
import { identityRoutes } from './identity/identity.routes.js';
import { workspaceRoutes } from './workspace/workspace.routes.js';

export * from './common/errors.js';
export * from './common/pagination.js';
export * from './common/routes.js';
export * from './health/health.schema.js';
export * from './health/health.routes.js';
export * from './identity/identity.schema.js';
export * from './identity/identity.routes.js';
export * from './workspace/workspace.schema.js';
export * from './workspace/workspace.events.js';
export * from './workspace/workspace.routes.js';

/** Every HTTP route of /api/v1. Append each module's routes here. */
export const allRoutes = [...healthRoutes, ...identityRoutes, ...workspaceRoutes] as const;
