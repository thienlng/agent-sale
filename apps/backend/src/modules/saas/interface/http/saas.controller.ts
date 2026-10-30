import type { ContactSaasSubscription } from '@agent-sales/contracts';
import {
  CreateSaasRequest,
  PutSaasSubscription,
  SaasRequestListQuery,
  SaasSubscriptionListQuery,
  roleCan,
  type SaasRequestDto,
  type SaasRequestList,
  type SaasSubscriptionDto,
  type SaasSubscriptionList,
  type SaasSummary,
  UpdateSaasRequest,
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
import { SaasRequestService } from '../../application/saas-request.service.js';
import { SaasSubscriptionService } from '../../application/saas-subscription.service.js';

const who = async (u: AuthState) => ({ userId: u.userId, name: (await u.displayName?.()) ?? null });
const Id = new ZodValidationPipe(z.uuid());

/** Demo / trial / consultation requests: every member who sees customers sees them. */
@WorkspaceScoped()
@Controller('saas-requests')
export class SaasRequestsController {
  constructor(@Inject(SaasRequestService) private readonly requests: SaasRequestService) {}

  @Get()
  @RequireCapability('contacts.view')
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(SaasRequestListQuery)) q: SaasRequestListQuery,
  ): Promise<SaasRequestList> {
    return this.requests.list(ws, q);
  }

  @Post()
  @HttpCode(201)
  @RequireCapability('contacts.edit')
  async create(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Body(new ZodValidationPipe(CreateSaasRequest)) body: CreateSaasRequest,
  ): Promise<SaasRequestDto> {
    return this.requests.create(ws, body, await who(actor));
  }

  @Get(':id')
  @RequireCapability('contacts.view')
  get(@CurrentWorkspace() ws: WorkspaceId, @Param('id', Id) id: string): Promise<SaasRequestDto> {
    return this.requests.get(ws, id);
  }

  @Patch(':id')
  @RequireCapability('contacts.edit')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() actor: AuthState,
    @Param('id', Id) id: string,
    @Body(new ZodValidationPipe(UpdateSaasRequest)) body: UpdateSaasRequest,
  ): Promise<SaasRequestDto> {
    return this.requests.update(ws, id, body, await who(actor));
  }
}

/** Subscriptions and MRR are revenue across customers: contacts.view_all to read. */
@WorkspaceScoped()
@Controller()
export class SaasSubscriptionsController {
  constructor(
    @Inject(SaasSubscriptionService) private readonly subscriptions: SaasSubscriptionService,
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
}
