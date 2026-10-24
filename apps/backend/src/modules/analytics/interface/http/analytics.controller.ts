import {
  AnalyticsQuery,
  type AnalyticsResponse,
  type DefinitionsResponse,
  DrilldownRequest,
  type DrilldownResponse,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ANALYTICS_FACADE, type AnalyticsFacade } from '../../api/analytics.facade.js';
import { QueryService } from '../../application/query.service.js';

const viewer = (u: AuthState) => ({ userId: u.userId, role: u.role });

/** Thin controller: Zod-validate (packages/contracts) → service → DTO. Visibility follows the role. */
@WorkspaceScoped()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    @Inject(ANALYTICS_FACADE) private readonly facade: AnalyticsFacade,
    @Inject(QueryService) private readonly queries: QueryService,
  ) {}

  @RequireCapability('analytics.view')
  @Get('definitions')
  definitions(): DefinitionsResponse {
    return this.facade.definitions();
  }

  @RequireCapability('analytics.view')
  @Post('query')
  @HttpCode(200)
  query(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(AnalyticsQuery)) body: AnalyticsQuery,
  ): Promise<AnalyticsResponse> {
    return this.queries.query(ws, body, viewer(user));
  }

  @RequireCapability('analytics.view')
  @Post('drilldown')
  @HttpCode(200)
  drilldown(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(DrilldownRequest)) body: unknown,
  ): Promise<DrilldownResponse> {
    return this.queries.drilldown(ws, DrilldownRequest.parse(body) as never, viewer(user));
  }
}
