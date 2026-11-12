import type { Database } from '@agent-sales/db';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { API_PREFIX } from '../../common/http/api-prefix.js';
import { getEnv } from '../../common/config.js';
import { DB_TENANT } from '../../common/db/db.module.js';
import { sharedLimiter } from '../../common/limits/limiter.js';
import { BotModule } from '../bot/bot.module.js';
import { ChannelModule } from '../channel/channel.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { WEBCHAT_FACADE } from './api/webchat.facade.js';
import { WEBCHAT_RUNNER } from './api/webchat.runner.js';
import { UploadPurgeRunner } from './application/jobs/upload-purge.runner.js';
import { WEBCHAT_UPLOAD_STORAGE } from './application/ports/upload-storage.js';
import { VISITOR_STORE } from './application/ports/visitor-store.js';
import { RATE_LIMITER } from './application/rate-limiter.js';
import { WEBCHAT_OPTIONS, type WebchatOptions } from './application/ports/webchat-options.js';
import { WebchatFacadeImpl } from './application/webchat.facade.impl.js';
import { WidgetError } from './application/widget-error.js';
import { WebchatService } from './application/webchat.service.js';
import { TurnstileVerifier } from './infrastructure/captcha/turnstile-verifier.js';
import { S3WebchatUploadStorage } from './infrastructure/media/s3-webchat-upload-storage.js';
import {
  DrizzleVisitorStore,
  UnavailableVisitorStore,
} from './infrastructure/persistence/visitor.store.js';
import { setCors } from './interface/http/webchat-public.controller.js';
import { WebchatPublicController } from './interface/http/webchat-public.controller.js';
import { WebchatController } from './interface/http/webchat.controller.js';

const PREFLIGHT = new RegExp(`^/${API_PREFIX}/webchat/v1/sites/([^/?]+)(?:/[a-z]+)?(?:\\?.*)?$`);

/**
 * Website chat: the public widget API (no login, site key + origin + visitor token) and the
 * visitor details staff see in the inbox. Messages travel through the existing inbox pipeline.
 */
@Module({
  imports: [ChannelModule, ConversationModule, BotModule, CrmModule],
  controllers: [WebchatPublicController, WebchatController],
  providers: [
    {
      provide: VISITOR_STORE,
      inject: [{ token: DB_TENANT, optional: true }],
      useFactory: (db: Database | null | undefined) =>
        db ? new DrizzleVisitorStore(db) : new UnavailableVisitorStore(),
    },
    {
      provide: WEBCHAT_UPLOAD_STORAGE,
      useFactory: () => {
        const env = getEnv();
        return new S3WebchatUploadStorage({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET,
          publicUrl: env.S3_PUBLIC_URL,
          accessKey: env.S3_ACCESS_KEY,
          secretKey: env.S3_SECRET_KEY,
        });
      },
    },
    // Shared Redis counters when REDIS_URL is set, so limits hold across API processes (#17).
    { provide: RATE_LIMITER, useFactory: () => sharedLimiter() },
    {
      provide: WEBCHAT_OPTIONS,
      useFactory: (): WebchatOptions => {
        const env = getEnv();
        return {
          uploadsPerSiteDay: env.WEBCHAT_UPLOADS_SITE_DAY,
          captcha:
            env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET
              ? new TurnstileVerifier(env.TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET)
              : null,
        };
      },
    },
    WebchatService,
    { provide: WEBCHAT_FACADE, useClass: WebchatFacadeImpl },
    { provide: WEBCHAT_RUNNER, useClass: UploadPurgeRunner },
  ],
  exports: [WEBCHAT_FACADE, WEBCHAT_RUNNER],
})
export class WebchatModule implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly host: HttpAdapterHost,
    @Inject(WebchatService) private readonly service: WebchatService,
  ) {}

  /**
   * CORS preflight of the widget's JSON/Authorization requests. A route per path would show up as
   * an extra API route, so one onRequest hook answers OPTIONS for this prefix only; every other
   * path (the dashboard) is untouched.
   */
  onModuleInit(): void {
    const fastify = this.host.httpAdapter?.getInstance<FastifyInstance>();
    fastify?.addHook('onRequest', async (req, reply) => {
      if (req.method !== 'OPTIONS') return;
      const match = PREFLIGHT.exec(req.url);
      if (!match) return;
      const origin = req.headers.origin;
      let key: string;
      try {
        key = decodeURIComponent(match[1] ?? '');
      } catch {
        return reply.status(404).send();
      }
      let allowed: boolean;
      try {
        allowed = await this.service.preflightAllowed(key, origin, req.ip);
      } catch (error) {
        if (error instanceof WidgetError && error.retryAfterSeconds)
          void reply.header('Retry-After', String(error.retryAfterSeconds));
        return reply.status(error instanceof WidgetError ? error.status : 500).send();
      }
      if (allowed) setCors(reply, origin);
      return reply.status(allowed ? 204 : 404).send();
    });
  }
}
