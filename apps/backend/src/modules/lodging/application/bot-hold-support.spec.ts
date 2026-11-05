import { describe, expect, it } from 'vitest';

import type { Quote, QuoteWarning } from '../domain/quote.js';
import type { FreeOption } from './availability.js';
import { held, toBotOption } from './bot-hold-support.js';
import type { BookingRecord, PropertyRecord } from './ports/lodging-store.js';

const option = (warnings: QuoteWarning[]): FreeOption => {
  const quote: Quote = {
    nights: [{ date: '2026-12-05', weekday: 6, label: 'T7', sell: 9_000_000, cost: 1 }],
    surcharges: [],
    totalSell: 9_000_000,
    totalCost: 1,
    warnings,
    packages: [],
  };
  return {
    property: { id: 'p1', code: 'A17', name: 'Villa', sellMode: 'whole' } as PropertyRecord,
    whole: true,
    unitIds: ['u1'],
    units: [],
    quote,
    fits: !warnings.includes('over_max') && !warnings.includes('over_standard'),
    packages: [],
    alternatives: [],
  };
};

describe('toBotOption', () => {
  it('flags guests above the standard that no surcharge covers', () => {
    expect(toBotOption(option(['over_standard']), [])).toMatchObject({
      fits: false,
      overStandard: true,
    });
  });

  it('never marks an over-maximum option overStandard, so the bot does not offer it', () => {
    expect(toBotOption(option(['over_max', 'over_standard']), [])).toMatchObject({
      fits: false,
      overStandard: false,
    });
  });
});

describe('held', () => {
  it('answers the code and the hold expiry of the booking', () => {
    const b = { code: 'BK-1', holdExpiresAt: '2026-12-01T10:00:00.000Z' } as BookingRecord;
    expect(held(b)).toEqual({ status: 'held', code: 'BK-1', holdExpiresAt: b.holdExpiresAt });
  });
});
