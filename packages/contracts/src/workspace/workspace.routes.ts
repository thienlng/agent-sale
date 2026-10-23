import { defineRoutes } from '../common/routes.js';
import { CreateWorkspaceRequest, WorkspaceDto } from './workspace.schema.js';

export const workspaceRoutes = defineRoutes([
  {
    method: 'get',
    path: '/workspaces/current',
    summary: 'The workspace selected by X-Workspace-Id',
    tag: 'workspace',
    auth: true,
    workspaceScoped: true,
    responses: { 200: WorkspaceDto },
  },
  {
    method: 'post',
    path: '/workspaces',
    summary: 'Create a workspace owned by the current user',
    tag: 'workspace',
    auth: true,
    body: CreateWorkspaceRequest,
    responses: { 201: WorkspaceDto },
  },
]);
