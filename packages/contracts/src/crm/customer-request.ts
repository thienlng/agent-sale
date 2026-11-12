import { z } from 'zod';

import type { Industry } from '../bot/industry.js';

/**
 * Customer requests recorded by the bot (ADR-020, generalised by ESV spec §4.1): a demo, a trial,
 * a placement test, an appointment or a consultation. A request is a customer history entry, a
 * signed note and a status move on the CRM customer; there is no requests table. Each request
 * industry configures the one built-in tool `record_request` here, as data.
 */

export const CustomerRequestKind = z.enum([
  'demo',
  'trial',
  'consultation',
  'placement_test',
  'appointment',
]);
export type CustomerRequestKind = z.infer<typeof CustomerRequestKind>;

/** Industries whose bots convert through a recorded request instead of an order. */
export const REQUEST_INDUSTRIES = [
  'saas',
  'education',
  'spa',
] as const satisfies readonly Industry[];
export type RequestIndustry = (typeof REQUEST_INDUSTRIES)[number];

export function isRequestIndustry(industry: string): industry is RequestIndustry {
  return (REQUEST_INDUSTRIES as readonly string[]).includes(industry);
}

/** The saas kinds (ADR-020), kept as a literal tuple. */
export const SAAS_REQUEST_KINDS = [
  'demo',
  'trial',
  'consultation',
] as const satisfies readonly CustomerRequestKind[];

/** History types of a recorded request; `updated` = same kind again within 24 h. */
export const REQUEST_HISTORY_TYPES = [
  'contact.request_recorded',
  'contact.request_updated',
] as const;

export type RequestFieldKey =
  | 'name'
  | 'phone'
  | 'email'
  | 'company'
  | 'teamSize'
  | 'need'
  | 'planInterest'
  | 'studentName'
  | 'studentAge'
  | 'studentLevel'
  | 'course'
  | 'goal'
  | 'service'
  | 'branch'
  | 'preferredDate'
  | 'preferredTime'
  | 'guests'
  | 'note';

/** A requirement group: a key, or "at least one of" these keys. */
export type RequestFieldRule = RequestFieldKey | readonly RequestFieldKey[];

/** How a recorded request moves the customer's status (a built-in status key). */
export type RequestStatusMove =
  /** ADR-020 behaviour (saas): never moves a customer backwards. */
  | { key: string; move: 'forward_only' }
  /**
   * Moves unless the current key is in `keep` (a confirmed status) or already the target. An update
   * that changes the slot (day, time, branch, service or course) of a customer at a `reopen` status
   * (a confirmed appointment) moves back to `key`: staff must confirm the new slot (MS-10).
   */
  | { key: string; move: 'unless'; keep: readonly string[]; reopen?: readonly string[] };

export interface RequestFieldDef {
  key: RequestFieldKey;
  /** Maximum characters of the value. */
  max: number;
  /** Vietnamese label of the note line (business content, read by staff). */
  label: string;
  /** English description for the tool schema. */
  describe: string;
}

export interface RequestProfile {
  toolName: 'record_request';
  /** The name the call carries in the reply's `actions` list. */
  actionName: string;
  /** English tool description. */
  description: string;
  kinds: readonly CustomerRequestKind[];
  /** Vietnamese, the first line of the note. */
  kindLabels: Partial<Record<CustomerRequestKind, string>>;
  /**
   * The fields in note order. `phone` identifies the customer and never gets a note line; `email`
   * gets one but is kept out of the history entry's details.
   */
  fields: readonly RequestFieldDef[];
  required: Partial<Record<CustomerRequestKind, readonly RequestFieldRule[]>>;
  /** Asked before calling; the result lists the ones still empty as `missing`. */
  recommended: Partial<Record<CustomerRequestKind, readonly RequestFieldRule[]>>;
  status: Partial<Record<CustomerRequestKind, RequestStatusMove>>;
}

