import { z } from 'zod';

export const WorkspaceId = z.uuid();

export const WorkspaceDto = z.object({
  id: WorkspaceId,
  name: z.string().min(1).max(120),
  industry: z.string().min(1).max(64),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
  createdAt: z.iso.datetime(),
});
export type WorkspaceDto = z.infer<typeof WorkspaceDto>;

export const CreateWorkspaceRequest = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.string().trim().min(1).max(64),
  timezone: z.string().optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const UpdateWorkspaceRequest = CreateWorkspaceRequest.partial();
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;
