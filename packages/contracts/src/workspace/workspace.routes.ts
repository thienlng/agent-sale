import { defineRoutes } from '../common/routes.js';
import {
  CreateWorkspaceRequest,
  DeletedBusinessDto,
  DeletedBusinessList,
  RequestBusinessDeletionRequest,
  WorkspaceDto,
} from './workspace.schema.js';

export const workspaceRoutes = defineRoutes([
  {
    method: 'get',
    path: '/workspaces/current',
    assistant: { use: 'read', when: 'Name, industry and basic facts of the current business.' },
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
  {
    method: 'get',
    path: '/workspaces/deleted',
    summary: 'Businesses the current user owns that are deleted and can still be restored',
    tag: 'workspace',
    auth: true,
    assistant: { use: 'never' },
    responses: { 200: DeletedBusinessList },
  },
  {
    method: 'post',
    path: '/workspaces/{workspaceId}/deletion',
    summary:
      'Delete a business (owner only, the name typed exactly): bots stop at once, restorable for 30 days, then purged',
    tag: 'workspace',
    auth: true,
    assistant: { use: 'never' },
    body: RequestBusinessDeletionRequest,
    responses: { 200: DeletedBusinessDto },
  },
  {
    method: 'post',
    path: '/workspaces/{workspaceId}/restore',
    summary: 'Restore a deleted business before its purge (owner only); channels stay disconnected',
    tag: 'workspace',
    auth: true,
    assistant: { use: 'never' },
    responses: { 200: WorkspaceDto },
  },
]);
