import { BotTurnListQuery, type BotTurnDetail, type BotTurnList } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';

import {
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { TurnTraceService } from '../../application/turn-trace.service.js';

/** Thin controller: GET /bots/{botId}/turns and /bots/{botId}/turns/{runId} (T-174). */
@WorkspaceScoped()
@Controller('bots')
export class TurnTraceController {
  constructor(@Inject(TurnTraceService) private readonly turns: TurnTraceService) {}

  @RequireCapability('bots.manage')
  @Get(':botId/turns')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Query(new ZodValidationPipe(BotTurnListQuery)) query: BotTurnListQuery,
  ): Promise<BotTurnList> {
    return this.turns.list(ws, botId, query);
  }

  @RequireCapability('bots.manage')
  @Get(':botId/turns/:runId')
  get(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('botId') botId: string,
    @Param('runId') runId: string,
  ): Promise<BotTurnDetail> {
    return this.turns.get(ws, botId, runId);
  }
}
