import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_DEFINITION_VERSION,
  type AnalyticsQuery,
  definitionOf,
  METRIC_DEFINITIONS,
  METRIC_KEYS,
  MetricDefinition,
  ratio,
  validateAnalyticsQuery,
} from './analytics.schema.js';

const NOW = new Date('2026-10-24T08:00:00.000Z');
const base: AnalyticsQuery = {
  definitionVersion: ANALYTICS_DEFINITION_VERSION,
  metrics: ['customers.new'],
  dateRange: { from: '2026-10-01', to: '2026-10-24' },
};
const codes = (q: Partial<AnalyticsQuery>) =>
  validateAnalyticsQuery({ ...base, ...q }, NOW).map((i) => i.code);

describe('metric definitions', () => {
  it('has exactly one valid definition per metric key', () => {
    expect(METRIC_DEFINITIONS.map((d) => d.key).sort()).toEqual([...METRIC_KEYS].sort());
    for (const d of METRIC_DEFINITIONS) {
      expect(MetricDefinition.parse(d)).toEqual(d);
      expect(d.version).toBe(ANALYTICS_DEFINITION_VERSION);
      expect(d.origins.allowed).toEqual(expect.arrayContaining(d.origins.default));
    }
  });

  it('keeps events and snapshots apart', () => {
    for (const d of METRIC_DEFINITIONS) {
      expect(d.timestamp).toBe(d.kind === 'snapshot' ? 'as_of' : 'occurred_at');
      if (d.kind === 'derived') expect(d.derivedFrom.length).toBeGreaterThan(0);
    }
  });

  it('does not count manual customers as channel customers unless asked', () => {
    const d = definitionOf('customers.new');
    expect(d.origins.default).toEqual(['channel']);
    expect(d.origins.allowed).toContain('manual');
  });

  it('marks metrics whose breakdown rows overlap as non-additive', () => {
    expect(definitionOf('tags.current').additiveAcrossBreakdown).toBe(false);
    expect(definitionOf('statuses.current').additiveAcrossBreakdown).toBe(true);
  });
});

describe('validateAnalyticsQuery', () => {
  it('accepts a normal query', () => {
    expect(codes({})).toEqual([]);
  });

  it('rejects another definition version', () => {
    expect(codes({ definitionVersion: 99 })).toEqual(['version_mismatch']);
  });

  it('rejects an inverted or too long range', () => {
    expect(codes({ dateRange: { from: '2026-10-24', to: '2026-10-01' } })).toEqual([
      'range_invalid',
    ]);
    expect(codes({ dateRange: { from: '2025-01-01', to: '2026-10-24' } })).toEqual([
      'range_too_long',
    ]);
    // 366 inclusive days is the limit.
    expect(codes({ dateRange: { from: '2025-10-24', to: '2026-10-24' } })).toEqual([]);
  });

  it('rejects a snapshot in the future', () => {
    expect(codes({ asOf: '2026-10-25T00:00:00.000Z' })).toEqual(['as_of_in_future']);
    expect(codes({ asOf: '2026-10-24T08:00:00.000Z' })).toEqual([]);
  });

  it('asks for a metric that has no data source explicitly instead of returning 0', () => {
    expect(codes({ metrics: ['comments.received'] })).toEqual(['metric_unavailable']);
  });

  it('rejects origins a metric cannot have', () => {
    expect(codes({ metrics: ['tags.assigned'], origins: ['channel'] })).toEqual([
      'origin_not_allowed',
    ]);
    expect(codes({ metrics: ['customers.new'], origins: ['manual', 'channel'] })).toEqual([]);
  });

  it('rejects filters a metric cannot honour, naming the metric and filter', () => {
    const page = validateAnalyticsQuery(
      { ...base, metrics: ['customers.new', 'messages.inbound'], pageIds: [crypto.randomUUID()] },
      NOW,
    );
    expect(page).toEqual([
      { code: 'scope_not_supported', metric: 'customers.new', detail: { filter: 'page' } },
    ]);
    const sales = validateAnalyticsQuery(
      { ...base, metrics: ['messages.inbound'], salesIds: [crypto.randomUUID()] },
      NOW,
    );
    expect(sales).toEqual([
      { code: 'scope_not_supported', metric: 'messages.inbound', detail: { filter: 'sales' } },
    ]);
  });
});

describe('ratio', () => {
  it('is undefined (null), never 0%, when the denominator is 0', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(0, 4)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });
});
