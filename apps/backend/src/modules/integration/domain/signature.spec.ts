import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { validKiotVietSignature } from './signature.js';

const secret = 'webhook-secret';
const body = '{"Id":"abc","Notifications":[]}';
const sign = (b: string, s = secret) => createHmac('sha256', s).update(b, 'utf8').digest('hex');

describe('validKiotVietSignature', () => {
  it('accepts the hex HMAC-SHA256 of the raw body', () =>
    expect(validKiotVietSignature(body, sign(body), secret)).toBe(true));
  it('accepts a "sha256=" prefix and upper-case hex', () => {
    expect(validKiotVietSignature(body, `sha256=${sign(body)}`, secret)).toBe(true);
    expect(validKiotVietSignature(body, sign(body).toUpperCase(), secret)).toBe(true);
  });
  it('rejects a signature for another body or secret', () => {
    expect(validKiotVietSignature(`${body} `, sign(body), secret)).toBe(false);
    expect(validKiotVietSignature(body, sign(body, 'other'), secret)).toBe(false);
  });
  it('rejects a missing, empty or truncated header', () => {
    expect(validKiotVietSignature(body, undefined, secret)).toBe(false);
    expect(validKiotVietSignature(body, '', secret)).toBe(false);
    expect(validKiotVietSignature(body, 'sha256=', secret)).toBe(false);
    expect(validKiotVietSignature(body, sign(body).slice(0, 40), secret)).toBe(false);
  });
  it('rejects everything when no secret is configured', () =>
    expect(validKiotVietSignature(body, sign(body, ''), '')).toBe(false));
});
