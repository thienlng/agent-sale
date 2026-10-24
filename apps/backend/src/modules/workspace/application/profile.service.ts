import { createHash } from 'node:crypto';

import {
  LOGO_RULES,
  UpdateWorkspaceProfileRequest,
  type WorkspaceProfileDto,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { inspectLogo } from '../domain/logo-image.js';
import type { ProfilePatch, WorkspaceProfile } from '../domain/ports/profile.repository.js';
import {
  LogoNotFoundError,
  LogoRejectedError,
  ProfileStaleError,
} from '../domain/workspace.errors.js';
import type { Actor } from './ports/audit-writer.js';
import { WORKSPACE_UOW, type WorkspaceUnitOfWork } from './ports/workspace-unit-of-work.js';

const FIELDS = ['name', 'companyName', 'businessServices', 'productDescription'] as const;
/** Long text is trimmed in the trail: it says what changed, not the whole document. */
const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

export const toProfileDto = (p: WorkspaceProfile): WorkspaceProfileDto => ({
  name: p.name,
  companyName: p.companyName,
  businessServices: p.businessServices,
  productDescription: p.productDescription,
  hasLogo: p.logoAssetId !== null,
  logoVersion: p.logoSha256?.slice(0, 16) ?? null,
  version: p.version,
  updatedAt: p.updatedAt?.toISOString() ?? null,
});

/**
 * The business profile and logo of a workspace (ADM-02). Edits are
 * version-checked under a row lock and leave an audit event; the logo is
 * validated from its bytes before anything is written, so a bad upload can
 * never remove the current one.
 */
@Injectable()
export class ProfileService {
  constructor(@Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork) {}

  get(ws: WorkspaceId): Promise<WorkspaceProfileDto> {
    return this.uow.run(ws, async ({ profiles }) => {
      const p = await profiles.get(ws);
      if (!p) throw new LogoNotFoundError();
      return toProfileDto(p);
    });
  }

  async update(ws: WorkspaceId, raw: unknown, actor: Actor): Promise<WorkspaceProfileDto> {
    const { expectedVersion, ...input } = UpdateWorkspaceProfileRequest.parse(raw);
    return this.uow.run(ws, async ({ profiles, audit }) => {
      const before = await profiles.get(ws, { forUpdate: true });
      if (!before) throw new LogoNotFoundError();
      if (before.version !== expectedVersion) throw new ProfileStaleError(before.version);
      const patch: ProfilePatch = {};
      const changes: Record<string, { from: string; to: string }> = {};
      for (const f of FIELDS) {
        const next = input[f];
        if (next !== undefined && next !== before[f]) {
          patch[f] = next;
          changes[f] = { from: clip(before[f]), to: clip(next) };
        }
      }
      if (!Object.keys(patch).length) return toProfileDto(before);
      const after = await profiles.update(ws, patch, actor.userId);
      await audit.record(ws, actor, {
        action: 'workspace.profile_updated',
        targetType: 'workspace',
        targetId: ws,
        data: { changes },
      });
      return toProfileDto(after);
    });
  }

  /** Same image again changes nothing (an upload that is retried is safe). */
  /** `body` is whatever the HTTP layer parsed: only a Buffer (image/png, image/jpeg) can be a logo. */
  async setLogo(ws: WorkspaceId, body: unknown, actor: Actor): Promise<WorkspaceProfileDto> {
    if (!Buffer.isBuffer(body)) throw new LogoRejectedError('not_an_image');
    const bytes = body;
    const checked = inspectLogo(bytes);
    if (!checked.ok) {
      throw new LogoRejectedError(checked.reason, {
        ...(checked.width ? { width: checked.width, height: checked.height } : {}),
        rules: LOGO_RULES,
      });
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return this.uow.run(ws, async ({ profiles, audit }) => {
      const before = await profiles.get(ws, { forUpdate: true });
      if (before?.logoSha256 === sha256) return toProfileDto(before);
      const after = await profiles.setLogo(
        ws,
        { id: newId(), ...checked.image, sha256, data: bytes },
        actor.userId,
      );
      await audit.record(ws, actor, {
        action: 'workspace.logo_changed',
        targetType: 'workspace',
        targetId: ws,
        data: { ...checked.image, bytes: bytes.length },
      });
      return toProfileDto(after);
    });
  }

  async removeLogo(ws: WorkspaceId, actor: Actor): Promise<WorkspaceProfileDto> {
    return this.uow.run(ws, async ({ profiles, audit }) => {
      const before = await profiles.get(ws, { forUpdate: true });
      if (!before?.logoAssetId) return toProfileDto(before ?? ({} as WorkspaceProfile));
      const after = await profiles.clearLogo(ws, actor.userId);
      await audit.record(ws, actor, {
        action: 'workspace.logo_removed',
        targetType: 'workspace',
        targetId: ws,
      });
      return toProfileDto(after);
    });
  }

  logo(ws: WorkspaceId): Promise<{ mime: string; sha256: string; data: Buffer }> {
    return this.uow.run(ws, async ({ profiles }) => {
      const logo = await profiles.logo(ws);
      if (!logo) throw new LogoNotFoundError();
      return logo;
    });
  }
}
