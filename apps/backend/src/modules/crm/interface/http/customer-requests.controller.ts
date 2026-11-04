import type { CustomerRequestList, RequestSummaryDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Controller, Get, Inject, Param } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { CustomerRequestService } from '../../application/customer-request.service.js';

/** Thin controller: requests the bot recorded on customers (ESV spec §4.4). */
@WorkspaceScoped()
@Controller()
export class CustomerRequestsController {
  constructor(@Inject(CustomerRequestService) private readonly requests: CustomerRequestService) {}

  /** Counts across every customer: contacts.view_all, like the SaaS summary. */
  @RequireCapability('contacts.view_all')
  @Get('crm/requests/summary')
  summary(@CurrentWorkspace() ws: WorkspaceId): Promise<RequestSummaryDto> {
    return this.requests.summary(ws);
  }

  @RequireCapability('contacts.view')
  @Get('contacts/:contactId/requests')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('contactId') id: string,
  ): Promise<CustomerRequestList> {
    return this.requests.listForContact(ws, id, { userId: user.userId, role: user.role });
  }
}
