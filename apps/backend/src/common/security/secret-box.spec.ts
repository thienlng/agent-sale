import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('round-trips and never stores the plaintext', () => {
    const sealed = box.seal('sk-ant-secret-1234');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('secret');
    expect(box.open(sealed)).toBe('sk-ant-secret-1234');
  });

  it('uses a fresh IV for every seal', () => {
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('rejects tampered values and values sealed with another key', () => {
    const sealed = box.seal('value');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() => new SecretBox(randomBytes(32)).open(sealed)).toThrow();
  });

  it('rejects a truncated authentication tag', () => {
    const parts = box.seal('value').split('.');
    parts[2] = Buffer.from(parts[2] ?? '', 'base64url')
      .subarray(0, 4)
      .toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow('authentication tag');
  });

  it('requires a 32-byte key', () => {
    expect(() => SecretBox.fromBase64(randomBytes(16).toString('base64'))).toThrow('32 bytes');
  });
});
