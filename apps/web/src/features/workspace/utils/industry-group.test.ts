import { describe, expect, it } from 'vitest';

import { industryGroup, offeringKindOf } from './industry-group';

describe('industryGroup', () => {
  it.each([
    ['hotel', 'hotel'],
    ['saas', 'saas'],
    ['education', 'service'],
    ['spa', 'service'],
    ['retail', 'shop'],
    ['fashion', 'shop'],
    ['dental', 'shop'],
    ['other', 'shop'],
    ['', 'shop'],
  ])('puts %s in the %s group', (industry, group) => {
    expect(industryGroup(industry)).toBe(group);
  });

  it('is undefined while the industry is unknown', () => {
    expect(industryGroup(undefined)).toBeUndefined();
  });
});

describe('offeringKindOf', () => {
  it('sells courses in education and services in a spa, nothing elsewhere', () => {
    expect(offeringKindOf('education')).toBe('course');
    expect(offeringKindOf('spa')).toBe('service');
    expect(offeringKindOf('retail')).toBeNull();
    expect(offeringKindOf(undefined)).toBeNull();
  });
});
