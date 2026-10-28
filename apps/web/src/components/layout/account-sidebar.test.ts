import { describe, expect, it } from 'vitest';

import { ACCOUNT_PATHS } from './account-sidebar';

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
