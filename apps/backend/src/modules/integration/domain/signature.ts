import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * KiotViet webhook check: `X-Hub-Signature` is the hex HMAC-SHA256 of the raw body, optionally
 * prefixed with "sha256=". Constant-time compare; any malformed input is simply invalid.
 */
export function validKiotVietSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!secret || !header) return false;
  const given = header
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
