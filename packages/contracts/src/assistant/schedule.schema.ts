import { z } from 'zod';

/**
 * Owner assistant schedules (T-172): code-computed reports and alerts. Every time is local time
 * in Asia/Ho_Chi_Minh (UTC+7, no DST); the backend computes the run times.
 */

const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');

export const ScheduleTemplate = z.enum([
  'revenue_summary',
  'new_orders',
  'low_stock',
  'unanswered_conversations',
  'new_customers',
]);
export type ScheduleTemplate = z.infer<typeof ScheduleTemplate>;

export const ScheduleMode = z.enum(['report', 'alert']);
export type ScheduleMode = z.infer<typeof ScheduleMode>;

export const ScheduleChannel = z.enum(['in_app', 'email', 'push']);
export type ScheduleChannel = z.infer<typeof ScheduleChannel>;

/** Templates that can run as an alert (S3-R13); the others are reports only. */
export const ALERT_TEMPLATES: readonly ScheduleTemplate[] = [
  'new_orders',
  'low_stock',
  'unanswered_conversations',
];

/** Intervals an alert may be checked at, in minutes. */
export const ALERT_INTERVALS = [15, 30, 60, 120, 180, 240, 360, 720] as const;
/** Shortest `every` interval of a report, in minutes. */
export const REPORT_MIN_INTERVAL = 60;
/** Schedules per owner per account (active, paused and pending proposals). */
export const MAX_SCHEDULES = 10;

/** When it runs: a structure, never cron (S3-R3). */
export const Cadence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), at: HHmm }),
  z.object({
    kind: z.literal('weekly'),
    /** 1 = Monday … 7 = Sunday; unique. */
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, 'days must be unique'),
    at: HHmm,
  }),
  z.object({
    kind: z.literal('monthly'),
    /** 1–28, or -1 for the last day of the month. */
    day: z
      .number()
      .int()
      .refine((d) => d === -1 || (d >= 1 && d <= 28), 'day must be 1–28 or -1'),
    at: HHmm,
  }),
  z.object({
    kind: z.literal('every'),
    minutes: z.number().int().min(15).max(1440),
    /** Optional active hours; both or neither. `activeTo` before `activeFrom` spans midnight. */
    activeFrom: HHmm.optional(),
    activeTo: HHmm.optional(),
  }),
]);
export type Cadence = z.infer<typeof Cadence>;

export const SchedulePeriod = z.enum(['day', 'week', 'month']);
export const ScheduleWindow = z.enum(['previous', 'to_date']);

/** `revenue_summary`, `new_customers` and `new_orders` reports. */
export const PeriodParams = z.object({
  period: SchedulePeriod.default('day'),
  window: ScheduleWindow.default('previous'),
});
export const NewOrdersAlertParams = z.object({
  minCount: z.number().int().min(1).max(1000).default(1),
});
export const LowStockParams = z.object({
  threshold: z.number().int().min(0).max(100_000).default(5),
});
export const UnansweredParams = z.object({
  minutes: z.number().int().min(5).max(1440).default(30),
  minCount: z.number().int().min(1).max(1000).default(1),
});

/** The params schema of a template in a mode (defaults fill missing fields). */
export function scheduleParamsSchema(template: ScheduleTemplate, mode: ScheduleMode) {
  switch (template) {
    case 'revenue_summary':
    case 'new_customers':
      return PeriodParams;
    case 'new_orders':
      return mode === 'alert' ? NewOrdersAlertParams : PeriodParams;
    case 'low_stock':
      return LowStockParams;
    case 'unanswered_conversations':
      return UnansweredParams;
  }
}

const Params = z.record(z.string(), z.unknown());

const draftShape = {
  name: z.string().trim().min(1).max(80),
  businessId: z.uuid(),
  template: ScheduleTemplate,
  mode: ScheduleMode,
  params: Params.default({}),
  cadence: Cadence,
  channels: z.array(ScheduleChannel).min(1).max(3),
  commentary: z.boolean().default(false),
};

/** The draft fields without the per-template params check (the assistant tool's input shape). */
export const ScheduleDraftFields = z.object(draftShape);

