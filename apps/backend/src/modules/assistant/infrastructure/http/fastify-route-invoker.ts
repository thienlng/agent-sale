import { Inject, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { API_PREFIX } from '../../../../common/http/api-prefix.js';
import type {
  RouteInvocation,
  RouteInvocationResult,
  RouteInvoker,
} from '../../domain/ports/route-invoker.port.js';

/** `?a=1&b=x&b=y`; arrays repeat the key, null/undefined values are left out. */
export function toQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null) continue;
      params.append(key, typeof v === 'object' ? JSON.stringify(v) : String(v as string));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Runs a declared route in process through Fastify `inject` (spec §6), with the caller's own
 * bearer token, the business as `X-Workspace-Id` and `X-Actor: assistant`. Nothing here logs:
 * the headers carry the owner's token.
 */
@Injectable()
export class FastifyRouteInvoker implements RouteInvoker {
  constructor(@Inject(HttpAdapterHost) private readonly host: HttpAdapterHost) {}

  async invoke(i: RouteInvocation): Promise<RouteInvocationResult> {
    const fastify = this.host.httpAdapter.getInstance<FastifyInstance>();
    const hasBody = i.body !== undefined;
    const res = await fastify.inject({
      method: i.method.toUpperCase() as 'GET',
      url: `/${API_PREFIX}${i.path}${toQueryString(i.query)}`,
      headers: {
        authorization: i.authorization,
        'x-workspace-id': i.businessId,
        'x-actor': 'assistant',
        ...(i.idempotencyKey ? { 'idempotency-key': i.idempotencyKey } : {}),
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      ...(hasBody ? { payload: JSON.stringify(i.body) } : {}),
    });
    return { status: res.statusCode, body: parseBody(res.body) };
  }
}
