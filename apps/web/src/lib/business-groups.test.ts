import type { MembershipDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { groupByAccount } from './business-groups';

const m = (workspaceId: string, accountId: string | null, accountName: string | null) =>
  ({
    workspaceId,
    workspaceName: workspaceId,
    role: 'owner',
    industry: 'retail',
    accountId,
    accountName,
  }) as MembershipDto;

describe('groupByAccount', () => {
  it('keeps the first-seen order of accounts and of businesses within them', () => {
    const groups = groupByAccount([
      m('B1', 'X', 'Lan'),
      m('B3', 'Y', 'Minh'),
      m('B2', 'X', 'Lan'),
      m('B4', null, null),
    ]);
    expect(groups.map((g) => [g.accountName, g.businesses.map((b) => b.workspaceId)])).toEqual([
      ['Lan', ['B1', 'B2']],
      ['Minh', ['B3']],
      [null, ['B4']],
    ]);
  });
});
