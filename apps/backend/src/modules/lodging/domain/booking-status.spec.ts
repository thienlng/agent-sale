import { describe, expect, it } from 'vitest';

import { nextStatus, OCCUPYING } from './booking-status.js';
import { LodgingError } from './lodging.errors.js';

const today = '2026-11-06';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof LodgingError) return e.code;
    throw e;
  }
  return undefined;
}

describe('nextStatus (stay)', () => {
  it('follows the happy path', () => {
    expect(nextStatus('stay', 'hold', 'confirm', today, today)).toBe('confirmed');
    expect(nextStatus('stay', 'confirmed', 'check_in', today, today)).toBe('checked_in');
    expect(nextStatus('stay', 'checked_in', 'check_out', today, today)).toBe('checked_out');
  });

  it('cancels holds and confirmed bookings, marks no-shows', () => {
    expect(nextStatus('stay', 'hold', 'cancel', today, today)).toBe('cancelled');
    expect(nextStatus('stay', 'confirmed', 'cancel', today, today)).toBe('cancelled');
    expect(nextStatus('stay', 'confirmed', 'no_show', today, today)).toBe('no_show');
  });

  it('extends a hold without changing its status', () => {
    expect(nextStatus('stay', 'hold', 'extend_hold', today, today)).toBe('hold');
    expect(code(() => nextStatus('stay', 'confirmed', 'extend_hold', today, today))).toBe(
      'CONFLICT',
    );
  });

  it('refuses illegal moves', () => {
    expect(code(() => nextStatus('stay', 'checked_out', 'cancel', today, today))).toBe('CONFLICT');
    expect(code(() => nextStatus('stay', 'hold', 'check_in', today, today))).toBe('CONFLICT');
    expect(code(() => nextStatus('stay', 'cancelled', 'confirm', today, today))).toBe('CONFLICT');
    expect(code(() => nextStatus('stay', 'expired', 'confirm', today, today))).toBe('CONFLICT');
    expect(code(() => nextStatus('stay', 'confirmed', 'remove_block', today, today))).toBe(
      'CONFLICT',
    );
  });

  it('checks in only from the check-in date', () => {
    expect(code(() => nextStatus('stay', 'confirmed', 'check_in', '2026-11-05', today))).toBe(
      'CONFLICT',
    );
    expect(nextStatus('stay', 'confirmed', 'check_in', '2026-11-07', today)).toBe('checked_in');
  });
});

describe('nextStatus (block)', () => {
  it('removes an active block and nothing else', () => {
    expect(nextStatus('block', 'active', 'remove_block', today, today)).toBe('removed');
    expect(code(() => nextStatus('block', 'removed', 'remove_block', today, today))).toBe(
      'CONFLICT',
    );
    expect(code(() => nextStatus('block', 'active', 'confirm', today, today))).toBe('CONFLICT');
  });
});

describe('OCCUPYING', () => {
  it('lists the statuses that hold nights on the calendar', () => {
    expect([...OCCUPYING].sort()).toEqual([
      'active',
      'checked_in',
      'checked_out',
      'confirmed',
      'hold',
    ]);
  });
});
