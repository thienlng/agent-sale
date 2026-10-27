import { Controller, Get, Inject, Param } from '@nestjs/common';
import { z } from 'zod';
import type { WorkspaceId } from '@agent-sales/shared';

import { CurrentWorkspace, WorkspaceScoped } from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { WEBCHAT_FACADE, type WebchatFacade } from '../../api/webchat.facade.js';

/** Staff side: what the inbox side panel shows about a website visitor. */
@Controller('webchat')
export class WebchatController {
  constructor(@Inject(WEBCHAT_FACADE) private readonly facade: WebchatFacade) {}

  @WorkspaceScoped()
  @Get('conversations/:conversationId/visitor')
  visitor(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('conversationId', new ZodValidationPipe(z.uuid())) conversationId: string,
  ) {
    return this.facade.getVisitor(ws, conversationId);
  }
}
