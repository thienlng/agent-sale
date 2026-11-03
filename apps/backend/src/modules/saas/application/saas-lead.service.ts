import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { SaasError } from '../domain/saas.errors.js';

/**
 * The industry gate of the SaaS screens. Bot-recorded demo / trial / consultation requests moved
 * to the crm request writer (ADR-025); the subscription is still the only writer of the
 * subscription statuses (ADR-020).
 */
@Injectable()
export class SaasLeadService {
  constructor(@Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade) {}

  /** The SaaS screens and tools exist only for SaaS businesses; others see 404. */
  async assertSaas(ws: WorkspaceId): Promise<void> {
    if ((await this.workspaces.getById(ws)).industry !== 'saas')
      throw new SaasError('NOT_FOUND', 'SaaS workspace not found');
  }
}
