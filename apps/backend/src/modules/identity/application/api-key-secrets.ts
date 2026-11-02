import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { API_KEY_PATTERN, API_KEY_PREFIX } from '@agent-sales/contracts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Uniform random string over [A-Za-z0-9] (rejection sampling, no modulo bias). */
export function randomToken(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

/** A fresh key: the full value (shown once), its public id and the hash to store. */
export function generateApiKey(): { key: string; keyId: string; secretHash: string } {
  const keyId = randomToken(12);
  const secret = randomToken(32);
  return { key: `${API_KEY_PREFIX}${keyId}_${secret}`, keyId, secretHash: hashSecret(secret) };
}

/** Splits `rpz_live_<keyId>_<secret>`; null for anything else. */
export function parseApiKey(token: string): { keyId: string; secret: string } | null {
  const m = API_KEY_PATTERN.exec(token);
  return m?.[1] && m[2] ? { keyId: m[1], secret: m[2] } : null;
}

/** Constant-time comparison of the secret with the stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the dashboard shows of a key: enough to recognise it, useless to call with. */
export const keyPrefix = (keyId: string): string => `${API_KEY_PREFIX}${keyId}_…`;
