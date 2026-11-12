import { describe, expect, it } from 'vitest';

import { ACCOUNT_PATHS, ACCOUNT_SIDEBAR_PATHS } from './account-sidebar';

describe('ACCOUNT_PATHS', () => {
  it('matches the account layer and nothing inside a business', () => {
    for (const path of ['/app/overview', '/app/businesses/new']) {
      expect(ACCOUNT_PATHS.test(path)).toBe(true);
    }
    for (const path of ['/app/analytics', '/app/bots', '/app/orders/overview', '/app/settings']) {
      expect(ACCOUNT_PATHS.test(path)).toBe(false);
    }
  });
});

describe('ACCOUNT_SIDEBAR_PATHS', () => {
  it('shows the account sidebar on the owner assistant, which still needs a business', () => {
    expect(ACCOUNT_SIDEBAR_PATHS.test('/app/assistant')).toBe(true);
    expect(ACCOUNT_SIDEBAR_PATHS.test('/app/overview')).toBe(true);
    expect(ACCOUNT_PATHS.test('/app/assistant')).toBe(false);
    expect(ACCOUNT_SIDEBAR_PATHS.test('/app/analytics')).toBe(false);
  });
});
