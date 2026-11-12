import { metaUserHash, parseSignedRequest } from '@agent-sales/channels';
import type { FastifyInstance } from 'fastify';

/**
 * Ingress port: records a deletion request for this (hashed) Facebook user, or returns the one
 * still pending for them, so a repeated callback answers the same confirmation code.
 */
export interface MetaDataDeletionStore {
  request(userHash: string): Promise<{ confirmationCode: string }>;
}

export interface MetaDataDeletionDeps {
  store: MetaDataDeletionStore;
  /** The Facebook app secret (`META_APP_SECRET`) that signs `signed_request`. */
  appSecret: string;
  /** Public HTTPS origin of the status page (`APP_PUBLIC_URL`), e.g. `https://rapiz.io`. */
  statusOrigin: string;
}

const BODY_LIMIT = 16 * 1024;

/**
 * `POST /webhooks/meta/data-deletion`: Meta's data deletion request callback for Facebook Login
 * (https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback,
 * checked 2026-11-12). Verify the signed request, store the request once, answer
 * `{ url, confirmation_code }`. The backend worker does the deletion (no business logic here).
 * Neither the signed request nor the user id ever reaches a log line.
 */
export function registerMetaDataDeletionRoute(
  app: FastifyInstance,
  deps: MetaDataDeletionDeps,
): void {
  const origin = deps.statusOrigin.replace(/\/+$/, '');
  void app.register(
    async (scope) => {
      // Meta posts a form; a JSON body is accepted too. Both are read as text and parsed here.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
        done(null, body);
      });
      scope.setErrorHandler((err: unknown, req, reply) => {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        req.log.warn(
          { error: (err as { code?: string }).code ?? 'unknown' },
          'meta_data_deletion_failed',
        );
        return reply.code(status >= 400 && status < 500 ? status : 500).send({ error: 'failed' });
      });
      scope.post<{ Body: string | undefined }>(
        '/data-deletion',
        { bodyLimit: BODY_LIMIT },
        async (req, reply) => {
          const signed = signedRequestOf(req.body, req.headers['content-type']);
          const verified = signed ? parseSignedRequest(signed, deps.appSecret) : null;
          if (!verified) {
            req.log.info('meta_data_deletion_rejected');
            return reply.code(400).send({ error: 'invalid signed_request' });
          }
          const { confirmationCode } = await deps.store.request(metaUserHash(verified.userId));
          return reply.code(200).send({
            url: `${origin}/data-deletion?code=${encodeURIComponent(confirmationCode)}`,
            confirmation_code: confirmationCode,
          });
        },
      );
    },
    { prefix: '/webhooks/meta' },
  );
}

/** `signed_request` from a form body (Meta's format) or a JSON body. */
export function signedRequestOf(
  body: string | undefined,
  contentType: string | undefined,
): string | null {
  if (!body) return null;
  if (contentType?.includes('application/json')) {
    try {
      const json = JSON.parse(body) as { signed_request?: unknown };
      return typeof json.signed_request === 'string' ? json.signed_request : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(body).get('signed_request');
}
