import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { metaUserHash, parseSignedRequest, signRequest } from './meta-data-deletion.js';

const secret = 'test-app-secret';
const payload = {
  algorithm: 'HMAC-SHA256',
  expires: 1_794_470_400,
  issued_at: 1_794_466_800,
  user_id: '10234567890123456',
};

describe('parseSignedRequest', () => {
  it('reads the user of a request signed with the app secret', () => {
    expect(parseSignedRequest(signRequest(payload, secret), secret)).toEqual({
      userId: '10234567890123456',
    });
  });

  it('accepts base64 padding and a numeric user id', () => {
    const encoded = Buffer.from(JSON.stringify({ ...payload, user_id: 42 })).toString('base64');
    const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
    expect(parseSignedRequest(`${sig}.${encoded}`, secret)).toEqual({ userId: '42' });
  });

  it('refuses another secret and a tampered payload', () => {
    const signed = signRequest(payload, secret);
    expect(parseSignedRequest(signed, 'another-secret')).toBeNull();
    const [sig] = signed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, user_id: '999' })).toString(
      'base64url',
    );
    expect(parseSignedRequest(`${sig}.${forged}`, secret)).toBeNull();
  });

  it('refuses another algorithm even when correctly signed', () => {
    expect(
      parseSignedRequest(signRequest({ ...payload, algorithm: 'HMAC-SHA1' }, secret), secret),
    ).toBeNull();
    expect(
      parseSignedRequest(signRequest({ ...payload, algorithm: undefined }, secret), secret),
    ).toBeNull();
  });

  it('refuses malformed input, a missing user and an empty secret', () => {
    for (const bad of ['', 'abc', '.abc', 'abc.', 'a.b.c', '!!.??', 'x'.repeat(5000)])
      expect(parseSignedRequest(bad, secret)).toBeNull();
    expect(
      parseSignedRequest(signRequest({ algorithm: 'HMAC-SHA256' }, secret), secret),
    ).toBeNull();
    expect(
      parseSignedRequest(signRequest({ ...payload, user_id: '12; drop' }, secret), secret),
    ).toBeNull();
    expect(parseSignedRequest(signRequest(payload, ''), '')).toBeNull();
    const notJson = `${createHmac('sha256', secret).update('bm90IGpzb24').digest('base64url')}.bm90IGpzb24`;
    expect(parseSignedRequest(notJson, secret)).toBeNull();
  });
});

describe('metaUserHash', () => {
  it('is a stable hex digest that does not contain the id', () => {
    const h = metaUserHash('10234567890123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(metaUserHash('10234567890123456'));
    expect(h).not.toBe(metaUserHash('10234567890123457'));
    expect(h).not.toContain('10234567890123456');
  });
});
