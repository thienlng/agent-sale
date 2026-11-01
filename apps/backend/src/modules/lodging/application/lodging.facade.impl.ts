import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { LodgingFacade } from '../api/lodging.facade.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/** The lodging use cases other modules may call. */
@Injectable()
export class LodgingFacadeImpl implements LodgingFacade {
  constructor(@Inject(LODGING_STORE) private readonly store: LodgingStore) {}

  listBotPropertyIds(ws: WorkspaceId, botId: string): Promise<string[]> {
    return this.store.run(ws, async (tx) => {
      const ids = await tx.botPropertyIds(botId);
      return ids ?? (await tx.properties({ activeOnly: true })).map((p) => p.id);
    });
  }
}
