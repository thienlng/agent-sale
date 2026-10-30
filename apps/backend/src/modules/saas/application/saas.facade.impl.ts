import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceId } from '@agent-sales/shared';

import type { SaasFacade } from '../api/saas.facade.js';
import { SaasRequestService } from './saas-request.service.js';

/** Delegates to the use-case services; no logic of its own. */
@Injectable()
export class SaasFacadeImpl implements SaasFacade {
  constructor(@Inject(SaasRequestService) private readonly requests: SaasRequestService) {}

  recordBotRequest(ws: WorkspaceId, input: Parameters<SaasFacade['recordBotRequest']>[1]) {
    return this.requests.recordFromBot(ws, input);
  }
}
