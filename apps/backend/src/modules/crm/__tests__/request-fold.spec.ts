import type { CustomerRequestDto } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { foldUpdates } from '../application/customer-request.service.js';

const entry = (
  id: string,
  kind: CustomerRequestDto['kind'],
  update: boolean,
  minute: number,
): CustomerRequestDto => ({
  id,
  contactId: '018d0000-0000-7000-8000-0000000000c1',
  kind,
  update,
  details: { note: id },
  dateLabel: null,
  recordedAt: new Date(Date.UTC(2026, 10, 13, 1, minute)).toISOString(),
});

describe('foldUpdates (LM-4)', () => {
  it('shows one card per request: the newest state, its update count and first time', () => {
    const cards = foldUpdates([
      entry('u3', 'placement_test', true, 40),
      entry('c1', 'consultation', false, 35),
      entry('u2', 'placement_test', true, 30),
      entry('u1', 'placement_test', true, 20),
      entry('r1', 'placement_test', false, 10),
      entry('r0', 'placement_test', false, 5),
    ]);
    expect(cards.map((c) => [c.id, c.updates])).toEqual([
      ['u3', 3],
      ['c1', 0],
      ['r0', 0],
    ]);
    expect(cards[0]?.firstRecordedAt).toBe(entry('r1', 'placement_test', false, 10).recordedAt);
    expect(cards[1]?.firstRecordedAt).toBe(cards[1]?.recordedAt);
  });

  it('keeps an update whose first entry is older than the entries read, without a first time', () => {
    const [card] = foldUpdates([entry('u1', 'appointment', true, 20)]);
    expect(card).toMatchObject({ id: 'u1', updates: 1 });
    expect(card?.firstRecordedAt).toBeUndefined();
  });
});
