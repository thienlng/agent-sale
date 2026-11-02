import type { WorkspaceId } from '@agent-sales/shared';

import type { LocalReminderKind } from '../../domain/hq-mapping.js';

/** An outbox event the Rapiz HQ sync reads (platform-level: no workspace). */
export interface HqOutboxRow {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * One pass of the HQ consumer under an exclusive lease, like the analytics projector: the window
 * is the committed events of every transaction that finished since the last pass.
 */
export interface HqLease {
  /** Events of the window with one of `types` and an id after `afterId`, oldest first. */
  readBatch(types: readonly string[], afterId: number, limit: number): Promise<HqOutboxRow[]>;
  /** Moves the position to the end of the window. */
  commit(): Promise<void>;
  deadLetter(row: HqOutboxRow, error: string): Promise<void>;
}

/** A subscription of a SaaS business due a local reminder (spec §6.5). */
export interface DueReminder {
  workspaceId: WorkspaceId;
  contactId: string;
  kind: LocalReminderKind;
  /** The trial end or renewal date (yyyy-mm-dd). */
  dueOn: string;
  remindersSent: Record<string, string>;
}

/** Cross-tenant work of the saas module (app_system): HQ outbox position, daily jobs. */
export interface SaasSystemStore {
  /** Runs `fn` with the lease, or returns null when another consumer holds it. */
  withHqLease<T>(fn: (lease: HqLease) => Promise<T>): Promise<T | null>;
  /**
   * Claims the daily run of `job` for `day` (yyyy-mm-dd): true once per day across processes.
   */
  claimDaily(job: string, day: string): Promise<boolean>;
  /**
   * Unlinked subscriptions (a sync sends its own reminders) whose trial ends or renewal falls on
   * `from`..`to` (yyyy-mm-dd, both included) per kind window.
   */
  dueReminders(
    windows: Record<LocalReminderKind, { from: string; to: string }>,
  ): Promise<DueReminder[]>;
  /** Records the reminder key on the subscription (idempotent). */
  markReminderSent(ws: WorkspaceId, contactId: string, key: string, at: Date): Promise<void>;
}
export const SAAS_SYSTEM_STORE = Symbol('SAAS_SYSTEM_STORE');
