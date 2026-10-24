import { z } from 'zod';

/**
 * Statistics contracts (ANA-01, docs/analytics.md). Every number the dashboard
 * shows has a MetricDefinition: what is counted, when it counts, who it is
 * attributed to, whether rows may be summed. Reports quote `definitionVersion`
 * so a number can always be traced to the rule that produced it.
 *
 * All definitions are PROPOSED product decisions (the reference product's
 * formulas are not verified); changing one means a new version.
 */
export const ANALYTICS_DEFINITION_VERSION = 1;

/** Where a fact came from. A manual customer is never silently a channel customer. */
export const ORIGINS = ['channel', 'manual', 'import', 'rule'] as const;
export const Origin = z.enum(ORIGINS);
export type Origin = z.infer<typeof Origin>;

export const METRIC_KEYS = [
  'customers.new',
  'phones.captured',
  'tags.assigned',
  'tags.removed',
  'tags.net',
  'tags.current',
  'statuses.changed',
  'statuses.current',
  'conversations.opened',
  'messages.inbound',
  'messages.outbound',
  'comments.received',
] as const;
export const MetricKey = z.enum(METRIC_KEYS);
export type MetricKey = z.infer<typeof MetricKey>;

export const MetricDefinition = z.object({
  key: MetricKey,
  version: z.number().int().positive(),
  group: z.enum(['activity', 'tags', 'statuses', 'conversations']),
  /** event: counted at the time it happened · snapshot: state at `asOf` · derived: from other metrics. */
  kind: z.enum(['event', 'snapshot', 'derived']),
  unit: z.literal('count'),
  /** What one counted unit is. */
  grain: z.enum(['contact', 'tag_assignment', 'message', 'conversation']),
  /** Which timestamp places it on the calendar. */
  timestamp: z.enum(['occurred_at', 'as_of']),
  /** What a total is distinct over (`none` = every event counts). */
  distinctKey: z.enum(['none', 'contact', 'conversation']),
  origins: z.object({ allowed: z.array(Origin), default: z.array(Origin) }),
  /** Who a count belongs to when filtering by salesperson. */
  attribution: z.enum(['sales_at_event', 'owner_at_as_of', 'none']),
  filters: z.object({ sales: z.boolean(), page: z.boolean() }),
  /**
   * False when one unit can sit in several rows of a breakdown (a customer with
   * two tags): the total must be computed distinct, never summed from the rows.
   */
  additiveAcrossBreakdown: z.boolean(),
  /** `pending_source`: no data feeds it yet; asking for it is an explicit error, never a 0. */
  availability: z.enum(['available', 'pending_source']),
  /** Entitlement key that must be enabled for the shop (null: every plan). */
  entitlement: z.string().nullable(),
  derivedFrom: z.array(MetricKey),
});
export type MetricDefinition = z.infer<typeof MetricDefinition>;

type Draft = Omit<MetricDefinition, 'version' | 'unit' | 'entitlement' | 'derivedFrom'> &
  Partial<Pick<MetricDefinition, 'entitlement' | 'derivedFrom'>>;
const def = (d: Draft): MetricDefinition => ({
  version: ANALYTICS_DEFINITION_VERSION,
  unit: 'count',
  entitlement: null,
  derivedFrom: [],
  ...d,
});

