import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the previous and next step to tolerate clock drift between phone and server. */
const WINDOW = 1;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 6238 (HMAC-SHA1, 30 s, 6 digits) — what every authenticator app implements. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0xf;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * The accepted step for `code`, or null. Only steps after `lastUsedStep` count,
 * so a code (even one observed by an attacker) works exactly once.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedStep: number,
  nowMs: number,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  let accepted: number | null = null;
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    const expected = Buffer.from(totpAt(secret, step));
    // No early exit: every candidate is compared so timing does not leak which step matched.
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastUsedStep) accepted = step;
  }
  return accepted;
}

export function otpauthUri(secret: string, email: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

const RECOVERY_COUNT = 8;

/** `xxxxx-xxxxx` (10 random base32 chars): 50 bits, only ever shown once. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
