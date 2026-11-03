import { defineRoutes } from '../common/routes.js';
import { AuditList, AuditQuery } from './audit.schema.js';

export const auditRoutes = defineRoutes([
  {
    method: 'get',
    path: '/audit-events',
    assistant: { use: 'read', when: 'The owner asks who changed what in the business recently.' },
    summary: 'Who changed what in this workspace (newest first)',
    tag: 'audit',
    auth: true,
    workspaceScoped: true,
    query: AuditQuery,
    responses: { 200: AuditList },
  },
]);
