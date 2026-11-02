import type { Cadence } from './cadence.js';

/** Owner assistant schedules (T-172): code-computed reports and alerts. */

export const SCHEDULE_TEMPLATES = [
  'revenue_summary',
  'new_orders',
  'low_stock',
  'unanswered_conversations',
  'new_customers',
] as const;
export type ScheduleTemplate = (typeof SCHEDULE_TEMPLATES)[number];

export type ScheduleMode = 'report' | 'alert';
export type ScheduleStatus = 'active' | 'paused';
export type SchedulePausedReason =
  'owner' | 'failures' | 'business_unavailable' | 'owner_not_active';
export type ScheduleChannel = 'in_app' | 'email' | 'push';
export type ScheduleCreatedBy = 'owner' | 'assistant' | 'suggestion';
export type ScheduleRunTrigger = 'cadence' | 'manual';
export type ScheduleRunStatus = 'running' | 'done' | 'failed' | 'blocked' | 'skipped';

export type { Cadence };

/** Schedules per owner per account: active, paused and pending schedule proposals alike. */
export const MAX_SCHEDULES = 10;
/** Templates that can run as an alert (S3-R13). */
export const ALERT_TEMPLATES: readonly ScheduleTemplate[] = [
  'new_orders',
  'low_stock',
  'unanswered_conversations',
];
/** Intervals an alert may be checked at, in minutes. */
export const ALERT_INTERVALS: readonly number[] = [15, 30, 60, 120, 180, 240, 360, 720];
/** Shortest `every` interval of a report, in minutes. */
export const REPORT_MIN_INTERVAL = 60;
/** "Chạy ngay" is refused this soon after the last manual run. */
export const MANUAL_RUN_GAP_MS = 5 * 60_000;

/** A schedule as drafted (params already validated for the template). */
export interface ScheduleDraftInput {
  name: string;
  businessId: string;
  template: ScheduleTemplate;
  mode: ScheduleMode;
  params: Record<string, unknown>;
  cadence: Cadence;
  channels: ScheduleChannel[];
  commentary: boolean;
}

export type ScheduleProblem =
  | 'invalid_mode'
  | 'interval_too_short'
  | 'alert_needs_every'
  | 'schedule_limit'
  | 'unknown_business'
  | 'unsafe_name'
  | 'email_unavailable'
  | 'in_app_required';

export interface ScheduleDraftContext {
  /** The account's businesses the owner is an active member of. */
  businessIds: readonly string[];
  /**
   * Schedules plus pending schedule proposals the owner already has, not counting the one being
   * edited; null skips the limit (an edit never adds one).
   */
  existingCount: number | null;
  emailAvailable: boolean;
  /** The safety scan (no URL, phone, email, injection): the name goes into emails. */
  isSafeText: (text: string) => boolean;
}

/** Every problem of a draft, in a stable order; empty = valid. */
export function validateDraft(d: ScheduleDraftInput, ctx: ScheduleDraftContext): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  if (d.mode === 'alert' && !ALERT_TEMPLATES.includes(d.template)) problems.push('invalid_mode');
  if (d.mode === 'alert' && d.cadence.kind !== 'every') problems.push('alert_needs_every');
  if (d.cadence.kind === 'every') {
    const tooShort =
      d.mode === 'alert'
        ? !ALERT_INTERVALS.includes(d.cadence.minutes)
        : d.cadence.minutes < REPORT_MIN_INTERVAL;
    if (tooShort) problems.push('interval_too_short');
  }
  if (ctx.existingCount !== null && ctx.existingCount >= MAX_SCHEDULES) {
    problems.push('schedule_limit');
  }
  if (!ctx.businessIds.includes(d.businessId)) problems.push('unknown_business');
  if (!ctx.isSafeText(d.name)) problems.push('unsafe_name');
  if (d.channels.includes('email') && !ctx.emailAvailable) problems.push('email_unavailable');
  if (!d.channels.includes('in_app')) problems.push('in_app_required');
  return problems;
}

/** Whether an edit changes what an alert watches (its state then starts over). */
export function changesAlertState(
  before: Pick<ScheduleDraftInput, 'template' | 'mode' | 'params'>,
  after: Pick<ScheduleDraftInput, 'template' | 'mode' | 'params'>,
): boolean {
  return (
    before.template !== after.template ||
    before.mode !== after.mode ||
    stableJson(before.params) !== stableJson(after.params)
  );
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
