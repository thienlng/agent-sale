import { defineRoutes } from '../common/routes.js';
import { DefinitionsResponse } from './analytics.schema.js';

export const analyticsRoutes = defineRoutes([
  {
    method: 'get',
    path: '/analytics/definitions',
    summary: 'What every statistics metric means (versioned)',
    tag: 'analytics',
    auth: true,
    workspaceScoped: true,
    responses: { 200: DefinitionsResponse },
  },
]);
