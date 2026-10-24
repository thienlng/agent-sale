import {
  CreateLlmProviderRequest,
  type HermesLoginStatus,
  type LlmProviderDto,
  type LlmTierRouteDto,
  PutLlmTierRouteRequest,
  TestLlmProviderRequest,
  type TestLlmProviderResponse,
  UpdateLlmProviderRequest,
} from '@agent-sales/contracts';
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
  Put,
} from '@nestjs/common';

import {
  type AuthState,
  CurrentUser,
  PlatformAdmin,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { LlmAdminService } from '../../application/llm-admin.service.js';

/** Platform back-office for LLM providers and tier routing. Non-admins get 404. */
@PlatformAdmin()
@Controller('admin/llm')
export class LlmAdminController {
  constructor(@Inject(LlmAdminService) private readonly admin: LlmAdminService) {}

  @Get('providers')
  async providers(): Promise<{ data: LlmProviderDto[] }> {
    return { data: await this.admin.listProviders() };
  }

  @Post('providers')
  @HttpCode(201)
  createProvider(
    @Body(new ZodValidationPipe(CreateLlmProviderRequest)) body: CreateLlmProviderRequest,
  ): Promise<LlmProviderDto> {
    return this.admin.createProvider(body);
  }

  @Patch('providers/:providerId')
  updateProvider(
    @Param('providerId') id: string,
    @Body(new ZodValidationPipe(UpdateLlmProviderRequest)) body: UpdateLlmProviderRequest,
  ): Promise<LlmProviderDto> {
    return this.admin.updateProvider(id, body);
  }

  @Delete('providers/:providerId')
  @HttpCode(204)
  deleteProvider(@Param('providerId') id: string): Promise<void> {
    return this.admin.deleteProvider(id);
  }

  @Post('providers/:providerId/test')
  @HttpCode(200)
  testProvider(
    @Param('providerId') id: string,
    @Body(new ZodValidationPipe(TestLlmProviderRequest)) body: TestLlmProviderRequest,
  ): Promise<TestLlmProviderResponse> {
    return this.admin.testProvider(id, body.model);
  }

  @Get('providers/:providerId/hermes-login')
  hermesLoginStatus(@Param('providerId') id: string): Promise<HermesLoginStatus> {
    return this.admin.hermesLogin(id, 'status');
  }

  @Post('providers/:providerId/hermes-login')
  @HttpCode(200)
  hermesLoginStart(@Param('providerId') id: string): Promise<HermesLoginStatus> {
    return this.admin.hermesLogin(id, 'start');
  }

  @Delete('providers/:providerId/hermes-login')
  @HttpCode(200)
  hermesLoginLogout(@Param('providerId') id: string): Promise<HermesLoginStatus> {
    return this.admin.hermesLogin(id, 'logout');
  }

  @Get('tiers')
  async tiers(): Promise<{ data: LlmTierRouteDto[] }> {
    return { data: await this.admin.listRoutes() };
  }

  @Put('tiers/:tier')
  putTier(
    @Param('tier') tier: string,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(PutLlmTierRouteRequest)) body: PutLlmTierRouteRequest,
  ): Promise<LlmTierRouteDto> {
    return this.admin.putRoute(tier, body, user.userId);
  }
}
