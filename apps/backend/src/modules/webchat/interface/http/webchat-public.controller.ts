import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/multipart';

import { Public } from '../../../../common/http/auth-context.js';
import {
  MAX_UPLOAD_BYTES,
  WebchatService,
  type PublicCall,
} from '../../application/webchat.service.js';
import { WidgetError } from '../../application/widget-error.js';

/** Allowed methods/headers of the public widget API; the origin itself is echoed per request. */
const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type';

/** The request's `Origin` when it is a real http(s) origin, otherwise null (never `*`). */
export function requestOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === origin
      ? origin
      : null;
  } catch {
    return null;
  }
}

/**
 * CORS for the public routes: the caller's own origin is echoed (so the widget can read even the
 * uniform 404 and stop rendering), never a wildcard, no credentials.
 */
export function setCors(reply: FastifyReply, origin: string | undefined): void {
  const allowed = requestOrigin(origin);
  void reply.header('Vary', 'Origin');
  if (!allowed) return;
  void reply
    .header('Access-Control-Allow-Origin', allowed)
    .header('Access-Control-Allow-Methods', ALLOW_METHODS)
    .header('Access-Control-Allow-Headers', ALLOW_HEADERS)
    .header('Access-Control-Expose-Headers', 'Retry-After')
    .header('Access-Control-Max-Age', '600');
}

/**
 * Public widget API. Answers use the small `{ error: CODE }` body the widget reads, not the
 * dashboard's error envelope, and always carry CORS headers for the caller's origin.
 */
@Public()
@Controller('webchat/v1/sites/:key')
export class WebchatPublicController {
  constructor(@Inject(WebchatService) private readonly service: WebchatService) {}

  @Get()
  config(@Param('key') key: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return this.reply(reply, req, 200, () => this.service.config(this.call(key, req)));
  }

  @Post('messages')
  @HttpCode(202)
  send(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.reply(reply, req, 202, () => this.service.send(this.call(key, req), body));
  }

  @Get('messages')
  poll(
    @Param('key') key: string,
    @Query('after') after: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.reply(reply, req, 200, () => this.service.poll(this.call(key, req), after));
  }

  @Post('uploads')
  @HttpCode(200)
  upload(
    @Param('key') key: string,
    @Query() query: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const text = (name: string): string | undefined =>
      typeof query[name] === 'string' ? query[name] : undefined;
    const context = {
      firstUrl: text('firstUrl'),
      referrer: text('referrer'),
      pageUrl: text('pageUrl'),
      pageTitle: text('pageTitle'),
    };
    return this.reply(reply, req, 200, () =>
      this.service.upload(
        this.call(key, req),
        async () => {
          if (!req.isMultipart()) throw new WidgetError(415, 'UNSUPPORTED_MEDIA');
          try {
            const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
            if (!file) throw new WidgetError(400, 'VALIDATION_FAILED');
            return await file.toBuffer();
          } catch (error) {
            if (error instanceof WidgetError) throw error;
            const code = (error as { code?: string }).code;
            if (code === 'FST_REQ_FILE_TOO_LARGE') throw new WidgetError(413, 'TOO_LARGE');
            throw new WidgetError(400, 'VALIDATION_FAILED');
          }
        },
        context,
      ),
    );
  }

  @Post('phone')
  @HttpCode(200)
  phone(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.reply(reply, req, 200, () => this.service.phone(this.call(key, req), body));
  }

  private call(key: string, req: FastifyRequest): PublicCall {
    return {
      key,
      origin: req.headers.origin,
      ip: req.ip,
      authorization: req.headers.authorization,
    };
  }

  private async reply(
    reply: FastifyReply,
    req: FastifyRequest,
    status: number,
    run: () => Promise<unknown>,
  ): Promise<void> {
    setCors(reply, req.headers.origin);
    void reply.header('Cache-Control', 'no-store');
    try {
      const body = await run();
      await reply.status(status).send(body);
    } catch (error) {
      if (!(error instanceof WidgetError)) throw error;
      if (error.retryAfterSeconds)
        void reply.header('Retry-After', String(error.retryAfterSeconds));
      await reply.status(error.status).send({ error: error.code });
    }
  }
}
