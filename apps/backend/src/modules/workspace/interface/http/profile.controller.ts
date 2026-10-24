import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Patch,
  Put,
  Res,
} from '@nestjs/common';
import { UpdateWorkspaceProfileRequest, type WorkspaceProfileDto } from '@agent-sales/contracts';
import type { FastifyReply } from 'fastify';

import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ProfileService } from '../../application/profile.service.js';

const who = async (u: AuthState) => ({ userId: u.userId, name: (await u.displayName?.()) ?? null });

/** Thin controller: business profile and logo of the workspace. Any member reads; settings managers write. */
@WorkspaceScoped()
@Controller('workspace')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}

  @Get('profile')
  get(@CurrentWorkspace() ws: WorkspaceId): Promise<WorkspaceProfileDto> {
    return this.profile.get(ws);
  }

  @RequireCapability('settings.manage')
  @Patch('profile')
  async update(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body(new ZodValidationPipe(UpdateWorkspaceProfileRequest)) body: unknown,
  ): Promise<WorkspaceProfileDto> {
    return this.profile.update(ws, body, await who(user));
  }

  /**
   * The logo bytes. Served only to members of this workspace, with the type decided
   * at upload from the bytes, `nosniff` and a locked-down CSP so it can never run as a page.
   */
  @Get('logo')
  async logo(
    @CurrentWorkspace() ws: WorkspaceId,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer | undefined> {
    const logo = await this.profile.logo(ws);
    const etag = `"${logo.sha256}"`;
    void reply
      .header('ETag', etag)
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline');
    if (ifNoneMatch === etag) {
      void reply.status(304);
      return undefined;
    }
    void reply.header('Content-Type', logo.mime);
    return logo.data;
  }

  /** Raw PNG or JPEG body (parsed as a Buffer for these two types only; see bootstrap). */
  @RequireCapability('settings.manage')
  @Put('logo')
  async upload(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Body() body: unknown,
  ): Promise<WorkspaceProfileDto> {
    return this.profile.setLogo(ws, body, await who(user));
  }

  @RequireCapability('settings.manage')
  @Delete('logo')
  @HttpCode(200)
  async remove(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
  ): Promise<WorkspaceProfileDto> {
    return this.profile.removeLogo(ws, await who(user));
  }
}
