import { describe, expect, it } from 'vitest';
import { StayDates, StayParty, UpdateStayStatusRequest } from './lodging.schema.js';

describe('stay request boundaries', () => {
  it('accepts real leap dates and rejects impossible dates and reversed stays', () => {
    expect(StayDates.safeParse({ checkIn: '2028-02-29', checkOut: '2028-03-01' }).success).toBe(
      true,
    );
    for (const dates of [
      { checkIn: '2027-02-29', checkOut: '2027-03-01' },
      { checkIn: '2027-04-31', checkOut: '2027-05-02' },
      { checkIn: '2027-01-02', checkOut: '2027-01-02' },
      { checkIn: '2027-01-03', checkOut: '2027-01-02' },
    ])
      expect(StayDates.safeParse(dates).success).toBe(false);
  });
  it('does not silently treat partially supplied child ages as a complete party', () => {
    expect(StayParty.safeParse({ adults: 2, children: 2, childAges: [5] }).success).toBe(false);
    expect(StayParty.safeParse({ adults: 2, children: 2 }).success).toBe(true);
  });
  it('requires explicit staff attestations and a price before confirming', () => {
    expect(UpdateStayStatusRequest.safeParse({ status: 'confirmed', version: 1 }).success).toBe(
      false,
    );
    expect(
      UpdateStayStatusRequest.safeParse({
        status: 'confirmed',
        version: 1,
        availabilityVerified: true,
        termsAndGuestsVerified: true,
        agreedTotal: 12000000,
      }).success,
    ).toBe(true);
  });
});
