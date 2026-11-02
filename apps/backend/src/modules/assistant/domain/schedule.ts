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