const NAME: RequestFieldDef = {
  key: 'name',
  max: 120,
  label: 'Tên',
  describe: "The customer's name as they wrote it",
};
const PHONE: RequestFieldDef = {
  key: 'phone',
  max: 40,
  label: 'Số điện thoại',
  describe: 'Phone number the customer wrote',
};
const EMAIL: RequestFieldDef = {
  key: 'email',
  max: 200,
  label: 'Email',
  describe: 'Email the customer wrote',
};
const PREFERRED_DATE: RequestFieldDef = {
  key: 'preferredDate',
  max: 10,
  label: 'Ngày mong muốn',
  describe: 'The day the customer named, as YYYY-MM-DD; leave empty when they named no day',
};
const NOTE: RequestFieldDef = {
  key: 'note',
  max: 1000,
  label: 'Ghi chú',
  describe: 'Anything else the customer asked staff to know, in a short sentence',
};

const SAAS_PROFILE: RequestProfile = {
  toolName: 'record_request',
  actionName: 'Record a demo, free trial or consultation request',
  description:
    'Records that the customer wants a product demo, a free trial account or a consultation, so staff contact them. Call it once the customer asked for one and gave their name and a phone number; call it again when they add or correct details. Returns recorded true when the request is saved on the customer. Staff schedule and confirm: never promise a time or an account yourself.',
  kinds: SAAS_REQUEST_KINDS,
  kindLabels: { demo: 'Xin demo', trial: 'Xin dùng thử', consultation: 'Xin tư vấn' },
  // Note order of the ADR-020 `leadNote`: Tên, Công ty, Quy mô, Nhu cầu, Thời gian mong muốn,
  // Gói quan tâm, Email. `phone` has no note line.
  fields: [
    NAME,
    PHONE,
    { key: 'company', max: 200, label: 'Công ty', describe: 'Company or shop name' },
    {
      key: 'teamSize',
      max: 60,
      label: 'Quy mô',
      describe: 'How many people will use it, as the customer said',
    },
    {
      key: 'need',
      max: 2000,
      label: 'Nhu cầu',
      describe: 'What they want to solve, in a short sentence',
    },
    {
      key: 'preferredTime',
      max: 200,
      label: 'Thời gian mong muốn',
      describe: 'When they would like to be contacted or see the demo',
    },
    {
      key: 'planInterest',
      max: 200,
      label: 'Gói quan tâm',
      describe: 'The plan they asked about',
    },
    EMAIL,
  ],
  required: {
    demo: ['name', 'phone'],
    trial: ['name', 'phone'],
    consultation: ['name', 'phone'],
  },
  recommended: {},
  status: {
    demo: { key: 'requested', move: 'forward_only' },
    trial: { key: 'requested', move: 'forward_only' },
    consultation: { key: 'requested', move: 'forward_only' },
  },
};

const EDUCATION_TESTED = ['test_scheduled', 'tested', 'enrolled'] as const;