/** A schedule as the owner (or the assistant) drafts it. */
export const ScheduleDraft = ScheduleDraftFields.superRefine((d, ctx) => {
  const params = scheduleParamsSchema(d.template, d.mode).safeParse(d.params);
  if (!params.success) {
    for (const issue of params.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['params', ...issue.path], message: issue.message });
    }
  }
});
export type ScheduleDraft = z.infer<typeof ScheduleDraft>;

/** The edit fields without the "something changes" check (the assistant tool's input shape). */
export const SchedulePatchFields = z.object({
  name: draftShape.name.optional(),
  businessId: draftShape.businessId.optional(),
  template: ScheduleTemplate.optional(),
  mode: ScheduleMode.optional(),
  params: Params.optional(),
  cadence: Cadence.optional(),
  channels: draftShape.channels.optional(),
  commentary: z.boolean().optional(),
  expectedUpdatedAt: z.iso.datetime().optional(),
});

/** An edit: any draft field; `expectedUpdatedAt` refuses a stale edit (409). */
export const SchedulePatch = SchedulePatchFields.refine(
  (p) => Object.keys(p).some((k) => k !== 'expectedUpdatedAt'),
  {
    message: 'nothing to change',
  },
);
export type SchedulePatch = z.infer<typeof SchedulePatch>;

export const ScheduleStatus = z.enum(['active', 'paused']);
export const SchedulePausedReason = z.enum([
  'owner',
  'failures',
  'business_unavailable',
  'owner_not_active',
]);
export const ScheduleRunStatus = z.enum(['running', 'done', 'failed', 'blocked', 'skipped']);
export const ScheduleDeliveryStatus = z.enum(['queued', 'sending', 'sent', 'failed', 'skipped']);

/** Per channel, how the run's notification was delivered (in-app is always delivered). */
export const ScheduleDelivery = z.object({
  email: ScheduleDeliveryStatus.optional(),
  push: ScheduleDeliveryStatus.optional(),
});

export const ScheduleDto = z.object({
  id: z.uuid(),
  name: z.string(),
  businessId: z.uuid(),
  template: ScheduleTemplate,
  mode: ScheduleMode,
  params: Params,
  /** The cadence itself: the web renders it in words. */
  cadence: Cadence,
  channels: z.array(ScheduleChannel),
  commentary: z.boolean(),
  status: ScheduleStatus,
  pausedReason: SchedulePausedReason.nullable(),
  nextRunAt: z.iso.datetime().nullable(),
  lastRun: z
    .object({
      status: ScheduleRunStatus,
      finishedAt: z.iso.datetime().nullable(),
      delivery: ScheduleDelivery,
    })
    .nullable(),
  createdBy: z.enum(['owner', 'assistant', 'suggestion']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ScheduleDto = z.infer<typeof ScheduleDto>;

export const ScheduleList = z.object({
  items: z.array(ScheduleDto),
  limit: z.number().int(),
  /** Schedules plus pending schedule proposals. */
  used: z.number().int(),
  emailAvailable: z.boolean(),
});
export type ScheduleList = z.infer<typeof ScheduleList>;

export const ScheduleRunDto = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  trigger: z.enum(['cadence', 'manual']),
  scheduledFor: z.iso.datetime(),
  status: ScheduleRunStatus,
  errorCode: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  threadId: z.uuid().nullable(),
  delivery: ScheduleDelivery,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type ScheduleRunDto = z.infer<typeof ScheduleRunDto>;

export const ScheduleRunList = z.object({ items: z.array(ScheduleRunDto) });
export type ScheduleRunList = z.infer<typeof ScheduleRunList>;

export const ScheduleRunListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ScheduleRunListQuery = z.infer<typeof ScheduleRunListQuery>;

/** A draft's report computed now: no delivery, no commentary. */
export const SchedulePreview = z.object({
  title: z.string(),
  body: z.string(),
  /** The next three run times. */
  nextRuns: z.array(z.iso.datetime()),
});
export type SchedulePreview = z.infer<typeof SchedulePreview>;

/**
 * What accepting a 1c `schedule` suggestion answers (S3-R12): the validated draft the web opens
 * in the schedule editor; saving it there is the owner's approval. An invalid payload answers
 * 422 `invalid_schedule_draft` and the suggestion is dismissed.
 */
export const ScheduleSuggestionAccept = z.object({ scheduleDraft: ScheduleDraft.optional() });
export type ScheduleSuggestionAccept = z.infer<typeof ScheduleSuggestionAccept>;
