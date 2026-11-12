import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta's data deletion request callback (Facebook Login apps). Meta POSTs `signed_request`
 * (`<base64url HMAC-SHA256 signature>.<base64url JSON payload>`, signed with the app secret);
 * the payload's `user_id` is the app-scoped id of the person who asked for their data to be
 * deleted. Docs (checked 2026-11-12):
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export interface DataDeletionRequest {
  /** App-scoped user id (ASID) of the person who logged in with Facebook. */
  userId: string;
}

const MAX_SIGNED_REQUEST = 4096;

function base64UrlDecode(part: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(part)) return null;
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verifies and reads a `signed_request`. Null when it is malformed, too long, signed with another
 * secret, uses another algorithm or carries no `user_id`. Constant-time signature comparison.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): DataDeletionRequest | null {
  if (!appSecret || signedRequest.length > MAX_SIGNED_REQUEST) return null;
  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || dot === signedRequest.length - 1) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  const signature = base64UrlDecode(encodedSig);
  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!signature || !payloadBytes) return null;
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.algorithm !== 'string' || p.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
  const userId =
    typeof p.user_id === 'string' || typeof p.user_id === 'number' ? String(p.user_id) : '';
  return /^[0-9]{1,32}$/.test(userId) ? { userId } : null;
}

/**
 * The stored form of a Facebook app-scoped user id: SHA-256 hex of `facebook:<id>`. Connections
 * keep it to find what a person connected when Meta asks for their data to be deleted; the id itself
 * is never stored, logged or returned.
 */
export function metaUserHash(appScopedUserId: string): string {
  return createHash('sha256').update(`facebook:${appScopedUserId}`).digest('hex');
}

/** Signs a payload like Meta does (tests and local tooling only). */
export function signRequest(payload: Record<string, unknown>, appSecret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', appSecret).update(encoded).digest('base64url');
  return `${sig}.${encoded}`;
}
