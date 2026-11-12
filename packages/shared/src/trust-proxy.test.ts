import { isIP } from 'node:net';

import { describe, expect, it } from 'vitest';

import { parseTrustProxy as parse, PRODUCTION_TRUSTED_PROXIES } from './trust-proxy.js';

const parseTrustProxy = (raw: string | undefined, env: string) => parse(raw, env, isIP);

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

  it('checks every address and prefix length', () => {
    expect(parseTrustProxy('10.0.0.0/32,fd00::/128,2001:db8::1', 'production')).toHaveLength(3);
    for (const bad of ['999.1.1.1', '10.0.0.0/33', 'fd00::/129', '1.2.3.4/', '1.2.3.4/8/8', '::g'])
      expect(() => parseTrustProxy(bad, 'production')).toThrow(/is not an IP address/);
  });
});
