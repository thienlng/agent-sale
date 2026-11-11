import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { conversations } from './conversation.js';
import { contacts } from './crm.js';
import { tenantPolicies, workspaces } from './workspace.js';

/**
 * Tables of the `brain` module (migration 0073, spec 2026-11-11 Business Brain v1; 0075 adds the
 * opt-out signal and the autonomy registry).
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

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
export type SignalStage = (typeof SIGNAL_STAGES)[number];
export const SIGNAL_MOODS = ['positive', 'neutral', 'negative', 'complaint'] as const;
export type SignalMood = (typeof SIGNAL_MOODS)[number];
export type SignalTrigger = 'idle' | 'manual' | 'refresh';
/** A `signal_runs` row: an evaluation by its trigger, or a reply draft (`draft`). */
export type SignalRunTrigger = SignalTrigger | 'draft';

/**
 * One AI judgement per conversation. Deleting the conversation deletes it; a deleted customer
 * only clears `contact_id`.
 */
export const conversationSignals = pgTable(
  'conversation_signals',
  {
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    contactId: uuid('contact_id'),
    stage: text('stage').$type<SignalStage>().notNull().default('new'),
    intent: text('intent'),
    mood: text('mood').$type<SignalMood>().notNull().default('neutral'),
    needsHuman: boolean('needs_human').notNull().default(false),
    needsHumanReason: text('needs_human_reason'),
    followUpAt: ts('follow_up_at'),
    followUpReason: text('follow_up_reason'),
    note: text('note'),
    evaluatedUntil: ts('evaluated_until'),
    evaluatedAt: ts('evaluated_at'),
    stageLocked: boolean('stage_locked').notNull().default(false),
    dismissedUntilMessageAfter: ts('dismissed_until_message_after'),
    version: integer('version').notNull().default(1),
    /** The customer asked not to be contacted (0075): the care agent never enrolls them. */
    optOut: boolean('opt_out').notNull().default(false),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId] }),
    foreignKey({
      name: 'conversation_signals_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    // SQL: ON DELETE SET NULL (contact_id) — Drizzle cannot express the column list.
    foreignKey({
      name: 'conversation_signals_contact_fk',
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete('set null'),
    check(
      'conversation_signals_stage_check',
      sql`${t.stage} in ('new','exploring','price_asked','ready','won','after_sale','lost','spam')`,
    ),
    check(
      'conversation_signals_mood_check',
      sql`${t.mood} in ('positive','neutral','negative','complaint')`,
    ),
    check('conversation_signals_intent_length', sql`char_length(${t.intent}) <= 160`),
    check(
      'conversation_signals_needs_human_reason_length',
      sql`char_length(${t.needsHumanReason}) <= 200`,
    ),
    check(
      'conversation_signals_follow_up_reason_length',
      sql`char_length(${t.followUpReason}) <= 200`,
    ),
    check('conversation_signals_note_length', sql`char_length(${t.note}) <= 1500`),
    index('conversation_signals_stage_idx').on(t.workspaceId, t.stage),
    index('conversation_signals_follow_up_idx').on(t.workspaceId, t.followUpAt),
    index('conversation_signals_contact_idx')
      .on(t.workspaceId, t.contactId)
      .where(sql`${t.contactId} is not null`),
    ...tenantPolicies('conversation_signals'),
  ],
);

/** Idle evaluation queue: one row per conversation; a newer customer message pushes `run_after`. */
export const signalJobs = pgTable(
  'signal_jobs',
  {
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    trigger: text('trigger').$type<SignalTrigger>().notNull(),
    runAfter: ts('run_after').notNull(),
    status: text('status').$type<'pending' | 'capped'>().notNull().default('pending'),
    leaseUntil: ts('lease_until'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.conversationId] }),
    foreignKey({
      name: 'signal_jobs_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    check('signal_jobs_trigger_check', sql`${t.trigger} in ('idle','manual','refresh')`),
    check('signal_jobs_status_check', sql`${t.status} in ('pending','capped')`),
    index('signal_jobs_due_idx')
      .on(t.runAfter)
      .where(sql`${t.status} = 'pending'`),
    index('signal_jobs_capped_idx')
      .on(t.runAfter)
      .where(sql`${t.status} = 'capped'`),
    ...tenantPolicies('signal_jobs'),
  ],
);

/** One row per model call (evaluations, reply drafts), for cost reporting. No conversation key. */
export const signalRuns = pgTable(
  'signal_runs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    trigger: text('trigger').$type<SignalRunTrigger>().notNull(),
    tier: text('tier').notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    outcome: text('outcome').$type<'ok' | 'invalid' | 'error' | 'timeout'>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('signal_runs_trigger_check', sql`${t.trigger} in ('idle','manual','refresh','draft')`),
    check('signal_runs_tier_length', sql`char_length(${t.tier}) <= 40`),
    check('signal_runs_model_length', sql`char_length(${t.model}) <= 120`),
    check('signal_runs_outcome_check', sql`${t.outcome} in ('ok','invalid','error','timeout')`),
    index('signal_runs_workspace_idx').on(t.workspaceId, t.createdAt.desc()),
    ...tenantPolicies('signal_runs'),
  ],
);

/** Daily evaluation counter per business (day in Asia/Ho_Chi_Minh). */
export const signalUsage = pgTable(
  'signal_usage',
  {
    workspaceId: workspaceRef(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.day] }),
    check('signal_usage_count_check', sql`${t.count} >= 0`),
    ...tenantPolicies('signal_usage'),
  ],
);

/** Per-business Brain settings; a missing row means the defaults. */
export const brainSettings = pgTable(
  'brain_settings',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspaces.id),
    mode: text('mode').$type<'auto' | 'manual'>().notNull().default('auto'),
    idleMinutes: integer('idle_minutes').notNull().default(45),
    briefingEnabled: boolean('briefing_enabled').notNull().default(true),
    briefingHour: integer('briefing_hour').notNull().default(8),
    lastBriefingDay: date('last_briefing_day', { mode: 'string' }),
  },
  (t) => [
    check('brain_settings_mode_check', sql`${t.mode} in ('auto','manual')`),
    check('brain_settings_idle_minutes_check', sql`${t.idleMinutes} between 30 and 120`),
    check('brain_settings_briefing_hour_check', sql`${t.briefingHour} between 0 and 23`),
    ...tenantPolicies('brain_settings'),
  ],
);

/**
 * GLOBAL (app_system only, no RLS): the brain's outbox position per consumer (`brain.signals`),
 * like `analytics_checkpoints` of the analytics module.
 */
export const brainCheckpoints = pgTable('brain_checkpoints', {
  consumer: text('consumer').primaryKey(),
  horizon: bigint('horizon', { mode: 'number' }).notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const AUTONOMY_ACTIONS = ['care.send_message'] as const;
export type AutonomyAction = (typeof AUTONOMY_ACTIONS)[number];
export const AUTONOMY_LEVELS = ['suggest', 'act_and_report', 'auto'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Autonomy level per business and action (0075, ADR-031); a missing row means the default. */
export const autonomySettings = pgTable(
  'autonomy_settings',
  {
    workspaceId: workspaceRef(),
    action: text('action').$type<AutonomyAction>().notNull(),
    level: text('level').$type<AutonomyLevel>().notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.action] }),
    check('autonomy_settings_action_check', sql`${t.action} in ('care.send_message')`),
    check('autonomy_settings_level_check', sql`${t.level} in ('suggest','act_and_report','auto')`),
    ...tenantPolicies('autonomy_settings'),
  ],
);
