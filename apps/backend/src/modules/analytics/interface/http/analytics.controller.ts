import type { DefinitionsResponse } from '@agent-sales/contracts';
import { Controller, Get, Inject } from '@nestjs/common';

import { RequireCapability, WorkspaceScoped } from '../../../../common/http/auth-context.js';
import { ANALYTICS_FACADE, type AnalyticsFacade } from '../../api/analytics.facade.js';

/** Thin controller: Zod-validate (packages/contracts) → facade → DTO. */
@WorkspaceScoped()
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(ANALYTICS_FACADE) private readonly facade: AnalyticsFacade) {}

  @RequireCapability('analytics.view')
  @Get('definitions')
  definitions(): DefinitionsResponse {
    return this.facade.definitions();
  }
}
