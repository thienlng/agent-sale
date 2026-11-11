import type { AuthResponse } from '@agent-sales/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../../../common/http/api-error.js';
import type { ClientMeta, IssuedSession } from '../../application/sessions.js';
import type { AuthHttpOptions } from './auth-http.options.js';

export const REFRESH_COOKIE = 'rapiz_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Web clients: refresh token only in an HttpOnly cookie scoped to /api/v1/auth; access token in the
 * body (kept in memory by the SPA). Native clients get the refresh token in the body (docs/09 §2).
 */
export function issueSession(
  issued: IssuedSession,
  client: 'web' | 'native',
  reply: FastifyReply,
  options: AuthHttpOptions,
): AuthResponse {
  const base = { accessToken: issued.accessToken, expiresIn: issued.expiresIn, user: issued.user };
  if (client === 'native') return { ...base, refreshToken: issued.refreshToken };
  setRefreshCookie(issued, reply, options);
  return base;
}

export function setRefreshCookie(
  issued: IssuedSession,
  reply: FastifyReply,
  options: AuthHttpOptions,
): void {
  void reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: issued.refreshExpiresAt,
  });
}

/** CSRF defence for cookie-authenticated POSTs: a browser always sends Origin on them. */
export function assertAllowedOrigin(req: FastifyRequest, options: AuthHttpOptions): void {
  const origin = req.headers.origin;
  if (origin && !options.allowedOrigins.includes(origin)) {
    throw new ApiError('FORBIDDEN', 'Origin not allowed');
  }
}

export function clientMeta(req: FastifyRequest): ClientMeta {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, ip: req.ip ?? null };
}
