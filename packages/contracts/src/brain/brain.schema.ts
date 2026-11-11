import { z } from 'zod';
import { TaskDto } from '../crm/task.schema.js';

// ─── Business Brain v1: conversation signals (spec 2026-11-11 §3, ADR-030) ──────────────────────

export const SIGNAL_STAGES = [
  'new',
  'exploring',
  'price_asked',
  'ready',
  'won',
  'after_sale',
  'lost',
  'spam',
] as const;
export const SignalStage = z.enum(SIGNAL_STAGES);
export type SignalStage = z.infer<typeof SignalStage>;

export const SIGNAL_MOODS = ['positive', 'neutral', 'negative', 'complaint'] as const;
export const SignalMood = z.enum(SIGNAL_MOODS);
export type SignalMood = z.infer<typeof SignalMood>;

/** What started an evaluation: the conversation went idle, a member asked, or Today's refresh. */
export const SignalTrigger = z.enum(['idle', 'manual', 'refresh']);
export type SignalTrigger = z.infer<typeof SignalTrigger>;

/** The AI's current judgement of one conversation. */
export const ConversationSignalDto = z.object({
  conversationId: z.uuid(),
  contactId: z.uuid().nullable(),
  stage: SignalStage,
  /** What the customer wants, one short line. */
  intent: z.string().max(160).nullable(),
  mood: SignalMood,
  needsHuman: z.boolean(),
  needsHumanReason: z.string().max(200).nullable(),
  followUpAt: z.iso.datetime().nullable(),
  followUpReason: z.string().max(200).nullable(),
  /** Rolling memory note of the conversation (Vietnamese). */
  note: z.string().max(1500).nullable(),
  /** Time of the last message the evaluation covered. */
  evaluatedUntil: z.iso.datetime().nullable(),
  evaluatedAt: z.iso.datetime().nullable(),
  /** A member set the stage by hand: the AI no longer changes it. */
  stageLocked: z.boolean(),
  /** Hidden from Today until a customer message newer than this arrives. */
  dismissedUntilMessageAfter: z.iso.datetime().nullable(),
  /** The customer asked not to be contacted: the care agent never follows up (0074). */
  optOut: z.boolean(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type ConversationSignalDto = z.infer<typeof ConversationSignalDto>;

export const ConversationSignalResponse = z.object({
  signal: ConversationSignalDto.nullable(),
});
export type ConversationSignalResponse = z.infer<typeof ConversationSignalResponse>;

/**
 * Outcome of an evaluation request: `ok` (signals written), `capped` (the daily evaluations are
 * used up), `nothing_new` (no customer message since the last evaluation), `disabled` (AI not
 * available, or a conversation that is never evaluated, such as spam).
 */
export const EvaluateSignalsStatus = z.enum(['ok', 'capped', 'nothing_new', 'disabled']);
export type EvaluateSignalsStatus = z.infer<typeof EvaluateSignalsStatus>;

export const EvaluateSignalsResponse = z.object({
  status: EvaluateSignalsStatus,
  signal: ConversationSignalDto.nullable(),
});
export type EvaluateSignalsResponse = z.infer<typeof EvaluateSignalsResponse>;

/** A member sets the stage by hand (locks it), or unlocks it so the AI may change it again. */
export const UpdateConversationSignalRequest = z
  .object({
    stage: SignalStage.optional(),
    stageLocked: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.stage !== undefined || b.stageLocked !== undefined, {
    message: 'Give a stage or stageLocked',
  })
  // A stage set by hand is always locked; unlocking keeps the stored stage.
  .refine((b) => b.stage === undefined || b.stageLocked !== false, {
    message: 'A stage set by hand is locked: send stageLocked: false alone to unlock',
  });
export type UpdateConversationSignalRequest = z.infer<typeof UpdateConversationSignalRequest>;

export const BRAIN_IDLE_MINUTES = { min: 30, max: 120, default: 45 } as const;

export const BrainSettingsDto = z.object({
  /** `auto`: evaluate when a conversation goes idle; `manual`: only when a member asks. */
  mode: z.enum(['auto', 'manual']),
  idleMinutes: z.number().int().min(BRAIN_IDLE_MINUTES.min).max(BRAIN_IDLE_MINUTES.max),
  /** Morning briefing (owner and admins), at `briefingHour` local time. */
  briefingEnabled: z.boolean(),
  briefingHour: z.number().int().min(0).max(23),
});
export type BrainSettingsDto = z.infer<typeof BrainSettingsDto>;

export const UpdateBrainSettingsRequest = BrainSettingsDto.strict();
export type UpdateBrainSettingsRequest = z.infer<typeof UpdateBrainSettingsRequest>;

/** Evaluations used today (Asia/Ho_Chi_Minh) and the daily limit; `limit: null` = unlimited. */
export const BrainUsageDto = z.object({
  day: z.iso.date(),
  used: z.number().int().min(0),
  limit: z.number().int().min(0).nullable(),
});
export type BrainUsageDto = z.infer<typeof BrainUsageDto>;

/** Entitlement key of the daily evaluation cap (per business). */
export const BRAIN_EVALUATIONS_DAILY = 'brain.evaluations.daily';

// ─── Today (spec 2026-11-11 §5) ───────────────────────────────────────────────────────────────

/** The conversation queues of Today, in display order; a conversation shows in the first match. */
export const TODAY_CONVERSATION_QUEUES = [
  'attention',
  'unanswered',
  'ready',
  'price_silent',
  'follow_up',
] as const;
export const TodayConversationQueueKey = z.enum(TODAY_CONVERSATION_QUEUES);
export type TodayConversationQueueKey = z.infer<typeof TodayConversationQueueKey>;
/** `approval` ("Chờ duyệt"): care messages the AI drafted, waiting for a person (ADR-031). */
export const TODAY_QUEUES = [...TODAY_CONVERSATION_QUEUES, 'approval', 'tasks'] as const;
export type TodayQueueKey = (typeof TODAY_QUEUES)[number];
/** Items per queue at most (the count is the full number). */
export const TODAY_QUEUE_ITEMS_MAX = 20;

/** One customer on Today. */
export const TodayItem = z.object({
  conversationId: z.uuid(),
  contactId: z.uuid().nullable(),
  customerName: z.string(),
  avatarUrl: z.string().nullable(),
  /** Channel provider (`facebook`, `instagram`, `website`…). */
  channel: z.string(),
  /** One line: the intent, why a person is needed, or why to follow up; may be empty. */
  reason: z.string(),
  stage: SignalStage,
  mood: SignalMood,
  /** The time the reason refers to (waiting since, last customer message, follow-up due…). */
  at: z.iso.datetime(),
  assigneeId: z.uuid().nullable(),
  assigneeName: z.string().nullable(),
  stageLocked: z.boolean(),
  /** `after_sale`: listed in "Đến hạn chăm lại" because the after-sales check-in is due. */
  careTemplate: z.literal('after_sale').optional(),
});
export type TodayItem = z.infer<typeof TodayItem>;

export const TodayConversationQueue = z.object({
  key: TodayConversationQueueKey,
  count: z.number().int().min(0),
  items: z.array(TodayItem).max(TODAY_QUEUE_ITEMS_MAX),
});
export type TodayConversationQueue = z.infer<typeof TodayConversationQueue>;

export const TodayTaskQueue = z.object({
  key: z.literal('tasks'),
  count: z.number().int().min(0),
  items: z.array(TaskDto).max(TODAY_QUEUE_ITEMS_MAX),
});
export type TodayTaskQueue = z.infer<typeof TodayTaskQueue>;

/** One draft of the care agent waiting for a person ("Chờ duyệt", spec 2026-11-11 care §5). */
export const TodayApprovalItem = TodayItem.extend({
  careMessageId: z.uuid(),
  template: z.enum(['silent', 'ready', 'after_sale']),
  text: z.string().max(2000),
  /** The draft expires then (the 24-hour window closes); it can no longer be sent. */
  windowClosesAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type TodayApprovalItem = z.infer<typeof TodayApprovalItem>;

export const TodayApprovalQueue = z.object({
  key: z.literal('approval'),
  count: z.number().int().min(0),
  items: z.array(TodayApprovalItem).max(TODAY_QUEUE_ITEMS_MAX),
});
export type TodayApprovalQueue = z.infer<typeof TodayApprovalQueue>;

export const TodayQueue = z.union([TodayConversationQueue, TodayApprovalQueue, TodayTaskQueue]);
export type TodayQueue = z.infer<typeof TodayQueue>;

export const TodayResponse = z.object({
  /** Always the seven queues, in `TODAY_QUEUES` order. */
  queues: z.array(TodayQueue),
  usage: z.object({ used: z.number().int().min(0), limit: z.number().int().min(0).nullable() }),
  mode: z.enum(['auto', 'manual']),
  generatedAt: z.iso.datetime(),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

/** How many items each queue of Today holds (the full numbers). */
export const TodayCounts = z.object({
  attention: z.number().int().min(0),
  unanswered: z.number().int().min(0),
  ready: z.number().int().min(0),
  price_silent: z.number().int().min(0),
  follow_up: z.number().int().min(0),
  approval: z.number().int().min(0),
  tasks: z.number().int().min(0),
});
export type TodayCounts = z.infer<typeof TodayCounts>;

/** `GET /today/counts`: the counts only, for the sidebar badge (cheaper than `GET /today`). */
export const TodayCountsResponse = z.object({
  counts: TodayCounts,
  /** The sum of the counts. */
  total: z.number().int().min(0),
});
export type TodayCountsResponse = z.infer<typeof TodayCountsResponse>;

/** `POST /today/refresh`: how many conversations were evaluated, then the fresh Today. */
export const RefreshTodayResponse = TodayResponse.extend({
  evaluated: z.number().int().min(0),
  /** True when the daily evaluations ran out before every conversation was evaluated. */
  capped: z.boolean(),
  /** True when the time budget ended the refresh with conversations left to evaluate. */
  partial: z.boolean(),
  /** Conversations picked but not evaluated because the time budget ended (0 when capped). */
  remaining: z.number().int().min(0),
});
export type RefreshTodayResponse = z.infer<typeof RefreshTodayResponse>;

/** `POST /conversations/{id}/reply-draft`: a suggested reply, never sent by itself. */
export const ReplyDraftResponse = z.object({ text: z.string().min(1).max(2000) });
export type ReplyDraftResponse = z.infer<typeof ReplyDraftResponse>;

// ─── Autonomy levels (spec 2026-11-11 care §5, ADR-031) ─────────────────────────────────────────

/** The actions whose autonomy a business sets. */
export const AutonomyAction = z.enum(['care.send_message']);
export type AutonomyAction = z.infer<typeof AutonomyAction>;
/**
 * `suggest` ("đề xuất"): the AI drafts, a person sends; `act_and_report` ("làm rồi báo"): the AI
 * sends and Today lists it; `auto` ("tự làm"): the AI sends, only the reports mention it.
 */
export const AutonomyLevel = z.enum(['suggest', 'act_and_report', 'auto']);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const AutonomyActionDto = z.object({
  action: AutonomyAction,
  level: AutonomyLevel,
  default: AutonomyLevel,
  /** The levels this action allows. */
  levels: z.array(AutonomyLevel),
});
export type AutonomyActionDto = z.infer<typeof AutonomyActionDto>;

export const AutonomySettingsResponse = z.object({ actions: z.array(AutonomyActionDto) });
export type AutonomySettingsResponse = z.infer<typeof AutonomySettingsResponse>;

export const UpdateAutonomySettingsRequest = z
  .object({
    actions: z
      .array(z.object({ action: AutonomyAction, level: AutonomyLevel }).strict())
      .min(1)
      .max(10),
  })
  .strict();
export type UpdateAutonomySettingsRequest = z.infer<typeof UpdateAutonomySettingsRequest>;

// ─── "Rapiz đã mang lại" (spec 2026-11-11 care §6) ─────────────────────────────────────────────

export const ImpactRange = z.enum(['today', '7d', '30d']);
export type ImpactRange = z.infer<typeof ImpactRange>;

export const ImpactQuery = z.object({ range: ImpactRange.default('30d') });
export type ImpactQuery = z.infer<typeof ImpactQuery>;

const ImpactFigures = z.object({
  orders: z.number().int().min(0),
  /** Integer VND: orders' totals and stay bookings' sell totals. */
  revenue: z.number().int().min(0),
});

/**
 * Orders and stay bookings created within 7 days after an AI touch (a care message or a bot
 * reply) in the same conversation: `ai` when no member messaged in between, `aiStaff` when one
 * did. Plus the follow-ups the care agent sent and how many customers answered them.
 */
export const ImpactResponse = z.object({
  range: ImpactRange,
  since: z.iso.datetime(),
  until: z.iso.datetime(),
  followUpsSent: z.number().int().min(0),
  repliesReceived: z.number().int().min(0),
  ai: ImpactFigures,
  aiStaff: ImpactFigures,
});
export type ImpactResponse = z.infer<typeof ImpactResponse>;

// ─── Integration events ─────────────────────────────────────────────────────────────────────────

/**
 * `brain.signals.updated.v1` (outbox, aggregate `conversation`): an evaluation or a member's stage
 * change was written. Ids and enums only; consumers read the signal through the brain facade.
 */
export const BRAIN_SIGNALS_UPDATED = 'brain.signals.updated.v1';
export const BrainSignalsUpdatedPayload = z.object({
  conversationId: z.uuid(),
  stage: SignalStage,
  optOut: z.boolean(),
  version: z.number().int(),
  occurredAt: z.iso.datetime(),
});
export type BrainSignalsUpdatedPayload = z.infer<typeof BrainSignalsUpdatedPayload>;
