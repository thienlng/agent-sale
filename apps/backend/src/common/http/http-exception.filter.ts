import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { ApiError, isDomainError } from './api-error.js';

/** Fastify rejects a body over the route limit before any handler runs. */
function isBodyTooLarge(e: unknown): boolean {
  const err = e as { code?: unknown; statusCode?: unknown } | null;
  return (
    err?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
    err?.statusCode === 413 ||
    (e instanceof HttpException && e.getStatus() === 413)
  );
}

/** Every error leaves the API as the contracts ErrorResponse envelope (docs/11 §2). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const traceId = request.id;

    const apiError = this.#normalize(exception);
    if (apiError.code === 'INTERNAL') {
      // The path only: a query string can carry personal data (a phone number search).
      const path = request.url.split('?', 1)[0];
      this.logger.error({ err: exception, traceId, url: path }, 'unhandled error');
    }
    void reply.status(apiError.status).send({
      error: {
        code: apiError.code,
        message: apiError.code === 'INTERNAL' ? 'Internal error' : apiError.message,
        details: apiError.details,
        traceId,
      },
    });
  }

  #normalize(exception: unknown): ApiError {
    if (exception instanceof ApiError) return exception;
    if (isDomainError(exception)) return ApiError.fromDomain(exception);
    if (isBodyTooLarge(exception)) {
      return new ApiError(
        'VALIDATION_FAILED',
        'The request body is too large',
        { reason: 'PAYLOAD_TOO_LARGE' },
        413,
      );
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return new ApiError('NOT_FOUND', exception.message);
      if (status === 401) return new ApiError('UNAUTHENTICATED', exception.message);
      if (status === 403) return new ApiError('FORBIDDEN', exception.message);
      if (status === 409) return new ApiError('CONFLICT', exception.message);
      if (status === 429) return new ApiError('RATE_LIMITED', exception.message);
      // Any other 4xx raised by the framework before a handler runs is a client error (Nest maps a
      // Fastify 4xx such as an unsupported media type to an HttpException): keep its status.
      if (status >= 400 && status < 500)
        return new ApiError('VALIDATION_FAILED', exception.message, undefined, status);
      return new ApiError('INTERNAL', exception.message);
    }
    return new ApiError('INTERNAL', 'Internal error');
  }
}
