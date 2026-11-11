import type { CareMessageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { CareFacade } from '../api/care.facade.js';
import { CARE_STORE, type CareStore } from '../domain/ports/care.store.js';
import { toCareMessageDto } from './approval.service.js';

/** The care module's use cases for other modules. */
@Injectable()
export class CareFacadeImpl implements CareFacade {
  constructor(@Inject(CARE_STORE) private readonly store: CareStore) {}

  async messagesOf(ws: WorkspaceId, conversationId: string): Promise<CareMessageDto[]> {
    return (await this.store.messagesOf(ws, conversationId, 50)).map(toCareMessageDto);
  }
}
