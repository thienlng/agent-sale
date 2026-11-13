import { validateAnalyticsQuery } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildQueries,
  CONVERSATION_METRICS,
  daysAgo,
  groupOf,
  impactRangeOf,
  PEOPLE_METRICS,
  rangeProblem,
  resolveFilters,
  TAG_STATUS_METRICS,
  toSearch,
} from './filters';

const TODAY = new Date(2026, 9, 24, 9, 0, 0);
const UUID = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';

describe('statistics filters', () => {
  it('defaults to the last 7 days, every source, everybody', () => {
    expect(resolveFilters({}, TODAY)).toEqual({
      from: '2026-10-18',
      to: '2026-10-24',
      origins: ['channel', 'manual', 'import'],
      sales: [],
      pages: [],
    });
    expect(daysAgo(29, TODAY)).toBe('2026-09-25');
  });

  it('keeps the URL short: only what differs from the default', () => {
    const f = { ...resolveFilters({}, TODAY), origins: ['manual' as const], sales: [UUID] };
    expect(toSearch(resolveFilters({}, TODAY), TODAY)).toEqual({});
    expect(toSearch(f, TODAY)).toEqual({ origins: ['manual'], sales: [UUID] });
    expect(resolveFilters(toSearch(f, TODAY), TODAY)).toEqual(f);
  });

  it('never keeps an empty source choice', () => {
    expect(resolveFilters({ origins: [] }, TODAY).origins).toEqual(['channel', 'manual', 'import']);
  });

  it('asks each group only for the filters its metrics support, so no query is refused', () => {
    const f = {
      ...resolveFilters({}, TODAY),
      sales: [UUID],
      pages: [UUID],
      origins: ['manual' as const],
    };
    const q = buildQueries(f);
    expect(q.people).toMatchObject({ origins: ['manual'], salesIds: [UUID] });
    expect(q.people).not.toHaveProperty('pageIds');
    expect(q.tagStatus).toMatchObject({ salesIds: [UUID] });
    expect(q.tagStatus).not.toHaveProperty('origins');
    expect(q.conversations).toMatchObject({ pageIds: [UUID] });
    expect(q.conversations).not.toHaveProperty('salesIds');
    for (const query of Object.values(q)) {
      expect(validateAnalyticsQuery(query, TODAY)).toEqual([]);
    }
  });

  it('groups every displayed metric exactly once', () => {
    const all = [...PEOPLE_METRICS, ...TAG_STATUS_METRICS, ...CONVERSATION_METRICS];
    expect(new Set(all).size).toBe(all.length);
    expect(groupOf('customers.new')).toBe('people');
    expect(groupOf('tags.current')).toBe('tagStatus');
    expect(groupOf('messages.inbound')).toBe('conversations');
  });

  it('flags an inverted or too long range before sending', () => {
    expect(rangeProblem({ from: '2026-10-10', to: '2026-10-01' })).toBe('rangeInvalid');
    expect(rangeProblem({ from: '2025-01-01', to: '2026-10-24' })).toBe('rangeTooLong');
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-24' })).toBeNull();
  });
});

describe('impactRangeOf', () => {
  const today = new Date(2026, 10, 13);
  it('maps the report presets to the "Rapiz đã mang lại" period (MS-23, TM-12)', () => {
    expect(impactRangeOf({ from: '2026-11-13', to: '2026-11-13' }, today)).toBe('today');
    expect(impactRangeOf({ from: '2026-11-07', to: '2026-11-13' }, today)).toBe('7d');
    expect(impactRangeOf({ from: '2026-10-15', to: '2026-11-13' }, today)).toBe('30d');
  });
  it('has no matching period for any other range', () => {
    expect(impactRangeOf({ from: '2026-11-01', to: '2026-11-13' }, today)).toBeNull();
    expect(impactRangeOf({ from: '2026-11-06', to: '2026-11-12' }, today)).toBeNull();
  });
});
