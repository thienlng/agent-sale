import {
  ANALYTICS_DEFINITION_VERSION,
  type AnalyticsQuery,
  MAX_RANGE_DAYS,
  type MetricKey,
  Origin,
} from '@agent-sales/contracts';
import { z } from 'zod';

import { isoDate } from '@/lib/format';

/** Filters live in the URL so a view can be shared; ids only, never customer data. */
export const FiltersSearch = z.object({
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  origins: z.array(Origin).optional().catch(undefined),
  sales: z.array(z.uuid()).optional().catch(undefined),
  pages: z.array(z.uuid()).optional().catch(undefined),
});
export type FiltersSearch = z.infer<typeof FiltersSearch>;

/** Customer origins the filter offers (tag and status events are by people or rules, not by source). */
export const CUSTOMER_ORIGINS = ['channel', 'manual', 'import'] as const;

export interface Filters {
  from: string;
  to: string;
  origins: Array<(typeof CUSTOMER_ORIGINS)[number]>;
  sales: string[];
  pages: string[];
}

export function daysAgo(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Default: the last 7 days, all customer sources, everybody, every page. */
export function resolveFilters(s: FiltersSearch, today = new Date()): Filters {
  const origins = (s.origins ?? CUSTOMER_ORIGINS).filter((o): o is Filters['origins'][number] =>
    (CUSTOMER_ORIGINS as readonly string[]).includes(o),
  );
  return {
    from: s.from ?? daysAgo(6, today),
    to: s.to ?? isoDate(today),
    origins: origins.length ? origins : [...CUSTOMER_ORIGINS],
    sales: s.sales ?? [],
    pages: s.pages ?? [],
  };
}

export const PEOPLE_METRICS: readonly MetricKey[] = ['customers.new', 'phones.captured'];
export const TAG_STATUS_METRICS: readonly MetricKey[] = [
  'tags.assigned',
  'tags.removed',
  'tags.net',
  'tags.current',
  'statuses.changed',
  'statuses.current',
];
export const CONVERSATION_METRICS: readonly MetricKey[] = [
  'conversations.opened',
  'messages.inbound',
  'messages.outbound',
];

export type Group = 'people' | 'tagStatus' | 'conversations';

/**
 * Each metric only accepts the filters its definition supports, so the page asks in three groups:
 * customers (source + salesperson), tags and statuses (salesperson), conversations (page).
 */
export function buildQueries(f: Filters): Record<Group, AnalyticsQuery> {
  const base = {
    definitionVersion: ANALYTICS_DEFINITION_VERSION,
    dateRange: { from: f.from, to: f.to },
  };
  const sales = f.sales.length ? { salesIds: f.sales } : {};
  return {
    people: { ...base, metrics: [...PEOPLE_METRICS], origins: f.origins, ...sales },
    tagStatus: { ...base, metrics: [...TAG_STATUS_METRICS], ...sales },
    conversations: {
      ...base,
      metrics: [...CONVERSATION_METRICS],
      ...(f.pages.length ? { pageIds: f.pages } : {}),
    },
  };
}

export const groupOf = (m: MetricKey): Group =>
  (PEOPLE_METRICS as readonly string[]).includes(m)
    ? 'people'
    : (CONVERSATION_METRICS as readonly string[]).includes(m)
      ? 'conversations'
      : 'tagStatus';

/** A problem with the chosen range, before anything is sent. */
export function rangeProblem(
  f: Pick<Filters, 'from' | 'to'>,
): 'rangeInvalid' | 'rangeTooLong' | null {
  if (f.from > f.to) return 'rangeInvalid';
  if ((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 + 1 > MAX_RANGE_DAYS)
    return 'rangeTooLong';
  return null;
}

/** The URL form of the filters: only what differs from the default. */
export function toSearch(f: Filters, today = new Date()): FiltersSearch {
  const d = resolveFilters({}, today);
  return {
    ...(f.from !== d.from ? { from: f.from } : {}),
    ...(f.to !== d.to ? { to: f.to } : {}),
    ...(f.origins.length !== CUSTOMER_ORIGINS.length ? { origins: f.origins } : {}),
    ...(f.sales.length ? { sales: f.sales } : {}),
    ...(f.pages.length ? { pages: f.pages } : {}),
  };
}
