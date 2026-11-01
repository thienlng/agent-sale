import { describe, expect, it } from 'vitest';

import { availableBySaleBranches } from './stock.js';

describe('availableBySaleBranches', () => {
  const inv = [
    { branchId: 1, onHand: 10, reserved: 2 },
    { branchId: 2, onHand: 5, reserved: 0 },
    { branchId: 3, onHand: 100, reserved: 0 },
  ];
  it('sums onHand − reserved over the sale branches only', () =>
    expect(availableBySaleBranches(inv, [1, 2])).toBe(13));
  it('floors each branch at zero (oversold or negative stock)', () =>
    expect(
      availableBySaleBranches(
        [
          { branchId: 1, onHand: 1, reserved: 4 },
          { branchId: 2, onHand: -3, reserved: 0 },
          { branchId: 3, onHand: 6, reserved: 1 },
        ],
        [1, 2, 3],
      ),
    ).toBe(5));
  it('counts a sale branch missing from the inventory as zero', () =>
    expect(availableBySaleBranches(inv, [2, 99])).toBe(5));
  it('is zero without sale branches or inventory', () => {
    expect(availableBySaleBranches(inv, [])).toBe(0);
    expect(availableBySaleBranches([], [1])).toBe(0);
  });
  it('returns an integer for fractional quantities', () =>
    expect(availableBySaleBranches([{ branchId: 1, onHand: 2.5, reserved: 0.2 }], [1])).toBe(2));
});
