import { AuditQuery, type AuditList } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, Inject, Query } from '@nestjs/common';

import {
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { AuditService } from '../../application/audit.service.js';

/** Thin controller: owners and admins read the trail. */
@WorkspaceScoped()
@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequireCapability('audit.view')
  @Get('audit-events')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditList> {
    return this.audit.list(ws, query);
  }
}
