import {
  CreateApiKeyRequest,
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  WebhookDeliveryQuery,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  RequireRecentAuth,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import {
  IDENTITY_API_KEYS_FACADE,
  type IdentityApiKeysFacade,
} from '../../../identity/api/index.js';
import { WebhookEndpointService } from '../../application/webhook-endpoint.service.js';

/** Settings → Developers (ADR-022): API keys (owned by identity) and webhook endpoints. */
@Controller()
export class DeveloperController {
  constructor(
    @Inject(IDENTITY_API_KEYS_FACADE) private readonly apiKeys: IdentityApiKeysFacade,
    @Inject(WebhookEndpointService) private readonly webhooks: WebhookEndpointService,
  ) {}

  @Get('api-keys')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  async listApiKeys(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.apiKeys.list(ws) };
  }

  @Post('api-keys')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  @RequireRecentAuth()
  createApiKey(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateApiKeyRequest)) body: CreateApiKeyRequest,
  ) {
    return this.apiKeys.create(ws, user.userId, body);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  revokeApiKey(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id') id: string,
  ) {
    return this.apiKeys.revoke(ws, id, user.userId);
  }

  @Get('webhook-endpoints')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  async listEndpoints(@CurrentWorkspace() ws: WorkspaceId) {
    return { data: await this.webhooks.list(ws) };
  }

  @Post('webhook-endpoints')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  createEndpoint(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(CreateWebhookEndpointRequest)) body: CreateWebhookEndpointRequest,
  ) {
    return this.webhooks.create(ws, user.userId, body);
  }

  @Patch('webhook-endpoints/:id')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  updateEndpoint(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWebhookEndpointRequest)) body: UpdateWebhookEndpointRequest,
  ) {
    return this.webhooks.update(ws, id, body);
  }

  @Delete('webhook-endpoints/:id')
  @HttpCode(204)
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  async deleteEndpoint(@CurrentWorkspace() ws: WorkspaceId, @Param('id') id: string) {
    await this.webhooks.remove(ws, id);
  }

  @Post('webhook-endpoints/:id/rotate-secret')
  @HttpCode(200)
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  rotateSecret(@CurrentWorkspace() ws: WorkspaceId, @Param('id') id: string) {
    return this.webhooks.rotateSecret(ws, id);
  }

  @Post('webhook-endpoints/:id/test')
  @HttpCode(202)
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  sendTest(@CurrentWorkspace() ws: WorkspaceId, @Param('id') id: string) {
    return this.webhooks.sendTest(ws, id);
  }

  @Get('webhook-endpoints/:id/deliveries')
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  deliveries(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(WebhookDeliveryQuery)) q: WebhookDeliveryQuery,
  ) {
    return this.webhooks.deliveries(ws, id, q);
  }

  @Post('webhook-deliveries/:id/resend')
  @HttpCode(202)
  @WorkspaceScoped()
  @RequireCapability('developer.manage')
  resend(@CurrentWorkspace() ws: WorkspaceId, @Param('id') id: string) {
    return this.webhooks.resend(ws, id);
  }
}
