import { LodgingError } from './lodging.errors.js';

export type StayStatus =
  'hold' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'expired' | 'no_show';
export type BlockStatus = 'active' | 'removed';
export type Action =
  'confirm' | 'check_in' | 'check_out' | 'cancel' | 'no_show' | 'extend_hold' | 'remove_block';

/** Statuses whose nights stay taken on the calendar (rows in lodging_unit_nights). */
export const OCCUPYING: readonly string[] = [
  'hold',
  'confirmed',
  'checked_in',
  'checked_out',
  'active',
];

const STAY_MOVES: Record<string, Partial<Record<Action, StayStatus>>> = {
  hold: { confirm: 'confirmed', cancel: 'cancelled', extend_hold: 'hold' },
  confirmed: { check_in: 'checked_in', cancel: 'cancelled', no_show: 'no_show' },
  checked_in: { check_out: 'checked_out' },
};
const BLOCK_MOVES: Record<string, Partial<Record<Action, BlockStatus>>> = {
  active: { remove_block: 'removed' },
};

/**
 * The status after `action`, or CONFLICT when the move is illegal.
 * Check-in is allowed from the check-in night (`today` is the local date).
 */
export function nextStatus(
  kind: 'stay' | 'block',
  from: string,
  action: Action,
  today: string,
  checkIn: string,
): StayStatus | BlockStatus {
  const moves = kind === 'stay' ? STAY_MOVES : BLOCK_MOVES;
  const to = Object.hasOwn(moves, from) ? moves[from]?.[action] : undefined;
  if (!to) {
    throw new LodgingError('CONFLICT', `Cannot ${action} a ${kind} that is ${from}`, {
      kind,
      from,
      action,
    });
  }
  if (action === 'check_in' && today < checkIn) {
    throw new LodgingError('CONFLICT', 'Check-in is allowed from the check-in date', {
      today,
      checkIn,
    });
  }
  return to;
}