const EDUCATION_PROFILE: RequestProfile = {
  toolName: 'record_request',
  actionName: 'Record a placement test, trial class or consultation request',
  description:
    "Records that the customer wants a placement test, a trial class or a consultation on a learning path, so staff contact them. Call it when the customer clearly asks to register for a test or a trial class, or to be advised. Ask in one message for what is still missing: the name and a phone number (needed to record it), plus the course or goal, the student's age or level, the preferred branch or online, and a preferred time; call it once the name and phone are known. Call it again when the customer adds or corrects details. Returns recorded true when the request is saved on the customer; `missing` lists details still worth asking for once. Staff confirm: never promise a slot, a teacher or a result.",
  kinds: ['placement_test', 'trial', 'consultation'],
  kindLabels: {
    placement_test: 'Đăng ký kiểm tra trình độ',
    trial: 'Đăng ký học thử',
    consultation: 'Tư vấn lộ trình',
  },
  fields: [
    {
      ...NAME,
      describe: 'The name of the person writing (a parent or the student), as they wrote it',
    },
    PHONE,
    EMAIL,
    {
      key: 'studentName',
      max: 120,
      label: 'Học viên',
      describe:
        "The student's name when it is not the person writing (a parent registering a child)",
    },
    {
      key: 'studentAge',
      max: 60,
      label: 'Tuổi học viên',
      describe: "The student's age or school grade, as the customer said",
    },
    {
      key: 'studentLevel',
      max: 120,
      label: 'Trình độ hiện tại',
      describe: "The student's current level or score, as the customer said",
    },
    {
      key: 'course',
      max: 200,
      label: 'Khoá học quan tâm',
      describe:
        'The course or programme of interest: its name exactly as in the catalog (the product name). Never put it in goal',
    },
    {
      key: 'goal',
      max: 500,
      label: 'Mục tiêu',
      describe:
        'What the student wants to reach, as the customer said ("IELTS 6.5", "tự tin giao tiếp"); the course name goes in course, not here',
    },
    {
      key: 'branch',
      max: 200,
      label: 'Cơ sở',
      describe: 'The preferred branch, or "online"',
    },
    PREFERRED_DATE,
    {
      key: 'preferredTime',
      max: 200,
      label: 'Thời gian mong muốn',
      describe: 'When the customer prefers, in their words ("tối thứ 3-5", "cuối tuần")',
    },
    NOTE,
  ],
  required: {
    placement_test: ['name', 'phone'],
    trial: ['name', 'phone'],
    consultation: ['name', 'phone'],
  },
  recommended: {
    placement_test: [
      ['course', 'goal'],
      ['studentAge', 'studentLevel'],
      'branch',
      ['preferredTime', 'preferredDate'],
    ],
    trial: [
      ['course', 'goal'],
      ['studentAge', 'studentLevel'],
      'branch',
      ['preferredTime', 'preferredDate'],
    ],
    consultation: ['goal'],
  },
  status: {
    placement_test: {
      key: 'test_requested',
      move: 'unless',
      keep: EDUCATION_TESTED,
      reopen: ['test_scheduled'],
    },
    trial: {
      key: 'test_requested',
      move: 'unless',
      keep: EDUCATION_TESTED,
      reopen: ['test_scheduled'],
    },
    consultation: {
      key: 'consulting',
      move: 'unless',
      keep: ['test_requested', ...EDUCATION_TESTED],
    },
  },
};

const SPA_PROFILE: RequestProfile = {
  toolName: 'record_request',
  actionName: 'Record an appointment or consultation request',
  description:
    'Records that the customer wants to book an appointment or to be advised, so staff confirm it. Call it when the customer clearly asks to book or to be advised. For an appointment, first collect the service, the branch and the preferred day or time window, then the name and a phone number; call it once those are known. preferredDate is YYYY-MM-DD only when the customer named a day; otherwise put their words in preferredTime. Call it again when the customer adds or corrects details. Returns recorded true when the request is saved on the customer; `missing` lists details still worth asking for once. Staff confirm: never promise a slot, a therapist or a result.',
  kinds: ['appointment', 'consultation'],
  kindLabels: { appointment: 'Đặt lịch', consultation: 'Xin tư vấn' },
  fields: [
    NAME,
    PHONE,
    {
      key: 'service',
      max: 200,
      label: 'Dịch vụ',
      describe:
        'The service or treatment the customer wants: its name exactly as in the catalog (the product name)',
    },
    {
      key: 'branch',
      max: 200,
      label: 'Cơ sở',
      describe: 'The preferred branch',
    },
    PREFERRED_DATE,
    {
      key: 'preferredTime',
      max: 200,
      label: 'Giờ mong muốn',
      describe:
        'The time or time window the customer wants, in their words ("2h chiều", "sau 18h")',
    },
    {
      key: 'guests',
      max: 60,
      label: 'Số khách',
      describe: 'How many people come, when more than one',
    },
    NOTE,
  ],
  required: {
    appointment: ['name', 'phone', 'service', ['preferredDate', 'preferredTime']],
    consultation: ['name', 'phone'],
  },
  recommended: {
    appointment: ['branch', 'preferredTime'],
  },
  status: {
    appointment: {
      key: 'booking_requested',
      move: 'unless',
      keep: ['booked'],
      reopen: ['booked'],
    },
    consultation: {
      key: 'consulting',
      move: 'unless',
      keep: ['booking_requested', 'booked', 'visited'],
    },
  },
};

export const REQUEST_PROFILES: Readonly<Record<RequestIndustry, RequestProfile>> = {
  saas: SAAS_PROFILE,
  education: EDUCATION_PROFILE,
  spa: SPA_PROFILE,
};

