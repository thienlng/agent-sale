import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  newRecoveryCodes,
  otpauthUri,
  totpAt,
  verifyTotp,
} from '../domain/totp.js';

// RFC 6238 appendix B secret ("12345678901234567890"); its 8-digit codes truncate to these 6.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(RFC_SECRET, 1)).toBe('287082'); // t = 59
    expect(totpAt(RFC_SECRET, 37037036)).toBe('081804'); // t = 1111111080
    expect(totpAt(RFC_SECRET, 37037037)).toBe('050471'); // t = 1111111110
  });

  it('round-trips base32', () => {
    const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(raw))).toEqual(raw);
  });

  it('accepts ±1 step, refuses further drift and replays', () => {
    const now = 59_000;
    expect(verifyTotp(RFC_SECRET, '287082', 0, now)).toBe(1);
    expect(verifyTotp(RFC_SECRET, '287082', 0, now + 30_000)).toBe(1);
    expect(verifyTotp(RFC_SECRET, '287082', 0, now + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '287082', 1, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '28708', 0, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', 0, now)).toBeNull();
  });

  it('builds an otpauth URI an authenticator app understands', () => {
    const uri = otpauthUri('ABC', 'a@b.vn', 'Rapiz');
    expect(uri).toContain('otpauth://totp/Rapiz%3Aa%40b.vn?secret=ABC');
    expect(uri).toContain('issuer=Rapiz');
  });

  it('recovery codes are unique, well formed and hash case/space-insensitively', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const c = codes[0] as string;
    expect(hashRecoveryCode(` ${c.toUpperCase()} `)).toBe(hashRecoveryCode(c));
  });
});
