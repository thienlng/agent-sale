import { defineRoutes } from '../common/routes.js';
import { UpdateWorkspaceProfileRequest, WorkspaceProfileDto } from './workspace.schema.js';

const scoped = { tag: 'workspace', auth: true, workspaceScoped: true } as const;

export const profileRoutes = defineRoutes([
  {
    method: 'get',
    path: '/workspace/profile',
    summary: 'Business profile of the workspace',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'patch',
    path: '/workspace/profile',
    summary: 'Edit the business profile (version-checked)',
    ...scoped,
    body: UpdateWorkspaceProfileRequest,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'get',
    path: '/workspace/logo',
    summary: 'The logo image (members only; PNG or JPEG bytes)',
    ...scoped,
    responses: { 200: null },
  },
  {
    method: 'put',
    path: '/workspace/logo',
    summary: 'Replace the logo: raw PNG or JPEG body, square, up to 1 MiB',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'delete',
    path: '/workspace/logo',
    summary: 'Remove the logo',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
]);
