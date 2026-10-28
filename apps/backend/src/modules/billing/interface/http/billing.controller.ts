import type { EntitlementsDto, MessageUsageDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, Inject } from '@nestjs/common';

import { CurrentWorkspace, WorkspaceScoped } from '../../../../common/http/auth-context.js';
import { BillingService } from '../../application/billing.service.js';

/** Thin controller: any member may read what the plan allows (the UI locks buttons with it). */
@WorkspaceScoped()
@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('billing/entitlements')
  entitlements(@CurrentWorkspace() ws: WorkspaceId): Promise<EntitlementsDto> {
    return this.billing.entitlements(ws);
  }

  /** Shared by the account's businesses; any member sees it (the dashboard banner). */
  @Get('billing/usage')
  usage(@CurrentWorkspace() ws: WorkspaceId): Promise<MessageUsageDto> {
    return this.billing.usage(ws);
  }
}
