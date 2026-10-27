import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SITE_KEY = /^wk_[0-9A-Za-z]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public, non-secret identifier embedded in the widget snippet: `wk_` + 22 base62 chars. */
export function newSiteKey(): string {
  let out = '';
  while (out.length < 22) {
    // Rejection sampling (248 = 4 * 62) keeps the alphabet unbiased.
    for (const b of randomBytes(32)) if (b < 248 && out.length < 22) out += BASE62[b % 62];
  }
  return `wk_${out}`;
}

export function isSiteKey(v: string): boolean {
  return SITE_KEY.test(v);
}

const mac = (secret: Buffer, visitorId: string): Buffer =>
  createHmac('sha256', secret).update(`v1.${visitorId}`).digest();

/** `v1.<visitorId>.<base64url hmac-sha256>`; the secret is per site, so tokens never cross sites. */
export function signVisitor(secret: Buffer, visitorId: string): string {
  return `v1.${visitorId}.${mac(secret, visitorId).toString('base64url')}`;
}

/** The visitor id when the token was signed with `secret`, otherwise null (constant-time compare). */
export function verifyVisitor(secret: Buffer, token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, visitorId, signature] = parts as [string, string, string];
  if (!UUID.test(visitorId)) return null;
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(secret, visitorId);
  return given.length === expected.length && timingSafeEqual(given, expected) ? visitorId : null;
}

/** Whether the browser `Origin` host equals an allowed domain or is one of its subdomains. */
export function hostAllowed(origin: string | undefined, domains: readonly string[]): boolean {
  if (!origin || origin === 'null') return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}
