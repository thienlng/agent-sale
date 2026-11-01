import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { lodgingConflict } from './bookings';

describe('lodgingConflict', () => {
  it('reads taken nights with the blocking booking codes', () => {
    const error = new ApiClientError(409, 'CONFLICT', 'taken', undefined, {
      reason: 'NIGHTS_TAKEN',
      codes: ['BK-0001', 'BK-0002'],
    });
    expect(lodgingConflict(error)).toEqual({
      reason: 'NIGHTS_TAKEN',
      codes: ['BK-0001', 'BK-0002'],
    });
  });

  it('reads a stale version', () => {
    const error = new ApiClientError(409, 'CONFLICT', 'stale', undefined, {
      reason: 'STALE_VERSION',
      version: 4,
    });
    expect(lodgingConflict(error)).toEqual({ reason: 'STALE_VERSION', codes: [] });
  });

  it('has no reason for other conflicts and other errors', () => {
    expect(lodgingConflict(new ApiClientError(409, 'CONFLICT', 'illegal move'))).toEqual({
      reason: null,
      codes: [],
    });
    expect(
      lodgingConflict(
        new ApiClientError(400, 'VALIDATION_FAILED', 'bad', undefined, { reason: 'NIGHTS_TAKEN' }),
      ),
    ).toEqual({ reason: null, codes: [] });
    expect(lodgingConflict(new Error('network'))).toEqual({ reason: null, codes: [] });
  });
});
