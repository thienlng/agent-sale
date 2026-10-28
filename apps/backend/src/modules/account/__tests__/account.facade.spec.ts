import { newId, userId } from '@agent-sales/shared';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_FACADE, type AccountFacade } from '../api/index.js';
import { AccountModule } from '../account.module.js';

/** Contract test: the public API behaves as MODULE.md promises. */
describe('AccountFacade (contract)', () => {
  const facade = async () =>
    (await Test.createTestingModule({ imports: [AccountModule] }).compile()).get<AccountFacade>(
      ACCOUNT_FACADE,
    );

  it('creates an account for a user who owns none, then reuses it', async () => {
    const f = await facade();
    const lan = userId(newId());
    const first = await f.resolveForNewBusiness({ userId: lan, businessName: 'Lan Fashion' });
    const second = await f.resolveForNewBusiness({ userId: lan, businessName: 'Lan Homestay' });
    expect(second).toBe(first);
    expect(
      await f.resolveForNewBusiness({ userId: lan, accountId: first, businessName: 'x' }),
    ).toBe(first);
  });

  it('never places a business under an account the user does not own', async () => {
    const f = await facade();
    const lan = userId(newId());
    const minh = userId(newId());
    const minhAccount = await f.resolveForNewBusiness({ userId: minh, businessName: 'Minh' });
    await expect(
      f.resolveForNewBusiness({ userId: lan, accountId: minhAccount, businessName: 'Lan' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
