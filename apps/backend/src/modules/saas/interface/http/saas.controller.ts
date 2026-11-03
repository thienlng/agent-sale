import type {
  ContactSaasSubscription,
  SaasPlanDto,
  SaasPlanList,
  SaasSubscriptionHistory,
} from '@agent-sales/contracts';
import {
  CreateSaasPlan,
  PutSaasSubscription,
  SaasSubscriptionListQuery,
  roleCan,
  type SaasSubscriptionDto,
  type SaasSubscriptionList,
  type SaasSummary,
  UpdateSaasPlan,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import { ApiError } from '../../../../common/http/api-error.js';
import {
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { SaasPlanService } from '../../application/saas-plan.service.js';
import { SaasSubscriptionService } from '../../application/saas-subscription.service.js';

const who = async (u: AuthState) => ({ userId: u.userId, name: (await u.displayName?.()) ?? null });
const Id = new ZodValidationPipe(z.uuid());

/** Subscriptions and MRR are revenue across customers: contacts.view_all to read. */
@WorkspaceScoped()
@Controller()
export class SaasSubscriptionsController {
  constructor(
    @Inject(SaasSubscriptionService) private readonly subscriptions: SaasSubscriptionService,
    @Inject(SaasPlanService) private readonly plans: SaasPlanService,
  ) {}

  @Get('saas-subscriptions')
  @RequireCapability('contacts.view_all')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(SaasSubscriptionListQuery)) q: SaasSubscriptionListQuery,
  ): Promise<SaasSubscriptionList> {
    return this.subscriptions.list(ws, q);
  }

  @Get('saas-subscriptions/summary')
  @RequireCapability('contacts.view_all')
  summary(@CurrentWorkspace() ws: WorkspaceId): Promise<SaasSummary> {
    return this.subscriptions.summary(ws);
  }

  @Get('contacts/:id/saas-subscription')
  @RequireCapability('contacts.view_all')
  async forContact(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', Id) id: string,
  ): Promise<ContactSaasSubscription> {
    return { subscription: await this.subscriptions.forContact(ws, id) };
  }

  /** Writing also needs contacts.edit (owner and admin; an analyst only reads). */
  @Put('contacts/:id/saas-subscription')
  @RequireCapability('contacts.view_all')
  async put(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(PutSaasSubscription)) body: PutSaasSubscription,
  ): Promise<SaasSubscriptionDto> {
    if (!roleCan(actor.role, 'contacts.edit'))
      throw new ApiError('FORBIDDEN', 'You cannot change customer subscriptions');
    return this.subscriptions.put(ws, id, body, await who(actor));
  }

  @Get('contacts/:id/saas-subscription/history')
  @RequireCapability('contacts.view_all')
  async history(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', Id) id: string,
  ): Promise<SaasSubscriptionHistory> {
    return { data: await this.subscriptions.history(ws, id) };
  }

  /** The catalog is read by whoever edits subscriptions; changing it is a settings task. */
  @Get('saas-plans')
  @RequireCapability('contacts.view_all')
  async listPlans(@CurrentWorkspace() ws: WorkspaceId): Promise<SaasPlanList> {
    return { data: await this.plans.list(ws) };
  }

  @Post('saas-plans')
  @HttpCode(201)
  @RequireCapability('settings.manage')
  async createPlan(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Body(new ZodValidationPipe(CreateSaasPlan)) body: CreateSaasPlan,
  ): Promise<SaasPlanDto> {
    return this.plans.create(ws, body, await who(actor));
  }

  @Patch('saas-plans/:planId')
  @RequireCapability('settings.manage')
  async updatePlan(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('planId', Id) planId: string,
    @Body(new ZodValidationPipe(UpdateSaasPlan)) body: UpdateSaasPlan,
  ): Promise<SaasPlanDto> {
    return this.plans.update(ws, planId, body, await who(actor));
  }
}
