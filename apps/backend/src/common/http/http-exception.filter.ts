import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { ApiError, isDomainError } from './api-error.js';

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
    if (apiError.status >= 500) {
      this.logger.error({ err: exception, traceId, url: request.url }, 'unhandled error');
    }
    void reply.status(apiError.status).send({
      error: {
        code: apiError.code,
        message: apiError.status >= 500 ? 'Internal error' : apiError.message,
        details: apiError.details,
        traceId,
      },
    });
  }

  #normalize(exception: unknown): ApiError {
    if (exception instanceof ApiError) return exception;
    if (isDomainError(exception)) return ApiError.fromDomain(exception);
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 404
          ? 'NOT_FOUND'
          : status === 401
            ? 'UNAUTHENTICATED'
            : status === 403
              ? 'FORBIDDEN'
              : 'INTERNAL';
      return new ApiError(code, exception.message);
    }
    return new ApiError('INTERNAL', 'Internal error');
  }
}
