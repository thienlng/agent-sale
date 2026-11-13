import { describe, expect, it } from 'vitest';

import { shouldTuck } from './use-launcher-tucked';

describe('shouldTuck (TM-13)', () => {
  const page = { viewport: 900, scrollHeight: 3000, spacer: 80 };
  it('tucks the launcher while the page is scrolled somewhere in the middle', () => {
    expect(shouldTuck({ ...page, scrollY: 0 })).toBe(true);
    expect(shouldTuck({ ...page, scrollY: 1500 })).toBe(true);
  });
  it('shows it in full at the end of the page, where the spacer keeps the room free', () => {
    expect(shouldTuck({ ...page, scrollY: 2100 })).toBe(false);
    expect(shouldTuck({ ...page, scrollY: 2040 })).toBe(false);
  });
  it('shows it in full on a page that does not scroll or has no spacer', () => {
    expect(shouldTuck({ ...page, scrollY: 0, scrollHeight: 900 })).toBe(false);
    expect(shouldTuck({ ...page, scrollY: 0, spacer: 0 })).toBe(false);
  });
});
