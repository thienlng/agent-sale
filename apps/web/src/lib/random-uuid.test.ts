import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureRandomUuid, randomUuidFallback } from './random-uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('randomUuidFallback', () => {
  it('makes distinct RFC 4122 v4 ids', () => {
    const ids = new Set(Array.from({ length: 50 }, randomUuidFallback));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe('ensureRandomUuid', () => {
  it('fills in crypto.randomUUID where the page is not a secure context', () => {
    const insecure = { getRandomValues: crypto.getRandomValues.bind(crypto) } as Crypto;
    vi.stubGlobal('crypto', insecure);
    ensureRandomUuid();
    expect(insecure.randomUUID()).toMatch(V4);
  });

  it('keeps the native one when it exists', () => {
    const native = crypto.randomUUID;
    ensureRandomUuid();
    expect(crypto.randomUUID).toBe(native);
  });
});
