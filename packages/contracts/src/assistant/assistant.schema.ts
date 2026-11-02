import { z } from 'zod';

// ─── Page context and UI actions ──────────────────────────────────────────────

/** A form on screen the assistant may fill (`fill_form`); `empty` marks fields with no value yet. */
export const AssistantPageForm = z.object({
  id: z.string().max(60),
  fields: z
    .array(
      z.object({
        name: z.string().max(60),
        label: z.string().max(120),
        type: z.enum(['text', 'textarea', 'number', 'select']),
        options: z.array(z.string().max(80)).max(30).optional(),
        empty: z.boolean(),
      }),
    )
    .max(30),
});
export type AssistantPageForm = z.infer<typeof AssistantPageForm>;

/** What the owner is looking at when they ask; sent by the web app with each message. */
export const AssistantPageContext = z.object({
  route: z.string().max(200),
  title: z.string().max(120).optional(),
  /** Ids of the entities on screen, e.g. `{ botId, productId }`. */
  entity: z.record(z.string(), z.string().max(100)).optional(),
  emptyFields: z.array(z.string().max(60)).max(30).optional(),
  errors: z.array(z.string().max(200)).max(10).optional(),
  /** `data-assistant-target` ids present on screen. */
  targets: z.array(z.string().max(60)).max(40).optional(),
  /** Forms on screen the assistant may fill; it never submits them. */
  forms: z.array(AssistantPageForm).max(5).optional(),
});
export type AssistantPageContext = z.infer<typeof AssistantPageContext>;

/** How a chart's values are formatted: money (VND), a count, a percentage or a plain number. */
export const AssistantChartUnit = z.enum(['vnd', 'count', 'percent', 'number']);
export type AssistantChartUnit = z.infer<typeof AssistantChartUnit>;

/** Most points a pie chart shows; bar and line charts take up to the 60-row cap. */
export const ASSISTANT_PIE_MAX_ROWS = 12;

/**
 * A small chart the bubble renders inside an answer. It is built by our code from the rows of a
 * read-only query, never from numbers the model types. `x` names the category column, `series`
 * the numeric columns, and `rows` holds only those columns. A pie has one series and ≤ 12 rows.
 */
export const AssistantChart = z
  .object({
    kind: z.enum(['bar', 'line', 'pie']),
    title: z.string().max(120),
    x: z.object({ key: z.string().max(63), label: z.string().max(60) }),
    series: z
      .array(z.object({ key: z.string().max(63), label: z.string().max(60) }))
      .min(1)
      .max(4),
    unit: AssistantChartUnit,
    rows: z
      .array(z.record(z.string().max(63), z.union([z.string().max(80), z.number(), z.null()])))
      .max(60),
  })
  .superRefine((chart, ctx) => {
    if (chart.kind !== 'pie') return;
    if (chart.series.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['series'], message: 'A pie chart has one series' });
    }
    if (chart.rows.length > ASSISTANT_PIE_MAX_ROWS) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message: `A pie chart has at most ${ASSISTANT_PIE_MAX_ROWS} rows`,
      });
    }
  });
export type AssistantChart = z.infer<typeof AssistantChart>;

/** Something the web app does for the owner; navigation never leaves the app. */
export const AssistantUiAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), to: z.string().startsWith('/app').max(200) }),
  z.object({ type: z.literal('spotlight'), target: z.string().max(60), hint: z.string().max(200) }),
  /** Fill fields of an on-screen form; the owner reviews and submits it themselves. */
  z.object({
    type: z.literal('fill_form'),
    formId: z.string().max(60),
    values: z
      .record(z.string().max(60), z.union([z.string().max(4000), z.number()]))
      .refine((v) => Object.keys(v).length <= 30, { message: 'At most 30 fields' }),
  }),
  /** A chart shown inside the answer; the web app renders it and never "runs" it. */
  z.object({ type: z.literal('chart'), chart: AssistantChart }),
]);
export type AssistantUiAction = z.infer<typeof AssistantUiAction>;

// ─── Threads ──────────────────────────────────────────────────────────────────

export const AssistantThreadDto = z.object({
  id: z.uuid(),
  title: z.string(),
  pinned: z.boolean(),
  archived: z.boolean(),
  businessId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type AssistantThreadDto = z.infer<typeof AssistantThreadDto>;

export const AssistantThreadList = z.object({ data: z.array(AssistantThreadDto) });
export type AssistantThreadList = z.infer<typeof AssistantThreadList>;

export const AssistantThreadListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  archived: z.enum(['true', 'false']).optional(),
});
export type AssistantThreadListQuery = z.infer<typeof AssistantThreadListQuery>;

