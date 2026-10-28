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

const WorkspaceFields = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.string().trim().min(1).max(64),
  timezone: z.string().optional(),
});

export const CreateWorkspaceRequest = WorkspaceFields.extend({
  /** Account that owns the new business (ADR-012 §3); the caller must own it. Omitted → their only account. */
  accountId: z.uuid().optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;

export const UpdateWorkspaceRequest = WorkspaceFields.partial();
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequest>;

// ─── Business profile and logo (ADM-02, T-056) ───────────────────────────────

/** Logo rules, shown in the UI and enforced on the bytes by the server. */
export const LOGO_RULES = {
  maxBytes: 1_048_576,
  /** Must be square; 720 × 720 px is recommended. */
  minSide: 128,
  maxSide: 2048,
  recommendedSide: 720,
  mimes: ['image/png', 'image/jpeg'],
} as const;

export const WorkspaceProfileDto = z.object({
  /** The shop name shown in the app (also `workspaces/current`). */
  name: z.string(),
  companyName: z.string(),
  businessServices: z.string(),
  productDescription: z.string(),
  /** Has a logo: fetch it from `GET /workspace/logo` (authorised route, not a public URL). */
  hasLogo: z.boolean(),
  /** Changes whenever the logo does: use it to refresh a cached image. */
  logoVersion: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
});
export type WorkspaceProfileDto = z.infer<typeof WorkspaceProfileDto>;

export const UpdateWorkspaceProfileRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  companyName: z.string().trim().max(200).optional(),
  businessServices: z.string().trim().max(1000).optional(),
  productDescription: z.string().trim().max(5000).optional(),
  /** The version you loaded; a newer one answers CONFLICT. */
  expectedVersion: z.number().int().min(1),
});
export type UpdateWorkspaceProfileRequest = z.input<typeof UpdateWorkspaceProfileRequest>;
