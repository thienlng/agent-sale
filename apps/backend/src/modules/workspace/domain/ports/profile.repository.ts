import type { WorkspaceId } from '@agent-sales/shared';

/** The business profile of a workspace (not the user's login details, not billing identity). */
export interface WorkspaceProfile {
  name: string;
  companyName: string;
  businessServices: string;
  productDescription: string;
  logoAssetId: string | null;
  logoSha256: string | null;
  version: number;
  updatedAt: Date | null;
}

export type ProfilePatch = Partial<
  Pick<WorkspaceProfile, 'name' | 'companyName' | 'businessServices' | 'productDescription'>
>;

export interface LogoAsset {
  id: string;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
  data: Buffer;
}

/** Port implemented in infrastructure/persistence. Bound to one unit of work. */
export interface ProfileRepository {
  get(workspaceId: WorkspaceId, opts?: { forUpdate?: boolean }): Promise<WorkspaceProfile | null>;
  /** Writes the patch and bumps the version (the caller has checked the expected one under lock). */
  update(workspaceId: WorkspaceId, patch: ProfilePatch, by: string): Promise<WorkspaceProfile>;
  /** Stores the new logo, points the workspace at it and drops the old one, in this transaction. */
  setLogo(workspaceId: WorkspaceId, asset: LogoAsset, by: string): Promise<WorkspaceProfile>;
  clearLogo(workspaceId: WorkspaceId, by: string): Promise<WorkspaceProfile>;
  logo(workspaceId: WorkspaceId): Promise<{ mime: string; sha256: string; data: Buffer } | null>;
}
