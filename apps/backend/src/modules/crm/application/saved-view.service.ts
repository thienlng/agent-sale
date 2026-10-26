import {
  CreateSavedViewRequest,
  type SavedViewDto,
  UpdateSavedViewRequest,
  roleCan,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  SavedViewNotFoundError,
  ShareNotAllowedError,
  StaleVersionError,
  ViewNotOwnedError,
} from '../domain/crm.errors.js';
import { toViewDto } from './crm.mappers.js';
import { CRM_STORE, type CrmStore, type CrmTx, type ViewRecord } from './ports/crm-store.js';

/**
 * Saved customer views (CRM-02). A private view is visible to its owner only —
 * to anyone else it does not exist (404). Shared views are readable by every
 * member; only the owner changes or deletes a view.
 */
@Injectable()
export class SavedViewService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  list(ws: WorkspaceId, actor: string): Promise<SavedViewDto[]> {
    return this.store.run(ws, async (tx) =>
      (await tx.views.list(actor)).map((v) => toViewDto(v, actor)),
    );
  }

  async create(ws: WorkspaceId, raw: unknown, actor: string, role?: string): Promise<SavedViewDto> {
    const input = CreateSavedViewRequest.parse(raw);
    if (input.visibility === 'shared' && !roleCan(role, 'views.share')) {
      throw new ShareNotAllowedError();
    }
    const ownerName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const view: ViewRecord = {
        id: newId(),
        ownerUserId: actor,
        ownerName,
        ...input,
        version: 1,
        updatedAt: new Date(),
      };
      await tx.views.insert(ws, view);
      return toViewDto(view, actor);
    });
  }

  update(
    ws: WorkspaceId,
    id: string,
    raw: unknown,
    actor: string,
    role?: string,
  ): Promise<SavedViewDto> {
    const { expectedVersion, ...patch } = UpdateSavedViewRequest.parse(raw);
    if (patch.visibility === 'shared' && !roleCan(role, 'views.share')) {
      throw new ShareNotAllowedError();
    }
    return this.store.run(ws, async (tx) => {
      const view = await this.#owned(tx, id, actor);
      if (view.version !== expectedVersion) throw new StaleVersionError('view', view.version);
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<ViewRecord>;
      const next = { ...view, ...defined, version: view.version + 1, updatedAt: new Date() };
      await tx.views.update(next);
      return toViewDto(next, actor);
    });
  }

  delete(ws: WorkspaceId, id: string, actor: string): Promise<void> {
    return this.store.run(ws, async (tx) => {
      await this.#owned(tx, id, actor);
      await tx.views.delete(id);
    });
  }

  async #owned(tx: CrmTx, id: string, actor: string): Promise<ViewRecord> {
    const view = isUuid(id) ? await tx.views.find(id, { forUpdate: true }) : null;
    const visible = view && (view.visibility === 'shared' || view.ownerUserId === actor);
    if (!view || !visible) throw new SavedViewNotFoundError(id);
    if (view.ownerUserId !== actor) throw new ViewNotOwnedError(id);
    return view;
  }
}
