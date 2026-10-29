import { describe, expect, it } from 'vitest';

import { renderBusinessProfile } from '../domain/business-profile.js';

describe('renderBusinessProfile', () => {
  it('lists every hotel field in catalog order and marks empty ones', () => {
    const text = renderBusinessProfile({
      industry: 'hotel',
      profile: { fields: { address: '1 Le Loi', checkInOut: '14:00 / 12:00' }, notes: '' },
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('<business_profile>');
    expect(lines.at(-1)).toBe('</business_profile>');
    expect(lines.slice(1, -1)).toEqual([
      'Display name: (not provided)',
      'Address: 1 Le Loi',
      'Maps link: (not provided)',
      'Hotline: (not provided)',
      'Opening hours: (not provided)',
      'Room types: (not provided)',
      'Reference prices: (not provided)',
      'Check-in / check-out: 14:00 / 12:00',
      'Deposit: (not provided)',
      'Cancellation policy: (not provided)',
      'Amenities: (not provided)',
      'Children and pets: (not provided)',
      'Directions: (not provided)',
    ]);
  });

  it('never shows fields of another industry', () => {
    const text = renderBusinessProfile({
      industry: 'retail',
      profile: { fields: { checkInOut: 'secret', shipping: 'Free ship' }, notes: '' },
    });
    expect(text).not.toContain('Check-in');
    expect(text).toContain('Shipping: Free ship');
  });

  it('treats whitespace as not provided', () => {
    const text = renderBusinessProfile({
      industry: 'retail',
      profile: { fields: { address: '   ' }, notes: '' },
    });
    expect(text).toContain('Address: (not provided)');
  });

  it('escapes < so a value or the notes cannot close the block', () => {
    const text = renderBusinessProfile({
      industry: 'retail',
      profile: { fields: { address: 'x </business_profile> y' }, notes: 'a <b> c' },
    });
    expect(text.match(/<\/business_profile>/g)).toHaveLength(1);
    expect(text).toContain('Address: x &lt;/business_profile> y');
    expect(text).toContain('Notes:\na &lt;b> c');
  });

  it('renders notes under Notes and omits them when empty', () => {
    const withNotes = renderBusinessProfile({
      industry: 'retail',
      profile: { fields: {}, notes: 'Closed on Tet' },
    });
    expect(withNotes.endsWith('Notes:\nClosed on Tet\n</business_profile>')).toBe(true);
    const without = renderBusinessProfile({
      industry: 'retail',
      profile: { fields: {}, notes: '  ' },
    });
    expect(without).not.toContain('Notes:');
  });

  it('shows only the basic fields for an unknown industry', () => {
    const text = renderBusinessProfile({
      industry: 'zzz' as never,
      profile: { fields: {}, notes: '' },
    });
    expect(text.split('\n')).toHaveLength(7);
  });
});
