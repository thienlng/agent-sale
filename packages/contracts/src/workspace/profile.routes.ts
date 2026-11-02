import { defineRoutes } from '../common/routes.js';
import { UpdateWorkspaceProfileRequest, WorkspaceProfileDto } from './workspace.schema.js';

const scoped = { tag: 'workspace', auth: true, workspaceScoped: true } as const;

export const profileRoutes = defineRoutes([
  {
    method: 'get',
    path: '/workspace/profile',
    assistant: { use: 'read', when: 'The business profile: display name, company name and icon.' },
    summary: 'Business profile of the workspace',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'patch',
    path: '/workspace/profile',
    assistant: {
      use: 'write',
      when: 'The owner asks to change the business display name, company name or icon.',
    },
    summary: 'Edit the business profile (version-checked)',
    ...scoped,
    body: UpdateWorkspaceProfileRequest,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'get',
    path: '/workspace/logo',
    assistant: { use: 'never' },
    summary: 'The logo image (members only; PNG or JPEG bytes)',
    ...scoped,
    responses: { 200: null },
  },
  {
    method: 'put',
    path: '/workspace/logo',
    assistant: { use: 'never' },
    summary: 'Replace the logo: raw PNG or JPEG body, square, up to 1 MiB',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
  {
    method: 'delete',
    path: '/workspace/logo',
    assistant: { use: 'never' },
    summary: 'Remove the logo',
    ...scoped,
    responses: { 200: WorkspaceProfileDto },
  },
]);
