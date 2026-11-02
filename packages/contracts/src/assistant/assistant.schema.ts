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
  /** The owner's 👍 (1) or 👎 (-1) on an assistant answer; null when none. */
  feedback: z.union([z.literal(1), z.literal(-1)]).nullable(),
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

// ─── Skills (1c) ──────────────────────────────────────────────────────────────

/** Same rule as a SKILL.md name: lowercase letters, digits and dashes. */
export const AssistantSkillName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes');

/** One line of the prompt's skill index: a line break would forge index entries. */
export const AssistantSkillDescription = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\r\n]*$/, 'invalid_skill: description must be one line');

export const AssistantSkillProvenance = z.enum(['platform', 'owner', 'learned', 'shadow']);
export type AssistantSkillProvenance = z.infer<typeof AssistantSkillProvenance>;

export const AssistantSkillState = z.enum(['pending_approval', 'active', 'stale', 'archived']);
export type AssistantSkillState = z.infer<typeof AssistantSkillState>;

/**
 * One skill on the owner's skills page. `ref` is the row id, or `platform:<name>` for a platform
 * skill (a file: always `active`, no counters, `shadowed` when the owner's shadow replaces it).
 */
export const AssistantSkillSummaryDto = z.object({
  ref: z.string(),
  id: z.uuid().nullable(),
  name: z.string(),
  description: z.string(),
  provenance: AssistantSkillProvenance,
  /** The platform skill a `shadow` replaces; null otherwise. */
  shadowOf: z.string().nullable(),
  /** Platform skills only: the owner's active shadow replaces it. */
  shadowed: z.boolean(),
  state: AssistantSkillState,
  pinned: z.boolean(),
  useCount: z.number().int(),
  viewCount: z.number().int(),
  patchCount: z.number().int(),
  lastUsedAt: z.iso.datetime().nullable(),
  lastPatchedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});
export type AssistantSkillSummaryDto = z.infer<typeof AssistantSkillSummaryDto>;

/** Platform skills first (by name), then the owner's rows (by name), every state. */
export const AssistantSkillList = z.object({ items: z.array(AssistantSkillSummaryDto) });
export type AssistantSkillList = z.infer<typeof AssistantSkillList>;

export const AssistantSkillDto = AssistantSkillSummaryDto.extend({
  body: z.string(),
  toolsets: z.array(z.string()),
});
export type AssistantSkillDto = z.infer<typeof AssistantSkillDto>;

/** The owner writes a procedure of their own; it is active at once. */
export const CreateAssistantSkillRequest = z.object({
  name: AssistantSkillName,
  description: AssistantSkillDescription,
  body: z.string().trim().min(1).max(8000),
});
export type CreateAssistantSkillRequest = z.infer<typeof CreateAssistantSkillRequest>;

export const UpdateAssistantSkillRequest = z
  .object({
    description: AssistantSkillDescription,
    body: z.string().trim().min(1).max(8000),
    pinned: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty update');
export type UpdateAssistantSkillRequest = z.infer<typeof UpdateAssistantSkillRequest>;

/**
 * Approve or reject a pending learned skill: `expectedUpdatedAt` is the skill's `updatedAt` as
 * the owner saw it; a skill changed since (e.g. the review patched the draft) answers 409
 * `skill_changed`, so the owner never approves a body they did not see.
 */
export const AssistantSkillDecisionRequest = z.object({ expectedUpdatedAt: z.iso.datetime() });
export type AssistantSkillDecisionRequest = z.infer<typeof AssistantSkillDecisionRequest>;

/** What the ledger keeps of a skill before and after a change. */
export const AssistantSkillSnapshotDto = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  state: AssistantSkillState,
});
export type AssistantSkillSnapshotDto = z.infer<typeof AssistantSkillSnapshotDto>;

export const AssistantSkillEventDto = z.object({
  id: z.uuid(),
  skillId: z.uuid(),
  actor: z.enum(['owner', 'assistant', 'review', 'curator']),
  action: z.enum(['create', 'patch', 'archive', 'restore', 'approve', 'reject', 'undo']),
  before: AssistantSkillSnapshotDto.nullable(),
  after: AssistantSkillSnapshotDto.nullable(),
  undoneAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AssistantSkillEventDto = z.infer<typeof AssistantSkillEventDto>;

/** Newest first. */
export const AssistantSkillEventList = z.object({ items: z.array(AssistantSkillEventDto) });
export type AssistantSkillEventList = z.infer<typeof AssistantSkillEventList>;

// ─── Learning feed (1c, ruling 1c-R2) ─────────────────────────────────────────

/** `days` back from now (default 7). */
export const AssistantLearningQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});
export type AssistantLearningQuery = z.infer<typeof AssistantLearningQuery>;

/**
 * A skill change the background review or the curator made. Undo:
 * `POST /assistant/skill-events/{skillEventId}/undo`.
 */
