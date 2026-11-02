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

/** What a proposal does: call a declared route, change a schedule (T-172), import products. */
export const AssistantProposalKind = z.enum(['route', 'schedule', 'product_import']);
export type AssistantProposalKind = z.infer<typeof AssistantProposalKind>;

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
  description: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(8000),
});
export type CreateAssistantSkillRequest = z.infer<typeof CreateAssistantSkillRequest>;

export const UpdateAssistantSkillRequest = z
  .object({
    description: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(8000),
    pinned: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'empty update');
export type UpdateAssistantSkillRequest = z.infer<typeof UpdateAssistantSkillRequest>;

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
