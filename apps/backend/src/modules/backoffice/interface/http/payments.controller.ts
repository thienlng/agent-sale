import {
  type AdminAuditList,
  AdminAuditQuery,
  type AdminPaymentDto,
  type AdminPaymentList,
  AdminPaymentListQuery,
  AdminReasonRequest,
  ConfirmPaymentRequest,
} from '@agent-sales/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  PlatformAdmin,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { BILLING_ADMIN_FACADE, type BillingAdminFacade } from '../../../billing/api/index.js';
import { BACKOFFICE_FACADE, type BackofficeFacade } from '../../api/backoffice.facade.js';
import { adminActor } from './admin-actor.js';

/** VietQR payment requests with manual confirm, and the platform audit trail. Non-admins get 404. */
@PlatformAdmin()
@Controller('admin')
export class PaymentsController {
  constructor(
    @Inject(BILLING_ADMIN_FACADE) private readonly billing: BillingAdminFacade,
    @Inject(BACKOFFICE_FACADE) private readonly backoffice: BackofficeFacade,
  ) {}

  @Get('payments')
  payments(
    @Query(new ZodValidationPipe(AdminPaymentListQuery)) query: AdminPaymentListQuery,
  ): Promise<AdminPaymentList> {
    return this.billing.listPayments(query);
  }

  @Post('payments/:paymentId/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentUser() user: AuthState,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(ConfirmPaymentRequest)) body: ConfirmPaymentRequest,
  ): Promise<AdminPaymentDto> {
    return this.billing.confirmPayment(paymentId, body, await adminActor(user));
  }

  @Post('payments/:paymentId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthState,
    @Param('paymentId') paymentId: string,
    @Body(new ZodValidationPipe(AdminReasonRequest)) body: AdminReasonRequest,
  ): Promise<AdminPaymentDto> {
    return this.billing.cancelPayment(paymentId, body.reason, await adminActor(user));
  }

  @Get('audit')
  audit(
    @Query(new ZodValidationPipe(AdminAuditQuery)) query: AdminAuditQuery,
  ): Promise<AdminAuditList> {
    return this.backoffice.listAudit(query);
  }
}
