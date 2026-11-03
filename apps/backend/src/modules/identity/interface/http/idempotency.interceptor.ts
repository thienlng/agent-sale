import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';

import { ApiError } from '../../../../common/http/api-error.js';
import { IDEMPOTENCY_STORE, type IdempotencyStore } from '../../application/ports/api-keys.js';

const REPLAY_MS = 24 * 3_600_000;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** SHA-256 of what makes two requests "the same": method, URL and body. */
export function requestHash(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

/**
 * `Idempotency-Key` on writes made with an API key (ADR-022 §4): the first response is stored and
 * replayed for 24 h to retries of the same key (`Idempotent-Replayed: true`). The same key with
 * another request is a 422; a retry while the first request still runs is a 409. A request that
 * fails is forgotten, so the client may retry it. Session (dashboard) requests are not affected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const apiKey = req.auth?.apiKey;
    if (!key || !apiKey || !req.workspaceId || !WRITES.has(req.method)) return next.handle();
    if (key.length > 255)
      return throwError(
        () => new ApiError('VALIDATION_FAILED', 'Idempotency-Key is longer than 255 characters'),
      );
    const reply = ctx.switchToHttp().getResponse<FastifyReply>();
    const ws = req.workspaceId;
    return from(
      this.store.claim({
        workspaceId: ws,
        apiKeyId: apiKey.id,
        key,
        requestHash: requestHash(req.method, req.url, req.body),
        expiredBefore: new Date(Date.now() - REPLAY_MS),
      }),
    ).pipe(
      mergeMap((claim) => {
        switch (claim.kind) {
          case 'mismatch':
            throw new ApiError(
              'CONFLICT',
              'This Idempotency-Key was used for another request',
              { reason: 'idempotency_key_reused' },
              422,
            );
          case 'in_flight':
            throw new ApiError('CONFLICT', 'A request with this Idempotency-Key is still running', {
              reason: 'idempotency_in_flight',
            });
          case 'replay':
            void reply.status(claim.status).header('Idempotent-Replayed', 'true');
            return of(claim.body);
          case 'claimed':
            return next.handle().pipe(
              mergeMap((body: unknown) =>
                from(this.store.complete(apiKey.id, key, reply.statusCode, body ?? null)).pipe(
                  mergeMap(() => of(body)),
                ),
              ),
              catchError((e: unknown) =>
                from(this.store.release(apiKey.id, key).catch(() => undefined)).pipe(
                  mergeMap(() => throwError(() => e)),
                ),
              ),
            );
        }
      }),
    );
  }
}
