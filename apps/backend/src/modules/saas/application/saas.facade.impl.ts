import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceId } from '@agent-sales/shared';

import type { SaasFacade } from '../api/saas.facade.js';
import { SaasLeadService } from './saas-lead.service.js';

/** Delegates to the use-case services; no logic of its own. */
@Injectable()
export class SaasFacadeImpl implements SaasFacade {
  constructor(@Inject(SaasLeadService) private readonly leads: SaasLeadService) {}

  recordBotRequest(ws: WorkspaceId, input: Parameters<SaasFacade['recordBotRequest']>[1]) {
    return this.leads.recordFromBot(ws, input);
  }
}
