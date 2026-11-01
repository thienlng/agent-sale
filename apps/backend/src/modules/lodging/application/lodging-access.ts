import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { LodgingError } from '../domain/lodging.errors.js';

/** Lodging exists only for hotel businesses; every other workspace sees 404 on every route. */
@Injectable()
export class LodgingAccess {
  constructor(@Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade) {}

  async assertHotel(ws: WorkspaceId): Promise<void> {
    if ((await this.workspaces.getById(ws)).industry !== 'hotel')
      throw new LodgingError('NOT_FOUND', 'Lodging workspace not found');
  }
}
