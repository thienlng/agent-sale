import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { AutonomyLevel } from './brain.js';
import { conversations } from './conversation.js';
import { tenantPolicies, workspaces } from './workspace.js';

/** Tables of the `care` module (migration 0075, spec 2026-11-11 care agent, ADR-031). */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id);

export const CARE_TEMPLATE_KEYS = ['silent', 'ready', 'after_sale'] as const;
export type CareTemplateKey = (typeof CARE_TEMPLATE_KEYS)[number];
export type CareEnrollmentStatus = 'active' | 'done' | 'stopped';
export const CARE_MESSAGE_STATUSES = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'failed',
  'expired',
  'rejected',
  'skipped',
] as const;
export type CareMessageStatus = (typeof CARE_MESSAGE_STATUSES)[number];

/** Per business and template: on/off, the owner's instruction and parameters. */
export const careTemplates = pgTable(
  'care_templates',
  {
    workspaceId: workspaceRef(),
    key: text('key').$type<CareTemplateKey>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    instruction: text('instruction').notNull().default(''),
    params: jsonb('params')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    check('care_templates_key_check', sql`${t.key} in ('silent','ready','after_sale')`),
    check('care_templates_instruction_length', sql`char_length(${t.instruction}) <= 500`),
    ...tenantPolicies('care_templates'),
  ],
);

/** One follow-up cycle per conversation and template (`anchor_at` = what the cycle is for). */
export const careEnrollments = pgTable(
  'care_enrollments',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    template: text('template').$type<CareTemplateKey>().notNull(),
    step: integer('step').notNull().default(0),
    anchorAt: ts('anchor_at').notNull(),
    nextAt: ts('next_at').notNull(),
    status: text('status').$type<CareEnrollmentStatus>().notNull().default('active'),
    stopReason: text('stop_reason'),
    leaseUntil: ts('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'care_enrollments_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    check('care_enrollments_template_check', sql`${t.template} in ('silent','ready','after_sale')`),
    check('care_enrollments_step_check', sql`${t.step} >= 0`),
    check('care_enrollments_status_check', sql`${t.status} in ('active','done','stopped')`),
    check('care_enrollments_stop_reason_length', sql`char_length(${t.stopReason}) <= 40`),
    uniqueIndex('care_enrollments_conversation_template_idx').on(
      t.workspaceId,
      t.conversationId,
      t.template,
    ),
    index('care_enrollments_due_idx')
      .on(t.nextAt)
      .where(sql`${t.status} = 'active' and ${t.template} <> 'after_sale'`),
    index('care_enrollments_after_sale_idx')
      .on(t.workspaceId, t.nextAt)
      .where(sql`${t.status} = 'active' and ${t.template} = 'after_sale'`),
    ...tenantPolicies('care_enrollments'),
  ],
);

/** Every message the care agent wrote: a draft for a person, or what it sent. */
export const careMessages = pgTable(
  'care_messages',
  {
    id: uuid('id').primaryKey(),
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id').notNull(),
    enrollmentId: uuid('enrollment_id'),
    anchorAt: ts('anchor_at').notNull(),
    template: text('template').$type<CareTemplateKey>().notNull(),
    step: integer('step').notNull().default(0),
    level: text('level').$type<AutonomyLevel>().notNull(),
    text: text('text').notNull().default(''),
    skipReason: text('skip_reason'),
    status: text('status').$type<CareMessageStatus>().notNull(),
    windowClosesAt: ts('window_closes_at'),
    sendAt: ts('send_at'),
    sentMessageId: uuid('sent_message_id'),
    sentAt: ts('sent_at'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'care_messages_conversation_fk',
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    check('care_messages_template_check', sql`${t.template} in ('silent','ready','after_sale')`),
    check('care_messages_level_check', sql`${t.level} in ('suggest','act_and_report','auto')`),
    check('care_messages_text_length', sql`char_length(${t.text}) <= 2000`),
    check('care_messages_skip_reason_length', sql`char_length(${t.skipReason}) <= 200`),
    check('care_messages_model_length', sql`char_length(${t.model}) <= 120`),
    check(
      'care_messages_status_check',
      sql`${t.status} in ('draft','scheduled','sending','sent','failed','expired','rejected','skipped')`,
    ),
    index('care_messages_conversation_idx').on(t.workspaceId, t.conversationId, t.createdAt.desc()),
    index('care_messages_draft_idx')
      .on(t.workspaceId, t.createdAt.desc())
      .where(sql`${t.status} = 'draft'`),
    index('care_messages_sent_idx')
      .on(t.workspaceId, t.sentAt.desc())
      .where(sql`${t.status} = 'sent'`),
    index('care_messages_open_idx')
      .on(t.windowClosesAt)
      .where(sql`${t.status} in ('draft','scheduled','sending')`),
    index('care_messages_scheduled_idx')
      .on(t.sendAt)
      .where(sql`${t.status} = 'scheduled'`),
    uniqueIndex('care_messages_step_idx')
      .on(t.workspaceId, t.enrollmentId, t.anchorAt, t.step)
      .where(sql`${t.enrollmentId} is not null`),
    ...tenantPolicies('care_messages'),
  ],
);

/** Daily message counter per business (day in Asia/Ho_Chi_Minh). */
export const careUsage = pgTable(
  'care_usage',
  {
    workspaceId: workspaceRef(),
    day: date('day', { mode: 'string' }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.day] }),
    check('care_usage_count_check', sql`${t.count} >= 0`),
    ...tenantPolicies('care_usage'),
  ],
);

/** GLOBAL (app_system only, no RLS): the care module's outbox position per consumer. */
export const careCheckpoints = pgTable('care_checkpoints', {
  consumer: text('consumer').primaryKey(),
  horizon: bigint('horizon', { mode: 'number' }).notNull().default(0),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