/** The industry's request profile; null for an industry that converts through orders. */
export function requestProfileFor(industry: string): RequestProfile | null {
  return isRequestIndustry(industry) ? REQUEST_PROFILES[industry] : null;
}

const RequestEmail = z.string().trim().toLowerCase().max(200).pipe(z.email());

const isCalendarDate = (v: string): boolean => {
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Empty, or a real local calendar date (YYYY-MM-DD). Past dates are the writer's check. */
const RequestDate = z
  .string()
  .trim()
  .max(10)
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'must be YYYY-MM-DD')
  .refine((v) => v === '' || isCalendarDate(v), 'must be a real calendar date')
  .default('');

function fieldSchema(def: RequestFieldDef): z.ZodType {
  if (def.key === 'email') return RequestEmail.nullable().default(null);
  if (def.key === 'preferredDate') return RequestDate;
  // `name` and `phone` default to '' too: the required groups name them (`missing:name`).
  return z.string().trim().max(def.max).default('');
}

const detailsCache = new Map<RequestIndustry, z.ZodObject<z.ZodRawShape>>();

/**
 * Zod object of the industry's fields: free text on purpose ("10-20 người", "chiều thứ 5"),
 * `name` and `phone` empty by default (the profile's required groups report them as
 * `missing:<field>`), `email` an address or null, `preferredDate` empty or YYYY-MM-DD.
 * Unknown keys are stripped: the model may send extra ones.
 */
export function requestDetailsSchema(industry: RequestIndustry): z.ZodObject<z.ZodRawShape> {
  let schema = detailsCache.get(industry);
  if (!schema) {
    schema = z.object(
      Object.fromEntries(REQUEST_PROFILES[industry].fields.map((f) => [f.key, fieldSchema(f)])),
    );
    detailsCache.set(industry, schema);
  }
  return schema;
}

const filled = (v: unknown): boolean =>
  typeof v === 'string' ? v.trim() !== '' : v !== null && v !== undefined;

/** Field keys of `rules` not satisfied by `details` (a group counts as one entry: its first key). */
export function unmetRules(
  rules: readonly RequestFieldRule[] | undefined,
  details: Record<string, unknown>,
): RequestFieldKey[] {
  const unmet: RequestFieldKey[] = [];
  for (const rule of rules ?? []) {
    const keys: readonly RequestFieldKey[] = typeof rule === 'string' ? [rule] : rule;
    const [first] = keys;
    if (first !== undefined && !keys.some((k) => filled(details[k]))) unmet.push(first);
  }
  return unmet;
}

// ─── Read models (routes in crm.routes.ts) ────────────────────────────────────

export const CustomerRequestDto = z.object({
  /** The history entry id. */
  id: z.uuid(),
  contactId: z.uuid(),
  kind: CustomerRequestKind,
  /** `contact.request_updated`: the same kind again within 24 h. */
  update: z.boolean(),
  /** The given details, without phone and email. */
  details: z.record(z.string(), z.string()),
  /** "Thứ Bảy 08/11/2026" when `preferredDate` was given. */
  dateLabel: z.string().nullable(),
  recordedAt: z.iso.datetime(),
  /**
   * `GET /contacts/{id}/requests` only: the bot updates folded into this request (its latest
   * state, LM-4) and when the request was first recorded (absent when the first entry is older
   * than the entries read).
   */
  updates: z.number().int().min(0).optional(),
  firstRecordedAt: z.iso.datetime().optional(),
});
export type CustomerRequestDto = z.infer<typeof CustomerRequestDto>;

export const CustomerRequestList = z.object({ data: z.array(CustomerRequestDto) });
export type CustomerRequestList = z.infer<typeof CustomerRequestList>;

export const RequestSummaryDto = z.object({
  statuses: z.array(
    z.object({
      statusId: z.uuid(),
      key: z.string().nullable(),
      name: z.string(),
      color: z.string(),
      count: z.number().int(),
    }),
  ),
  /** Last 30 days, newest first, max 10, only customers still at the kind's target status. */
  open: z.array(
    CustomerRequestDto.extend({
      contactName: z.string().nullable(),
      statusKey: z.string().nullable(),
    }),
  ),
  recorded7d: z.number().int(),
});
export type RequestSummaryDto = z.infer<typeof RequestSummaryDto>;
