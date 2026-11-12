import { describe, expect, it } from 'vitest';

import {
  canonicalTrialEmail,
  isDisposableEmail,
  parseBlockedDomains,
} from '../domain/trial-identity.js';
import { InMemoryWindowCounter } from '../infrastructure/security/in-memory-window-counter.js';

describe('canonicalTrialEmail', () => {
  it.each([
    ['Lan.Nguyen+shop@Gmail.com', 'lannguyen@gmail.com'],
    ['l.a.n.nguyen@googlemail.com', 'lannguyen@gmail.com'],
    ['lan.nguyen+a+b@shop.vn', 'lan.nguyen@shop.vn'],
    [' LAN@shop.vn ', 'lan@shop.vn'],
  ])('maps %j to %j', (address, canonical) => {
    expect(canonicalTrialEmail(address)).toBe(canonical);
  });

  it('keeps dots outside Gmail, where they may name another mailbox', () => {
    expect(canonicalTrialEmail('lan.nguyen@shop.vn')).not.toBe(
      canonicalTrialEmail('lannguyen@shop.vn'),
    );
  });
});

describe('isDisposableEmail', () => {
  it('matches built-in and extra domains, subdomains included', () => {
    expect(isDisposableEmail('a@Mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@eu.yopmail.com')).toBe(true);
    expect(isDisposableEmail('a@shop.vn')).toBe(false);
    expect(isDisposableEmail('a@notmailinator.com')).toBe(false);
    expect(isDisposableEmail('a@burner.example', parseBlockedDomains(' @Burner.example, '))).toBe(
      true,
    );
  });
});

describe('InMemoryWindowCounter', () => {
  it('counts within a window, restarts after it, and forgets a reset key', async () => {
    let t = 0;
    const counter = new InMemoryWindowCounter(() => t);
    expect(await counter.hit('k', 60_000)).toEqual({ count: 1, retryAfterSeconds: 60 });
    t = 30_000;
    expect(await counter.hit('k', 60_000)).toEqual({ count: 2, retryAfterSeconds: 30 });
    t = 60_000;
    expect((await counter.hit('k', 60_000)).count).toBe(1);
    await counter.reset('k');
    expect((await counter.hit('k', 60_000)).count).toBe(1);
  });
});
