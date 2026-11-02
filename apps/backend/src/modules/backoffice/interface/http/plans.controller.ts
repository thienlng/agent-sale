import {
  type AdminPlanDto,
  type AdminPlanList,
  ArchivePlanRequest,
  type BillingSettingsDto,
  CreatePlanRequest,
  PublishPlanVersionRequest,
  PutBillingSettingsRequest,
} from '@agent-sales/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  PlatformAdmin,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { BILLING_ADMIN_FACADE, type BillingAdminFacade } from '../../../billing/api/index.js';
import { adminActor } from './admin-actor.js';

/** Plan catalog and billing settings (ADR-021 §6). Non-admins get 404. */
@PlatformAdmin()
@Controller('admin')
export class PlansController {
  constructor(@Inject(BILLING_ADMIN_FACADE) private readonly billing: BillingAdminFacade) {}

  @Get('plans')
  async plans(): Promise<AdminPlanList> {
    return { data: await this.billing.listPlans() };
  }

  @Post('plans')
  @HttpCode(201)
  async createPlan(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreatePlanRequest)) body: CreatePlanRequest,
  ): Promise<AdminPlanDto> {
    return this.billing.createPlan(body, await adminActor(user));
  }

  @Post('plans/:code/versions')
  @HttpCode(201)
  async publishVersion(
    @CurrentUser() user: AuthState,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(PublishPlanVersionRequest)) body: PublishPlanVersionRequest,
  ): Promise<AdminPlanDto> {
    return this.billing.publishPlanVersion(code, body, await adminActor(user));
  }

  @Post('plans/:code/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: AuthState,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(ArchivePlanRequest)) body: ArchivePlanRequest,
  ): Promise<AdminPlanDto> {
    return this.billing.archivePlan(code, body, await adminActor(user));
  }

  @Get('billing-settings')
  settings(): Promise<BillingSettingsDto> {
    return this.billing.settings();
  }

  @Put('billing-settings')
  async putSettings(
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(PutBillingSettingsRequest)) body: PutBillingSettingsRequest,
  ): Promise<BillingSettingsDto> {
    return this.billing.putSettings(body, await adminActor(user));
  }
}
