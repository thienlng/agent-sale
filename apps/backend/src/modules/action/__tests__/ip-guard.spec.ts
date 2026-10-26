import { describe, expect, it } from 'vitest';

import { isPublicAddress } from '../domain/ip-guard.js';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
  ])('allows public address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '169.254.169.254',
    '169.254.0.1',
    '0.0.0.0',
    '0.1.2.3',
    '224.0.0.1',
    '239.255.255.255',
    '255.255.255.255',
    '240.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'ff02::1',
    'ff00::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:192.168.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    '2001:db8::1',
  ])('blocks non-public address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '',
    'not-an-ip',
    '999.1.1.1',
    '1.2.3',
    '127.1',
    '0x7f.0.0.1',
    '2130706433',
    '0177.0.0.1',
  ])('fails closed for non-canonical or invalid input %j', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});
