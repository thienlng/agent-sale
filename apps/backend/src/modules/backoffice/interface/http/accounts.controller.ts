import {
  type AdminAccountDetail,
  type AdminAccountList,
  AdminAccountListQuery,
  type AdminOverrideDto,
  type AdminPaymentDto,
  AdminReasonRequest,
  type AdminSubscriptionDto,
  CreatePaymentRequest,
  ExtendTrialRequest,
  PutOverrideRequest,
  SetAccountPlanRequest,
  SetAccountStatusRequest,
} from '@agent-sales/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  PlatformAdmin,
  RequireRecentAuth,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ACCOUNT_FACADE, type AccountFacade } from '../../../account/api/index.js';
import { BILLING_ADMIN_FACADE, type BillingAdminFacade } from '../../../billing/api/index.js';
import { BACKOFFICE_FACADE, type BackofficeFacade } from '../../api/backoffice.facade.js';
import { adminActor } from './admin-actor.js';

/** Customer accounts: read views and operator actions (ADR-021 §6). Non-admins get 404. */
@PlatformAdmin()
@Controller('admin/accounts')
export class AccountsController {
  constructor(
    @Inject(BACKOFFICE_FACADE) private readonly backoffice: BackofficeFacade,
    @Inject(ACCOUNT_FACADE) private readonly accounts: AccountFacade,
    @Inject(BILLING_ADMIN_FACADE) private readonly billing: BillingAdminFacade,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(AdminAccountListQuery)) query: AdminAccountListQuery,
  ): Promise<AdminAccountList> {
    return this.backoffice.listAccounts(query);
  }

  @Get(':accountId')
  detail(@Param('accountId') accountId: string): Promise<AdminAccountDetail> {
    return this.backoffice.accountDetail(accountId);
  }

  @Post(':accountId/plan')
  @RequireRecentAuth()
  @HttpCode(200)
  async setPlan(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(SetAccountPlanRequest)) body: SetAccountPlanRequest,
  ): Promise<AdminSubscriptionDto> {
    return this.billing.setAccountPlan(accountId, body, await adminActor(user));
  }

  @Post(':accountId/trial')
  @RequireRecentAuth()
  @HttpCode(200)
  async extendTrial(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(ExtendTrialRequest)) body: ExtendTrialRequest,
  ): Promise<AdminSubscriptionDto> {
    return this.billing.extendTrial(accountId, body, await adminActor(user));
  }

  @Put(':accountId/overrides/:key')
  @RequireRecentAuth()
  async putOverride(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(PutOverrideRequest)) body: PutOverrideRequest,
  ): Promise<AdminOverrideDto> {
    return this.billing.putOverride(accountId, key, body, await adminActor(user));
  }

  @Delete(':accountId/overrides/:key')
  @RequireRecentAuth()
  @HttpCode(204)
  async deleteOverride(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(AdminReasonRequest)) body: AdminReasonRequest,
  ): Promise<void> {
    await this.billing.deleteOverride(accountId, key, body.reason, await adminActor(user));
  }

  @Post(':accountId/status')
  @RequireRecentAuth()
  @HttpCode(204)
  async setStatus(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(SetAccountStatusRequest)) body: SetAccountStatusRequest,
  ): Promise<void> {
    const actor = await adminActor(user);
    await this.accounts.setStatus(accountId, body.status, {
      actorUserId: actor.userId,
      actorName: actor.name,
      reason: body.reason,
    });
  }

  @Post(':accountId/payments')
  @RequireRecentAuth()
  @HttpCode(201)
  async createPayment(
    @CurrentUser() user: AuthState,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(CreatePaymentRequest)) body: CreatePaymentRequest,
  ): Promise<AdminPaymentDto> {
    return this.billing.createPayment(accountId, body, await adminActor(user));
  }
}
