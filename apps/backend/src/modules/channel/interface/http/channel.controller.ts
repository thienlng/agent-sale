import { randomBytes } from 'node:crypto';
import { MetaProvider, SelectChannelRequest, UpdateChannelRequest } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnv } from '../../../../common/config.js';
import {
  CurrentUser,
  CurrentWorkspace,
  Public,
  WorkspaceScoped,
  type AuthState,
} from '../../../../common/http/auth-context.js';
import { ZodValidationPipe } from '../../../../common/http/zod-validation.pipe.js';
import { ChannelFacadeImpl } from '../../application/channel.facade.impl.js';
const idPipe = new ZodValidationPipe(z.uuid());
@Controller('channels')
export class ChannelController {
  constructor(@Inject(ChannelFacadeImpl) private readonly channels: ChannelFacadeImpl) {}
  @WorkspaceScoped()
  @Get()
  list(@CurrentWorkspace() ws: WorkspaceId) {
    return this.channels.list(ws);
  }
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
      path: `/api/v1/channels/oauth/${provider}/callback`,
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
  @WorkspaceScoped()
  @Patch(':id')
  update(
    @CurrentWorkspace() ws: WorkspaceId,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateChannelRequest)) body: UpdateChannelRequest,
  ) {
    return this.channels.update(ws, id, body);
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
    } catch {
      error = 'authorization_failed';
    }
    reply.clearCookie(`meta_oauth_${state}`, {
      path: `/api/v1/channels/oauth/${provider}/callback`,
    });
    const nonce = randomBytes(16).toString('base64');
    const origin = getEnv().META_APP_ORIGIN ?? '';
    const payload = JSON.stringify({
      type: 'razpi:oauth:complete',
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
        `<!doctype html><html><meta charset="utf-8"><title>Razpi</title><body><script nonce="${nonce}">const message=${payload};if(window.opener)window.opener.postMessage(message,${target});const channel=new BroadcastChannel('razpi-meta-oauth');channel.postMessage(message);setTimeout(()=>{channel.close();window.close()},300);</script></body></html>`,
      );
  }
}
