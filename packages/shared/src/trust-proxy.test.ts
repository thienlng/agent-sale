import { describe, expect, it } from 'vitest';

import { parseTrustProxy, PRODUCTION_TRUSTED_PROXIES } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('defaults to the private proxy ranges in production and to loopback elsewhere', () => {
    expect(parseTrustProxy(undefined, 'production')).toEqual([...PRODUCTION_TRUSTED_PROXIES]);
    expect(parseTrustProxy('', 'development')).toEqual(['loopback']);
    expect(parseTrustProxy(undefined, 'test')).toEqual(['loopback']);
  });

  it('reads false or a list of addresses and CIDRs', () => {
    expect(parseTrustProxy('false', 'production')).toBe(false);
    expect(parseTrustProxy(' 172.18.0.0/16, loopback ,::1', 'production')).toEqual([
      '172.18.0.0/16',
      'loopback',
      '::1',
    ]);
  });

  it('refuses trusting every hop, hop counts and values that are not addresses', () => {
    expect(() => parseTrustProxy('true', 'production')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('2', 'production')).toThrow(/hop count/);
    expect(() => parseTrustProxy('10.0.0.0/8,evil', 'production')).toThrow(/evil/);
  });
});
