import { describe, expect, it } from 'vitest';

import type { Quote, QuoteWarning } from '../domain/quote.js';
import type { FreeOption } from './availability.js';
import { pkg } from '../__tests__/factories/packages.js';
import { held, pickPackages, toBotOption } from './bot-hold-support.js';
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

describe('pickPackages (T-193)', () => {
  const packages = [
    pkg('w5', null, 5),
    pkg('w6', null, 6),
    pkg('b1', 'u1', 1, { name: 'Phòng đôi' }),
    pkg('b2', 'u1', 2),
  ];
  const quote = (targets: (string | null)[]): Quote => ({
    nights: [],
    surcharges: [],
    totalSell: 1,
    totalCost: 1,
    warnings: [],
    packages: targets.map((target) => ({ target, packageId: 'x', name: 'x' })),
  });
  const names = new Map([['u1', 'Bungalow 1']]);

  it('matches names case- and accent-insensitively per target; a later choice wins', () => {
    expect(pickPackages(quote([null]), packages, [{ unitId: null, name: ' 6pn ' }], names)).toEqual(
      { ids: ['w6'] },
    );
    expect(
      pickPackages(
        quote(['u1']),
        packages,
        [
          { unitId: 'u1', name: 'phong doi' },
          { unitId: 'u1', name: '2PN' },
        ],
        names,
      ),
    ).toEqual({ ids: ['b2'] });
  });

  it('answers every valid name for an unknown name or a target the stay does not price', () => {
    expect(pickPackages(quote(['u1']), packages, [{ unitId: null, name: '5PN' }], names)).toEqual({
      valid: ['Bungalow 1: Phòng đôi', 'Bungalow 1: 2PN'],
    });
    expect(pickPackages(quote([null]), packages, [{ unitId: null, name: '7PN' }], names)).toEqual({
      valid: ['5PN', '6PN'],
    });
  });

  it('ignores the asked names when the stay is priced without any package', () => {
    // A stale or invented package must not block a hold that has no package to choose.
    expect(pickPackages(quote([]), packages, [{ unitId: null, name: '5PN' }], names)).toEqual({
      ids: [],
    });
    expect(pickPackages(quote([]), [], [{ unitId: 'u1', name: '2PN' }], names)).toEqual({
      ids: [],
    });
  });
});
