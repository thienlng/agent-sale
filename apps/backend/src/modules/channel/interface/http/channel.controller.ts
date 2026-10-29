import { randomBytes } from 'node:crypto';
import {
  ChannelListQuery,
  CreateWebsiteRequest,
  MetaProvider,
  SelectChannelRequest,
  UpdateChannelRequest,
  UpdateWebsiteRequest,
} from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../../../common/config.js';
import {
  type AuthState,
  CurrentUser,
  CurrentWorkspace,
  Public,
  RequireCapability,
  WorkspaceScoped,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ChannelFacadeImpl } from '../../application/channel.facade.impl.js';
const idPipe = new ZodValidationPipe(z.uuid());
/** The browser only sends the OAuth cookie to the path Meta redirects to, which may be a legacy one. */
function callbackPath(provider: MetaProvider): string {
  const configured = getEnv().META_OAUTH_REDIRECT_URI;
  return configured
    ? new URL(configured.replaceAll('{provider}', provider)).pathname
    : `/api/v1/channels/oauth/${provider}/callback`;
}
@Controller('channels')
export class ChannelController {
  private readonly log = new Logger(ChannelController.name);
  constructor(@Inject(ChannelFacadeImpl) private readonly channels: ChannelFacadeImpl) {}
  @WorkspaceScoped()
  @Get()
  list(
    @CurrentWorkspace() ws: WorkspaceId,
    @Query(new ZodValidationPipe(ChannelListQuery)) query: ChannelListQuery,
  ) {
    return this.channels.list(ws, { includeRemoved: query.includeRemoved === true });
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post(':provider/connect')
  async connect(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('provider', new ZodValidationPipe(MetaProvider)) provider: MetaProvider,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const browser = randomBytes(32).toString('base64url');
    const result = await this.channels.connect(ws, user.userId, provider, browser);
    reply.setCookie(`meta_oauth_${result.state}`, browser, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: callbackPath(provider),
      maxAge: 600,
    });
    return result;
  }
  @WorkspaceScoped()
  @Get('discoveries/:id')
  discovery(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
  ) {
    return this.channels.discovery(ws, user.userId, id);
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post('discoveries/:id/select')
  select(
    @CurrentWorkspace() ws: WorkspaceId,
    @CurrentUser() user: AuthState,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SelectChannelRequest)) body: z.infer<typeof SelectChannelRequest>,
  ) {
    return this.channels.select(ws, user.userId, id, body.externalIds);
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Post('website')
  createWebsite(
    @CurrentWorkspace() ws: WorkspaceId,
    @Body(new ZodValidationPipe(CreateWebsiteRequest)) body: CreateWebsiteRequest,
  ) {
    return this.channels.createWebsite(ws, body);
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Patch(':id/website')
  updateWebsite(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateWebsiteRequest)) body: UpdateWebsiteRequest,
  ) {
    return this.channels.updateWebsite(ws, id, body);
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Patch(':id')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateChannelRequest)) body: UpdateChannelRequest,
  ) {
    return this.channels.update(ws, id, body);
  }
  @RequireCapability('settings.manage')
  @WorkspaceScoped()
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentWorkspace() ws: WorkspaceId, @Param('id', idPipe) id: string): Promise<void> {
    return this.channels.remove(ws, id);
  }
  @Public()
  @Get('oauth/:provider/callback')
  async callback(
    @Param('provider', new ZodValidationPipe(MetaProvider)) provider: MetaProvider,
    @Query() query: Record<string, string | undefined>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const state = /^[A-Za-z0-9_-]{43}$/.test(query['state'] ?? '') ? (query['state'] ?? '') : '';
    let discoveryId: string | undefined;
    let error: string | undefined;
    try {
      discoveryId = await this.channels.callback(
        provider,
        state,
        req.cookies[`meta_oauth_${state}`] ?? '',
        query['code'] ?? null,
      );
    } catch (cause) {
      error = 'authorization_failed';
      // The reason is a code or Meta error text, never a token; the popup only shows a generic error.
      this.log.warn(`OAuth callback failed for ${provider}: ${(cause as Error).message}`);
    }
    reply.clearCookie(`meta_oauth_${state}`, {
      path: callbackPath(provider),
    });
    const nonce = randomBytes(16).toString('base64');
    const origin = getEnv().META_APP_ORIGIN ?? '';
    const payload = JSON.stringify({
      type: 'rapiz:oauth:complete',
      state,
      ...(discoveryId ? { discoveryId } : { error }),
    }).replace(/</g, '\\u003c');
    const target = JSON.stringify(origin).replace(/</g, '\\u003c');
    reply
      .header('Cross-Origin-Opener-Policy', 'unsafe-none')
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      )
      .type('text/html')
      .send(
        `<!doctype html><html><meta charset="utf-8"><title>Rapiz</title><body><script nonce="${nonce}">const message=${payload};try{if(window.opener)window.opener.postMessage(message,${target})}catch(e){}const channel=new BroadcastChannel('rapiz-meta-oauth');channel.postMessage(message);setTimeout(()=>{channel.close();window.close()},300);</script></body></html>`,
      );
  }
}
