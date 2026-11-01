import { describe, expect, it } from 'vitest';

import { defaultSelection, reconcileSelection, toggleBranch, validateSelection } from './branches';

const b = (id: number) => ({ id, name: `CN ${id}`, address: null });
const messages = { branches: 'need one', orderBranch: 'need order' };

describe('branch selection', () => {
  it('ticks the only branch, none of several', () => {
    expect(defaultSelection([b(1)])).toEqual({ saleBranchIds: [1], orderBranchId: 1 });
    expect(defaultSelection([b(1), b(2)])).toEqual({ saleBranchIds: [], orderBranchId: null });
  });

  it('keeps the order branch among the ticked ones', () => {
    let s = toggleBranch({ saleBranchIds: [], orderBranchId: null }, 1, true);
    expect(s).toEqual({ saleBranchIds: [1], orderBranchId: 1 });
    s = toggleBranch(s, 2, true);
    expect(s).toEqual({ saleBranchIds: [1, 2], orderBranchId: 1 });
    s = toggleBranch(s, 1, false);
    expect(s).toEqual({ saleBranchIds: [2], orderBranchId: 2 });
  });

  it('starts over when a picked branch vanished', () => {
    const picked = { saleBranchIds: [1, 3], orderBranchId: 3 };
    expect(reconcileSelection([b(1), b(3)], picked)).toEqual(picked);
    expect(reconcileSelection([b(1), b(2)], picked)).toEqual({
      saleBranchIds: [],
      orderBranchId: null,
    });
  });

  it('requires one branch and an order branch among them', () => {
    expect(validateSelection({ saleBranchIds: [], orderBranchId: null }, messages)).toEqual({
      branches: 'need one',
    });
    expect(validateSelection({ saleBranchIds: [1, 2], orderBranchId: null }, messages)).toEqual({
      orderBranch: 'need order',
    });
    expect(validateSelection({ saleBranchIds: [1, 2], orderBranchId: 2 }, messages)).toEqual({});
  });
});
