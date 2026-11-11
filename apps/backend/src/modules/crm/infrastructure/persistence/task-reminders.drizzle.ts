import { and, asc, eq, isNotNull, isNull, lte, schema, type Database } from '@agent-sales/db';

import type {
  DueTaskReminder,
  TaskReminderStore,
} from '../../application/ports/task-reminder-store.js';

const t = schema.tasks;
const c = schema.contacts;

/** Due-task reminders across workspaces on the `app_system` connection (worker only). */
export class DrizzleTaskReminderStore implements TaskReminderStore {
  constructor(private readonly db: Database) {}

  async due(now: Date, limit: number): Promise<DueTaskReminder[]> {
    const rows = await this.db
      .select({
        id: t.id,
        workspaceId: t.workspaceId,
        title: t.title,
        assigneeUserId: t.assigneeUserId,
        contactName: c.name,
        dueAt: t.dueAt,
      })
      .from(t)
      .leftJoin(c, and(eq(c.workspaceId, t.workspaceId), eq(c.id, t.contactId)))
      .where(
        and(
          eq(t.status, 'open'),
          isNull(t.remindedAt),
          isNotNull(t.assigneeUserId),
          lte(t.dueAt, now),
        ),
      )
      .orderBy(asc(t.dueAt), asc(t.id))
      .limit(limit);
    return rows.map((r) => ({ ...r, dueAt: r.dueAt ?? now }));
  }

  async markReminded(taskId: string, at: Date): Promise<void> {
    await this.db
      .update(t)
      .set({ remindedAt: at })
      .where(and(eq(t.id, taskId), isNull(t.remindedAt)));
  }
}

/** Without the system connection there is nothing to remind (API-only or test runs). */
export class NoTaskReminderStore implements TaskReminderStore {
  async due(): Promise<DueTaskReminder[]> {
    return [];
  }

  async markReminded(): Promise<void> {}
}
