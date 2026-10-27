import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hostAllowed, isSiteKey, newSiteKey, signVisitor, verifyVisitor } from './website-key.js';
describe('site key', () => {
  it('has the public shape', () => {
    const k = newSiteKey();
    expect(isSiteKey(k)).toBe(true);
    expect(newSiteKey()).not.toBe(k);
  });
});
describe('visitor token', () => {
  const secret = randomBytes(32),
    other = randomBytes(32),
    id = '0192f0c8-7b1e-7cc0-9a51-3c1b2b8a9d10';
  it('round-trips', () => expect(verifyVisitor(secret, signVisitor(secret, id))).toBe(id));
  it('rejects another site', () =>
    expect(verifyVisitor(other, signVisitor(secret, id))).toBeNull());
  it('rejects tampering', () => {
    const t = signVisitor(secret, id);
    expect(verifyVisitor(secret, t.replace(id, '0192f0c8-7b1e-7cc0-9a51-3c1b2b8a9d11'))).toBeNull();
    expect(verifyVisitor(secret, 'v2.' + t.slice(3))).toBeNull();
    expect(verifyVisitor(secret, 'garbage')).toBeNull();
  });
});
describe('hostAllowed', () => {
  const d = ['shop.vn'];
  it('matches exact host and subdomains, ignoring scheme, port and case', () => {
    expect(hostAllowed('https://shop.vn', d)).toBe(true);
    expect(hostAllowed('https://WWW.Shop.vn:8443', d)).toBe(true);
    expect(hostAllowed('http://a.b.shop.vn', d)).toBe(true);
  });
  it('rejects look-alikes and missing origins', () => {
    expect(hostAllowed('https://evilshop.vn', d)).toBe(false);
    expect(hostAllowed('https://shop.vn.evil.com', d)).toBe(false);
    expect(hostAllowed(undefined, d)).toBe(false);
    expect(hostAllowed('null', d)).toBe(false);
  });
});