export const AssistantLearnedSkillDto = z.object({
  kind: z.literal('skill'),
  actor: z.enum(['review', 'curator']),
  action: AssistantSkillEventDto.shape.action,
  skillEventId: z.uuid(),
  skillId: z.uuid(),
  /** The skill's name and description after the change (before it, for a change with no after). */
  name: z.string(),
  description: z.string(),
  /** The skill's state after the change. */
  state: AssistantSkillState.nullable(),
  undone: z.boolean(),
  at: z.iso.datetime(),
});
export type AssistantLearnedSkillDto = z.infer<typeof AssistantLearnedSkillDto>;

/**
 * A memory entry the background review saved or rewrote. Undo:
 * `POST /assistant/memory/{store}/entries/{entryId}/undo` (a rewritten entry gets its previous
 * text back; a saved one is forgotten).
 */
export const AssistantLearnedMemoryDto = z.object({
  kind: z.literal('memory'),
  actor: z.literal('review'),
  store: z.string(),
  entryId: z.string(),
  text: z.string(),
  /** The text the review replaced (undo restores it); null when the review added the entry. */
  previousText: z.string().nullable(),
  at: z.iso.datetime(),
});
export type AssistantLearnedMemoryDto = z.infer<typeof AssistantLearnedMemoryDto>;

export const AssistantLearningItemDto = z.discriminatedUnion('kind', [
  AssistantLearnedSkillDto,
  AssistantLearnedMemoryDto,
]);
export type AssistantLearningItemDto = z.infer<typeof AssistantLearningItemDto>;

/** "Trợ lý vừa học": newest first, at most 20. */
export const AssistantLearningFeed = z.object({ items: z.array(AssistantLearningItemDto) });
export type AssistantLearningFeed = z.infer<typeof AssistantLearningFeed>;

// ─── Owner settings and toolsets (1c) ─────────────────────────────────────────

/** The groups of tools the assistant has; the owner may turn some off (spec §6). */
export const AssistantToolsetId = z.enum(['core', 'ui', 'memory', 'skills', 'routes', 'sql']);
export type AssistantToolsetId = z.infer<typeof AssistantToolsetId>;

/** Toolsets the owner cannot turn off. */
export const ASSISTANT_LOCKED_TOOLSETS: readonly AssistantToolsetId[] = ['core', 'ui'];

export const AssistantToolsetDto = z.object({
  id: AssistantToolsetId,
  /** i18n key of the toolset's name (the web's `assistant` namespace). */
  labelKey: z.string(),
  toolCount: z.number().int(),
  /** Tool calls of the owner's chat turns in the last 30 days. */
  uses30d: z.number().int(),
  /** `core` and `ui` cannot be turned off. */
  locked: z.boolean(),
});
export type AssistantToolsetDto = z.infer<typeof AssistantToolsetDto>;

export const AssistantSettingsDto = z.object({
  reviewEnabled: z.boolean(),
  disabledToolsets: z.array(AssistantToolsetId),
  toolsets: z.array(AssistantToolsetDto),
});
export type AssistantSettingsDto = z.infer<typeof AssistantSettingsDto>;

export const UpdateAssistantSettingsRequest = z
  .object({
    reviewEnabled: z.boolean(),
    disabledToolsets: z
      .array(AssistantToolsetId)
      .max(AssistantToolsetId.options.length)
      .refine((ids) => !ids.some((id) => ASSISTANT_LOCKED_TOOLSETS.includes(id)), {
        message: 'core and ui cannot be disabled',
      }),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty update');
export type UpdateAssistantSettingsRequest = z.infer<typeof UpdateAssistantSettingsRequest>;

// ─── Feedback (1c) ────────────────────────────────────────────────────────────

/** 👍 = 1, 👎 = -1, 0 clears it. */
export const AssistantMessageFeedbackRequest = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});
export type AssistantMessageFeedbackRequest = z.infer<typeof AssistantMessageFeedbackRequest>;

// ─── Suggestions (1c, ruling 1c-R3) ───────────────────────────────────────────

export const AssistantSuggestionKind = z.enum(['schedule', 'skill', 'setup']);
export type AssistantSuggestionKind = z.infer<typeof AssistantSuggestionKind>;

/**
 * A card the background review saved for the owner. Payload by kind: `skill` →
 * `{ name, description, body }`; `setup` → `{ path }` (an `/app` page); `schedule` → free-form
 * details (accepting only records the choice until schedules exist).
 */
export const AssistantSuggestionDto = z.object({
  id: z.uuid(),
  kind: AssistantSuggestionKind,
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type AssistantSuggestionDto = z.infer<typeof AssistantSuggestionDto>;

/** Pending suggestions, newest first. */
export const AssistantSuggestionList = z.object({ items: z.array(AssistantSuggestionDto) });
export type AssistantSuggestionList = z.infer<typeof AssistantSuggestionList>;

/**
 * An accepted suggestion: `skill` carries the learned skill it drafted (`pending_approval`: the
 * owner still approves it on its card); `path` is the in-app page
 * a `setup` suggestion leads to (the web navigates there), null otherwise.
 */
export const AcceptAssistantSuggestionResponse = z.object({
  suggestion: AssistantSuggestionDto,
  skill: AssistantSkillDto.nullable(),
  path: z.string().startsWith('/app').max(200).nullable(),
});
export type AcceptAssistantSuggestionResponse = z.infer<typeof AcceptAssistantSuggestionResponse>;
