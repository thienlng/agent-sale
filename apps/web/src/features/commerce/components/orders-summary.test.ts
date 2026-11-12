import { describe, expect, it } from 'vitest';

import { cancelledInList } from './orders-list';

describe('cancelledInList (TM2-13)', () => {
  const counts = { all: 7, new: 4, cancelled: 3 };
  it('counts the cancelled orders the list holds', () => {
    expect(cancelledInList({}, counts)).toBe(3);
    expect(cancelledInList({ status: ['cancelled'] }, counts)).toBe(3);
    expect(cancelledInList({ status: ['new'], statusMode: 'exclude' }, counts)).toBe(3);
  });
  it('is 0 when the status filter leaves cancelled orders out', () => {
    expect(cancelledInList({ status: ['new'] }, counts)).toBe(0);
    expect(cancelledInList({ status: ['cancelled'], statusMode: 'exclude' }, counts)).toBe(0);
    expect(cancelledInList({}, { all: 2 })).toBe(0);
  });
});