const channelOnly = {
  allowed: ['channel'],
  default: ['channel'],
} satisfies MetricDefinition['origins'];

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  def({
    key: 'customers.new',
    group: 'activity',
    kind: 'event',
    grain: 'contact',
    timestamp: 'occurred_at',
    distinctKey: 'contact',
    origins: { allowed: ['channel', 'manual', 'import'], default: ['channel'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'phones.captured',
    group: 'activity',
    kind: 'event',
    grain: 'contact',
    timestamp: 'occurred_at',
    distinctKey: 'contact',
    origins: { allowed: ['channel', 'manual', 'import'], default: ['channel'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'tags.assigned',
    group: 'tags',
    kind: 'event',
    grain: 'tag_assignment',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'tags.removed',
    group: 'tags',
    kind: 'event',
    grain: 'tag_assignment',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'tags.net',
    group: 'tags',
    kind: 'derived',
    grain: 'tag_assignment',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
    derivedFrom: ['tags.assigned', 'tags.removed'],
  }),
  def({
    key: 'tags.current',
    group: 'tags',
    kind: 'snapshot',
    grain: 'tag_assignment',
    timestamp: 'as_of',
    distinctKey: 'contact',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'owner_at_as_of',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: false,
    availability: 'available',
  }),
  def({
    key: 'statuses.changed',
    group: 'statuses',
    kind: 'event',
    grain: 'contact',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'sales_at_event',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'statuses.current',
    group: 'statuses',
    kind: 'snapshot',
    grain: 'contact',
    timestamp: 'as_of',
    distinctKey: 'contact',
    origins: { allowed: ['manual', 'rule'], default: ['manual', 'rule'] },
    attribution: 'owner_at_as_of',
    filters: { sales: true, page: false },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'conversations.opened',
    group: 'conversations',
    kind: 'event',
    grain: 'conversation',
    timestamp: 'occurred_at',
    distinctKey: 'conversation',
    origins: channelOnly,
    attribution: 'none',
    filters: { sales: false, page: true },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'messages.inbound',
    group: 'conversations',
    kind: 'event',
    grain: 'message',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: channelOnly,
    attribution: 'none',
    filters: { sales: false, page: true },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'messages.outbound',
    group: 'conversations',
    kind: 'event',
    grain: 'message',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: channelOnly,
    attribution: 'none',
    filters: { sales: false, page: true },
    additiveAcrossBreakdown: true,
    availability: 'available',
  }),
  def({
    key: 'comments.received',
    group: 'conversations',
    kind: 'event',
    grain: 'message',
    timestamp: 'occurred_at',
    distinctKey: 'none',
    origins: channelOnly,
    attribution: 'none',
    filters: { sales: false, page: true },
    additiveAcrossBreakdown: true,
    availability: 'pending_source',
  }),
];

export const DefinitionsResponse = z.object({
  version: z.number().int().positive(),
  definitions: z.array(MetricDefinition),
});
export type DefinitionsResponse = z.infer<typeof DefinitionsResponse>;

export function definitionOf(key: MetricKey): MetricDefinition {
  const found = METRIC_DEFINITIONS.find((d) => d.key === key);
  if (!found) throw new Error(`No definition for metric ${key}`);
  return found;
}

/** Longest range one query may span (local days). */
export const MAX_RANGE_DAYS = 366;

const LocalDate = z.iso.date();

/**
 * A statistics query. Dates are LOCAL inclusive days in the shop's time zone;
 * the server converts them to half-open UTC instants. Event metrics use the
 * range, snapshot metrics use `asOf` (default: now).
 */
export const AnalyticsQuery = z.object({
  definitionVersion: z.number().int().positive(),
  metrics: z.array(MetricKey).min(1).max(METRIC_KEYS.length),
  /** Omit to use each metric's default origins. */
  origins: z.array(Origin).min(1).optional(),
  dateRange: z.object({ from: LocalDate, to: LocalDate }),
  asOf: z.iso.datetime().optional(),
  salesIds: z.array(z.uuid()).max(50).optional(),
  pageIds: z.array(z.uuid()).max(50).optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export type QueryIssueCode =
  | 'version_mismatch'
  | 'metric_unavailable'
  | 'origin_not_allowed'
  | 'scope_not_supported'
  | 'range_invalid'
  | 'range_too_long'
  | 'as_of_in_future';

export interface QueryIssue {
  code: QueryIssueCode;
  metric?: MetricKey;
  /** Machine-readable specifics (e.g. the unsupported filter), for an actionable message. */
  detail?: Record<string, unknown>;
}

const DAY = 86_400_000;

/**
 * The rules a query must satisfy, shared by the server (rejects with 400) and
 * the web (explains before sending). Empty array = valid.
 */
export function validateAnalyticsQuery(q: AnalyticsQuery, now: Date): QueryIssue[] {
  const issues: QueryIssue[] = [];
  if (q.definitionVersion !== ANALYTICS_DEFINITION_VERSION) {
    issues.push({
      code: 'version_mismatch',
      detail: { expected: ANALYTICS_DEFINITION_VERSION, got: q.definitionVersion },
    });
  }
  const { from, to } = q.dateRange;
  if (from > to) issues.push({ code: 'range_invalid', detail: { from, to } });
  else if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > MAX_RANGE_DAYS) {
    issues.push({ code: 'range_too_long', detail: { maxDays: MAX_RANGE_DAYS } });
  }
  if (q.asOf && Date.parse(q.asOf) > now.getTime()) issues.push({ code: 'as_of_in_future' });

  for (const key of q.metrics) {
    const d = definitionOf(key);
    if (d.availability === 'pending_source') {
      issues.push({ code: 'metric_unavailable', metric: key });
      continue;
    }
    for (const origin of q.origins ?? []) {
      if (!d.origins.allowed.includes(origin)) {
        issues.push({ code: 'origin_not_allowed', metric: key, detail: { origin } });
      }
    }
    if (q.salesIds?.length && !d.filters.sales) {
      issues.push({ code: 'scope_not_supported', metric: key, detail: { filter: 'sales' } });
    }
    if (q.pageIds?.length && !d.filters.page) {
      issues.push({ code: 'scope_not_supported', metric: key, detail: { filter: 'page' } });
    }
  }
  return issues;
}

/**
 * A ratio with an undefined denominator is `null`, never a fabricated 0%.
 * Any ratio metric added later must go through this.
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
