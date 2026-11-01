import { describe, expect, it } from 'vitest';

import {
  botStayProblems,
  compareFitThenPrice,
  MAX_BOT_OPTIONS,
  rankForBot,
} from './availability-ranking.js';

const opt = (propertyId: string, fits: boolean, totalSell: number | null) => ({
  propertyId,
  fits,
  totalSell,
});

describe('compareFitThenPrice', () => {
  it('puts fitting options first, then the cheapest, unpriced last', () => {
    const list = [opt('a', false, 1), opt('b', true, null), opt('c', true, 5), opt('d', true, 3)];
    expect(list.sort(compareFitThenPrice).map((o) => o.propertyId)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('rankForBot', () => {
  const all = [opt('a', true, 9), opt('b', true, 5), opt('c', false, 1), opt('a', true, 7)];

  it('without a requested property returns every option ranked', () => {
    expect(rankForBot(all)).toEqual({
      requestedFull: false,
      options: [opt('b', true, 5), opt('a', true, 7), opt('a', true, 9), opt('c', false, 1)],
    });
  });

  it('returns only the requested property while it is free', () => {
    expect(rankForBot(all, 'a')).toEqual({
      requestedFull: false,
      options: [opt('a', true, 7), opt('a', true, 9)],
    });
  });

  it('marks the requested property full and offers the others as alternatives', () => {
    expect(rankForBot(all, 'z')).toEqual({
      requestedFull: true,
      options: [opt('b', true, 5), opt('a', true, 7), opt('a', true, 9), opt('c', false, 1)],
    });
  });

  it('caps the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => opt(`p${i}`, true, i));
    expect(rankForBot(many).options).toHaveLength(MAX_BOT_OPTIONS);
  });
});

describe('botStayProblems', () => {
  it('accepts 1 to 60 nights from today', () => {
    expect(botStayProblems('2026-11-01', '2026-11-02', '2026-11-01')).toEqual({
      nights: 1,
      problems: [],
    });
  });

  it('reports past check-ins and stays over 60 nights', () => {
    expect(botStayProblems('2026-10-31', '2026-11-02', '2026-11-01').problems).toEqual([
      'past_date',
    ]);
    expect(botStayProblems('2026-11-01', '2027-01-01', '2026-11-01')).toEqual({
      nights: 61,
      problems: ['too_long'],
    });
  });

  it('reports invalid dates and a check-out not after check-in as a problem, never throws', () => {
    const invalid = { nights: 0, problems: ['invalid_dates'] };
    expect(botStayProblems('2026-11-31', '2026-12-02', '2026-11-01')).toEqual(invalid);
    expect(botStayProblems('2026-11-05', '2026-11-05', '2026-11-01')).toEqual(invalid);
    expect(botStayProblems('cuối tuần', '2026-11-05', '2026-11-01')).toEqual(invalid);
  });
});
