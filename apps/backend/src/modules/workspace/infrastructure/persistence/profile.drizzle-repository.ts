import { and, eq, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  LogoAsset,
  ProfilePatch,
  ProfileRepository,
  WorkspaceProfile,
} from '../../domain/ports/profile.repository.js';

const w = schema.workspaces;
const a = schema.workspaceAssets;

/** Profile columns of `workspaces` and the logo in `workspace_assets`, inside one tenant transaction. */
export class DrizzleProfileRepository implements ProfileRepository {
  constructor(private readonly tx: TenantTx) {}

  async get(ws: WorkspaceId, opts?: { forUpdate?: boolean }): Promise<WorkspaceProfile | null> {
    const q = this.tx
      .select({
        name: w.name,
        companyName: w.companyName,
        businessServices: w.businessServices,
        productDescription: w.productDescription,
        logoAssetId: w.logoAssetId,
        version: w.profileVersion,
        updatedAt: w.profileUpdatedAt,
        logoSha256: sql<
          string | null
        >`(select ${a.sha256} from ${a} where ${a.id} = ${w.logoAssetId})`,
      })
      .from(w)
      .where(eq(w.id, ws))
      .limit(1);
    const [row] = opts?.forUpdate ? await q.for('update', { of: w }) : await q;
    return row ?? null;
  }

  async update(ws: WorkspaceId, patch: ProfilePatch, by: string): Promise<WorkspaceProfile> {
    const now = new Date();
    await this.tx
      .update(w)
      .set({
        ...patch,
        profileVersion: sql`${w.profileVersion} + 1`,
        profileUpdatedBy: by,
        profileUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(w.id, ws));
    return this.#now(ws);
  }

  async setLogo(ws: WorkspaceId, asset: LogoAsset, by: string): Promise<WorkspaceProfile> {
    const [current] = await this.tx.select({ id: w.logoAssetId }).from(w).where(eq(w.id, ws));
    await this.tx.insert(a).values({
      id: asset.id,
      workspaceId: ws,
      kind: 'logo',
      mime: asset.mime,
      byteSize: asset.data.length,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
      data: asset.data,
      createdBy: by,
    });
    await this.#point(ws, asset.id, by);
    // The old image goes only after the workspace points at the new one.
    if (current?.id)
      await this.tx.delete(a).where(and(eq(a.id, current.id), eq(a.workspaceId, ws)));
    return this.#now(ws);
  }

  async clearLogo(ws: WorkspaceId, by: string): Promise<WorkspaceProfile> {
    const [current] = await this.tx.select({ id: w.logoAssetId }).from(w).where(eq(w.id, ws));
    await this.#point(ws, null, by);
    if (current?.id)
      await this.tx.delete(a).where(and(eq(a.id, current.id), eq(a.workspaceId, ws)));
    return this.#now(ws);
  }

  async logo(ws: WorkspaceId) {
    const [row] = await this.tx
      .select({ mime: a.mime, sha256: a.sha256, data: a.data })
      .from(a)
      .innerJoin(w, eq(w.logoAssetId, a.id))
      .where(and(eq(w.id, ws), eq(a.workspaceId, ws)))
      .limit(1);
    return row ?? null;
  }

  async #point(ws: WorkspaceId, assetId: string | null, by: string): Promise<void> {
    const now = new Date();
    await this.tx
      .update(w)
      .set({
        logoAssetId: assetId,
        profileVersion: sql`${w.profileVersion} + 1`,
        profileUpdatedBy: by,
        profileUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(w.id, ws));
  }

  async #now(ws: WorkspaceId): Promise<WorkspaceProfile> {
    const p = await this.get(ws);
    if (!p) throw new Error('workspace vanished inside its own transaction');
    return p;
  }
}

/** DB-less runs and tests: profiles and logos kept in memory. */
export class InMemoryProfileRepository implements ProfileRepository {
  readonly #profiles = new Map<string, WorkspaceProfile>();
  readonly #logos = new Map<string, LogoAsset>();

  async get(ws: WorkspaceId): Promise<WorkspaceProfile | null> {
    return (
      this.#profiles.get(ws) ?? {
        name: '',
        companyName: '',
        businessServices: '',
        productDescription: '',
        logoAssetId: null,
        logoSha256: null,
        version: 1,
        updatedAt: null,
      }
    );
  }

  async update(ws: WorkspaceId, patch: ProfilePatch): Promise<WorkspaceProfile> {
    const current = (await this.get(ws)) as WorkspaceProfile;
    const next = { ...current, ...patch, version: current.version + 1, updatedAt: new Date() };
    this.#profiles.set(ws, next);
    return next;
  }

  async setLogo(ws: WorkspaceId, asset: LogoAsset): Promise<WorkspaceProfile> {
    const current = (await this.get(ws)) as WorkspaceProfile;
    this.#logos.set(ws, asset);
    const next = {
      ...current,
      logoAssetId: asset.id,
      logoSha256: asset.sha256,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.#profiles.set(ws, next);
    return next;
  }

  async clearLogo(ws: WorkspaceId): Promise<WorkspaceProfile> {
    const current = (await this.get(ws)) as WorkspaceProfile;
    this.#logos.delete(ws);
    const next = {
      ...current,
      logoAssetId: null,
      logoSha256: null,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.#profiles.set(ws, next);
    return next;
  }

  async logo(ws: WorkspaceId) {
    const l = this.#logos.get(ws);
    return l ? { mime: l.mime, sha256: l.sha256, data: l.data } : null;
  }
}
