/** An open, assigned task whose due time has passed and that was never reminded. */
export interface DueTaskReminder {
  id: string;
  workspaceId: string;
  title: string;
  assigneeUserId: string | null;
  /** The linked customer's name, for the notice. */
  contactName: string | null;
  dueAt: Date;
}

/** Cross-workspace reads for the due-task reminder (runs as `app_system` in the worker). */
export interface TaskReminderStore {
  /** Open tasks with an assignee, `due_at <= now` and no reminder yet, oldest due first. */
  due(now: Date, limit: number): Promise<DueTaskReminder[]>;
  /** Sets `reminded_at` once (a second call keeps the first time). */
  markReminded(taskId: string, at: Date): Promise<void>;
}

export const TASK_REMINDER_STORE = Symbol('TASK_REMINDER_STORE');
