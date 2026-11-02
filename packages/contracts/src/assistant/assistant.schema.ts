import { z } from 'zod';

// ─── Page context and UI actions ──────────────────────────────────────────────

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
});
export type AssistantPageContext = z.infer<typeof AssistantPageContext>;

/** Something the web app does for the owner; navigation never leaves the app. */
export const AssistantUiAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), to: z.string().startsWith('/app').max(200) }),
  z.object({ type: z.literal('spotlight'), target: z.string().max(60), hint: z.string().max(200) }),
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