export const CreateAssistantThreadRequest = z.object({
  title: z.string().trim().max(120).optional(),
});
export type CreateAssistantThreadRequest = z.infer<typeof CreateAssistantThreadRequest>;

export const UpdateAssistantThreadRequest = z
  .object({ title: z.string().trim().min(1).max(120), pinned: z.boolean(), archived: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty update');
export type UpdateAssistantThreadRequest = z.infer<typeof UpdateAssistantThreadRequest>;

// ─── Messages ─────────────────────────────────────────────────────────────────

/** A visible message. Tool rows stay in the backend and never appear here. */
export const AssistantMessageDto = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  role: z.enum(['user', 'assistant', 'event']),
  content: z.string(),
  uiActions: z.array(AssistantUiAction),
  runId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type AssistantMessageDto = z.infer<typeof AssistantMessageDto>;

export const AssistantMessageList = z.object({ data: z.array(AssistantMessageDto) });
export type AssistantMessageList = z.infer<typeof AssistantMessageList>;

/** `turnId` is client-generated so a retried send does not run twice. */
export const SendAssistantMessageRequest = z.object({
  turnId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  pageContext: AssistantPageContext.optional(),
});
export type SendAssistantMessageRequest = z.infer<typeof SendAssistantMessageRequest>;

// ─── Runs ─────────────────────────────────────────────────────────────────────

export const AssistantStepDto = z.object({
  idx: z.number().int(),
  kind: z.string(),
  toolName: z.string().nullable(),
  ok: z.boolean().nullable(),
  ms: z.number().int().nullable(),
  errorCode: z.string().nullable(),
});
export type AssistantStepDto = z.infer<typeof AssistantStepDto>;

export const AssistantRunDto = z.object({
  id: z.uuid(),
  status: z.enum(['running', 'done', 'failed']),
  outcome: z.string().nullable(),
  rounds: z.number().int(),
  latencyMs: z.number().int(),
  steps: z.array(AssistantStepDto),
});
export type AssistantRunDto = z.infer<typeof AssistantRunDto>;

export const SendAssistantMessageResponse = z.object({
  messages: z.array(AssistantMessageDto),
  run: AssistantRunDto,
});
export type SendAssistantMessageResponse = z.infer<typeof SendAssistantMessageResponse>;

// ─── Proposals ────────────────────────────────────────────────────────────────

export const AssistantProposalStatus = z.enum([
  'pending',
  'executing',
  'done',
  'failed',
  'rejected',
  'expired',
]);
export type AssistantProposalStatus = z.infer<typeof AssistantProposalStatus>;

/** A write the assistant prepared; it runs only when the owner approves it. */
export const AssistantProposalDto = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  businessId: z.uuid(),
  /** `METHOD /path` of the target route, e.g. `PATCH /products/{productId}`. */
  routeKey: z.string(),
  summary: z.string(),
  /** What the card shows (a diff or the new values); its shape depends on the route. */
  preview: z.unknown(),
  status: AssistantProposalStatus,
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type AssistantProposalDto = z.infer<typeof AssistantProposalDto>;

export const AssistantProposalList = z.object({ items: z.array(AssistantProposalDto) });
export type AssistantProposalList = z.infer<typeof AssistantProposalList>;

// ─── Memory ───────────────────────────────────────────────────────────────────

export const AssistantMemoryEntryDto = z.object({
  /** Opaque id, used by `DELETE /assistant/memory/{store}/entries/{entryId}`. */
  id: z.string(),
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type AssistantMemoryEntryDto = z.infer<typeof AssistantMemoryEntryDto>;

/** One memory store (`owner_profile`, `notes`, `business:<id>`) with its char limit and use. */
export const AssistantMemoryStoreDto = z.object({
  store: z.string(),
  label: z.string(),
  limit: z.number().int(),
  used: z.number().int(),
  entries: z.array(AssistantMemoryEntryDto),
});
export type AssistantMemoryStoreDto = z.infer<typeof AssistantMemoryStoreDto>;

export const AssistantMemoryDto = z.object({ stores: z.array(AssistantMemoryStoreDto) });
export type AssistantMemoryDto = z.infer<typeof AssistantMemoryDto>;
